const state = {
  audit: null,
  samples: [],
  selectedId: null,
  status: "all",
  query: "",
  detail: null,
  pendingStatus: "unreviewed",
};

const $ = (selector) => document.querySelector(selector);
const number = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function prettyArguments(raw) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function statusLabel(status) {
  return (
    {
      approved: "Approved",
      needs_work: "Needs work",
      rejected: "Rejected",
      unreviewed: "Open",
    }[status] || "Open"
  );
}

async function api(path, options) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}

function renderOverview() {
  const counters = state.audit.counters;
  const reviewed = Object.values(state.audit.reviewCounts).reduce(
    (sum, count) => sum + count,
    0,
  );
  const readiness = Math.round(
    (counters.cleanCandidates / counters.uniqueCandidates) * 100,
  );
  $("#readiness-score").textContent = `${readiness}%`;
  $("#readiness-fill").style.width = `${Math.max(5, readiness)}%`;
  $("#readiness-copy").textContent =
    `${number.format(counters.cleanCandidates)} decisions pass every automatic gate. ${reviewed} of ${state.audit.reviewedSampleSize} pilot examples have a human decision.`;
  const metrics = [
    [
      number.format(counters.uniqueCandidates),
      "Distinct decisions",
      "after exact deduplication",
    ],
    [
      number.format(counters.cleanCandidates),
      "Clean candidates",
      "conservative executor pool",
    ],
    [
      compact.format(counters.cleanCandidateTokens),
      "Candidate tokens",
      "historical tokenizer · before human review",
    ],
    [
      number.format(counters.turnsWithImagesFlattened),
      "Vision turns held back",
      "image inputs cannot be reconstructed",
    ],
  ];
  $("#metrics").innerHTML = metrics
    .map(
      ([value, label, note]) => `
    <div class="metric"><span class="metric-label">${label}</span><strong class="metric-value">${value}</strong><div class="metric-note">${note}</div></div>
  `,
    )
    .join("");
}

function filteredSamples() {
  const query = state.query.toLowerCase();
  return state.samples.filter((sample) => {
    const statusMatches =
      state.status === "all" || sample.review.status === state.status;
    const haystack = [
      sample.domain,
      sample.task,
      sample.sourceModel,
      ...sample.toolNames,
    ]
      .join(" ")
      .toLowerCase();
    return statusMatches && (!query || haystack.includes(query));
  });
}

function renderList() {
  const samples = filteredSamples();
  $("#visible-count").textContent = samples.length;
  $("#sample-list").innerHTML =
    samples
      .map(
        (sample) => `
    <button class="sample-row ${sample.id === state.selectedId ? "active" : ""}" data-id="${escapeHtml(sample.id)}">
      <div class="sample-row-top"><span class="domain">${escapeHtml(sample.domain)}</span><span class="status-dot ${sample.review.status}" title="${statusLabel(sample.review.status)}"></span></div>
      <p class="task-preview">${escapeHtml(sample.task || "Tool-driven browser decision")}</p>
      <div class="row-meta">
        ${(sample.toolNames.length ? sample.toolNames : ["text response"]).map((tool) => `<span class="tag">${escapeHtml(tool)}</span>`).join("")}
        <span class="tag">${compact.format(sample.promptTokens + sample.completionTokens)} tok</span>
      </div>
    </button>
  `,
      )
      .join("") ||
    `<div class="empty-state"><p>No samples match this filter.</p></div>`;
  document.querySelectorAll(".sample-row").forEach((button) => {
    button.addEventListener("click", () => selectSample(button.dataset.id));
  });
}

function renderMessage(message, index, lastIndex) {
  const target = index === lastIndex;
  const content =
    typeof message.content === "string"
      ? message.content
      : message.content === null
        ? ""
        : JSON.stringify(message.content, null, 2);
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  return `<section class="message ${escapeHtml(message.role)} ${target ? "target" : ""}">
    <div class="message-head"><span>${target ? "Training target" : escapeHtml(message.role || "message")}</span><span>${String(index + 1).padStart(2, "0")}</span></div>
    ${content ? `<div class="message-content">${escapeHtml(content)}</div>` : ""}
    ${toolCalls.map((call) => `<div class="tool-call"><div class="tool-name">${escapeHtml(call.function?.name || "tool")}</div><pre class="tool-args">${escapeHtml(prettyArguments(call.function?.arguments || "{}"))}</pre></div>`).join("")}
  </section>`;
}

function renderDetail() {
  const sample = state.detail;
  if (!sample) return;
  const metadata = sample.metadata;
  const tokens =
    metadata.recordedPromptTokens + metadata.recordedCompletionTokens;
  const utilization = Math.min(100, Math.round((tokens / 32768) * 100));
  state.pendingStatus = sample.review?.status || "unreviewed";
  $("#sample-detail").innerHTML = `
    <header class="detail-head">
      <div class="detail-title-row">
        <div><p class="eyebrow">DECISION ${escapeHtml(metadata.id.slice(0, 8).toUpperCase())}</p><h2>${escapeHtml(metadata.domain)}</h2><div class="detail-sub">Turn ${metadata.turnNumber} · ${escapeHtml(metadata.sourceModel)} · ${sample.messages.length} messages</div></div>
        <div class="token-pill">${number.format(tokens)} recorded tokens</div>
      </div>
      <div class="token-bar" title="Relative to a 32K context"><span style="width:${utilization}%"></span></div>
    </header>
    <div class="detail-body">
      <div class="conversation">
        <div class="conversation-title"><h3>Model conversation</h3><span>context → target</span></div>
        ${sample.messages.map((message, index) => renderMessage(message, index, sample.messages.length - 1)).join("")}
      </div>
      <aside class="review-panel">
        <h3>Your decision</h3>
        <p class="review-copy">Approve only if the action is correct and the full conversation contains no private or sensitive material. Approved examples stay local.</p>
        <div class="decision-grid">
          <button class="decision approved" data-decision="approved">✓ Approve for pilot</button>
          <button class="decision needs_work" data-decision="needs_work">△ Needs correction</button>
          <button class="decision rejected" data-decision="rejected">× Reject example</button>
        </div>
        <label for="review-note">Review note</label>
        <textarea id="review-note" placeholder="Why is this action useful, flawed, or unsafe?">${escapeHtml(sample.review?.note || "")}</textarea>
        <button class="save-review" id="save-review">Save review</button>
        <div class="review-meta" id="review-meta">${sample.review?.updatedAt ? `Last saved ${new Date(sample.review.updatedAt).toLocaleString()}` : "Not reviewed yet"}</div>
        <div class="context-note"><strong>HOW TO READ THIS</strong><p>Everything above the green card is context the model receives. The green card is the only response trained with loss. Token counts use the historical provider and will shift slightly in Tinker.</p></div>
      </aside>
    </div>`;
  updateDecisionButtons();
  document.querySelectorAll(".decision").forEach((button) =>
    button.addEventListener("click", () => {
      state.pendingStatus = button.dataset.decision;
      updateDecisionButtons();
    }),
  );
  $("#save-review").addEventListener("click", saveReview);
}

function updateDecisionButtons() {
  document
    .querySelectorAll(".decision")
    .forEach((button) =>
      button.classList.toggle(
        "active",
        button.dataset.decision === state.pendingStatus,
      ),
    );
}

async function selectSample(id) {
  state.selectedId = id;
  renderList();
  $("#sample-detail").innerHTML =
    `<div class="empty-state"><p>Loading decision…</p></div>`;
  state.detail = await api(`/api/samples/${encodeURIComponent(id)}`);
  renderDetail();
}

async function saveReview() {
  const button = $("#save-review");
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const review = await api(
      `/api/reviews/${encodeURIComponent(state.selectedId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: state.pendingStatus,
          note: $("#review-note").value,
        }),
      },
    );
    state.detail.review = review;
    const summary = state.samples.find(
      (sample) => sample.id === state.selectedId,
    );
    summary.review = review;
    state.audit = await api("/api/audit");
    renderOverview();
    renderList();
    renderDetail();
    $("#review-meta").textContent = "Review saved locally";
  } catch (error) {
    $("#review-meta").textContent = error.message;
    button.disabled = false;
    button.textContent = "Save review";
  }
}

async function init() {
  try {
    [state.audit, state.samples] = await Promise.all([
      api("/api/audit"),
      api("/api/samples"),
    ]);
    renderOverview();
    renderList();
    if (state.samples[0]) selectSample(state.samples[0].id);
  } catch (error) {
    $("#sample-detail").innerHTML =
      `<div class="empty-state"><h2>Could not load the pilot</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

$("#search").addEventListener("input", (event) => {
  state.query = event.target.value;
  renderList();
});
document.querySelectorAll(".filter").forEach((button) =>
  button.addEventListener("click", () => {
    document
      .querySelectorAll(".filter")
      .forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.status = button.dataset.status;
    renderList();
  }),
);

init();
