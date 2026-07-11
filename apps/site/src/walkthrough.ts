import "./styles.css";
import "./walkthrough.css";
import RAW from "./walkthrough-data.json";

/**
 * Interactive replay of four real recorded orchestrator runs. Every
 * objective, tool call, model id, token count, and verdict is read verbatim
 * from the embedded trace extracts — the only curated strings are the tab
 * labels, headlines, and short step titles below.
 */

type ToolCall = {
  turn: number;
  tool: string;
  args: unknown;
  success: boolean;
  result?: string;
};
type NodeSession = {
  turnCount: number;
  totalToolCalls: number;
  models: string[];
  usage: { promptTokens: number; completionTokens: number };
  sampleToolCalls: ToolCall[];
} | null;
type Verification = {
  decision?: string;
  confidence?: number;
  reason?: string;
};
type RunNode = {
  index: number;
  objective: string | null;
  successCriteria: string | null;
  skill: { id: string; reason: string } | null;
  verifications: Verification[];
  outcome: string | null;
  durationMs: number | null;
  summary: string | null;
  session: NodeSession;
};
type RunData = {
  runId: string;
  recordedAt: string;
  prompt: string;
  planner: {
    model: string;
    durationMs: number;
    usage: { total_tokens: number };
  } | null;
  plan: { difficulty?: string; nodeCount: number };
  nodes: RunNode[];
  executorModels: string[];
  taskCompleted: {
    data: {
      completed: number;
      failed: number;
      skipped: number;
      totalDurationMs: number;
      totalTokens: number;
      totalCostUsd: number;
    };
  } | null;
  totals: { turns: number; toolCalls: number };
};

type RunMeta = {
  key: string;
  tab: string;
  tabNote?: string;
  /** "chain" (default): one step per plan node. "workflow": the planner matched
   *  a trusted workflow instead of decomposing — one step per recorded form
   *  operation of the single node. */
  mode?: "workflow";
  headline: string;
  lede: string;
  planNote: string;
  finaleTitle: string;
  finaleLede: string;
  shortTitles: string[];
  actionNotes?: string[];
};

const RUN_META: Record<string, RunMeta> = {
  c462ed87: {
    key: "checkout",
    tab: "Checkout order",
    headline: "One prompt becomes seven verified steps.",
    lede: `A single shopping request, recorded May 26, 2026 against the
      <strong>Northstar Outfitters</strong> demo storefront. A similar checkout
      run appears in the <a href="/#showcase">demo reel</a>.`,
    planNote: `Because every one of them writes to the same cart, it serialized
      them into a single dependency chain — no two run at once.`,
    finaleTitle: `Order confirmed — <span class="wt-orderid">NS-01001</span>`,
    finaleLede: `Both pairs of shoes ordered, coupon SAVE10 applied, express
      shipping selected, and a confirmation email sent to
      alex.morgan@example.com.`,
    shortTitles: [
      "Add Pegasus 41 to cart",
      "Add Novablast 4 to cart",
      "Open cart, go to checkout",
      "Enter contact details",
      "Apply coupon SAVE10",
      "Select express shipping",
      "Place & confirm the order",
    ],
  },
  a1dc0659: {
    key: "inventory",
    tab: "Inventory lookup",
    headline: "One question becomes four checked steps.",
    lede: `A read-and-compare request, recorded July 9, 2026 against a paginated
      warehouse listing fixture: page forward to read one number, page back to
      read another, then report both.`,
    planNote: `Each step depends on what the previous one read, so the chain
      runs strictly in order.`,
    finaleTitle: `Answer delivered — <span class="wt-orderid">Gamma 6,412 · Alpha 4,827</span>`,
    finaleLede: `The agent read Warehouse Gamma's count on page 3, returned to
      Warehouse Alpha for its count, reported both numbers, and re-verified the
      final page state.`,
    shortTitles: [
      "Read Gamma's count (page 3)",
      "Return to Alpha, read count",
      "Report both numbers",
      "Verify Alpha is visible",
    ],
  },
  ab2eb7b1: {
    key: "settings",
    tab: "Settings cleanup",
    headline: "One instruction becomes four careful steps.",
    lede: `A cleanup-then-act request, recorded July 5, 2026 against a settings
      fixture page: clear the popups first, change a setting, then walk a
      guarded delete-and-confirm flow.`,
    planNote: `Popups must be cleared before the form is touched, and the
      deletion is split into act and confirm — so the chain runs strictly in
      order.`,
    finaleTitle: `Done — <span class="wt-orderid">“Account deleted successfully.”</span>`,
    finaleLede: `Popups dismissed, notification email set to user@test.com, and
      the guarded deletion completed with the confirmation message visible
      on-page.`,
    shortTitles: [
      "Close every popup",
      "Set notification email",
      "Start account deletion",
      "Confirm the deletion",
    ],
  },
};

RUN_META.bde2ff19 = {
  key: "servicenow",
  tab: "ServiceNow incident",
  tabNote: "trusted workflow",
  mode: "workflow",
  headline: "Some tasks don't decompose — they get recognized.",
  lede: `An enterprise record request with nine explicit field values, recorded
    July 7, 2026 against a public ServiceNow developer instance. Instead of
    planning subtasks, the planner matched it to a trusted workflow with
    guarded submits.`,
  planNote: "",
  finaleTitle: `Incident created — <span class="wt-orderid">INC0000038</span>`,
  finaleLede: `The trusted form helper configured all nine fields, caught a
    rejected first submit, reconciled the field state, and resubmitted — this
    time the record left the form.`,
  shortTitles: [
    "Fill the incident form",
    "First submit — rejected",
    "Reconcile the field state",
    "Submit — record created",
  ],
  actionNotes: [
    `One call sets all nine fields; the helper echoes back every field it
      wrote, by label and by internal name.`,
    `The instance rejected the update, and the guard caught it: a submit only
      counts if the form actually leaves for a record. It reports the mismatch
      instead of declaring success.`,
    `The helper re-applies and re-verifies the same field state before trying
      again.`,
    `This time the record leaves the form: INC0000038 is created and opened as
      evidence.`,
  ],
};

const runs = (RAW as { runs: unknown[] }).runs.map((r) => {
  const data = r as RunData;
  return { data, meta: RUN_META[data.runId.slice(0, 8)] };
});

const esc = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const clean = (s: unknown): string =>
  String(s ?? "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
const secs = (ms: number): string => (ms / 1000).toFixed(1) + " s";
const num = (n: number): string => Number(n ?? 0).toLocaleString("en-US");
const shortModel = (m?: string | null): string =>
  m ? m.split("/").pop()! : "—";

type Step =
  | { kind: "intro"; spine: { kicker: string; title: string } }
  | { kind: "plan"; spine: { kicker: string; title: string } }
  | { kind: "node"; node: RunNode; i: number; spine: { kicker: string; title: string } }
  | { kind: "action"; call: ToolCall; i: number; spine: { kicker: string; title: string } }
  | { kind: "finale"; spine: { kicker: string; title: string } };

function buildSteps(data: RunData, meta: RunMeta): Step[] {
  const middle: Step[] =
    meta.mode === "workflow"
      ? [
          {
            kind: "plan",
            spine: { kicker: "planner", title: "Recognize a trusted workflow" },
          },
          ...(data.nodes[0].session?.sampleToolCalls ?? []).map(
            (c, i): Step => ({
              kind: "action",
              call: c,
              i,
              spine: { kicker: "operation " + (i + 1), title: meta.shortTitles[i] ?? c.tool },
            }),
          ),
        ]
      : [
          {
            kind: "plan",
            spine: { kicker: "planner", title: `Decompose into ${data.plan.nodeCount} subtasks` },
          },
          ...data.nodes.map(
            (n, i): Step => ({
              kind: "node",
              node: n,
              i,
              spine: {
                kicker: "subtask " + (i + 1),
                title: meta.shortTitles[i] ?? clean(n.objective),
              },
            }),
          ),
        ];
  return [
    { kind: "intro", spine: { kicker: "prompt", title: "One request" } },
    ...middle,
    { kind: "finale", spine: { kicker: "done", title: "Task complete" } },
  ];
}

function roleBadge(cls: string, label: string): string {
  return `<span class="wt-role ${cls}">${label}</span>`;
}

function renderIntro(data: RunData, meta: RunMeta): string {
  return `<div class="wt-step">
    <p class="wt-eyebrow">Replay · real recorded run · unedited trace</p>
    <h1>${meta.headline}</h1>
    <p class="wt-lede">${meta.lede} Every subtask, tool call, model name, token
      count, and verdict below comes straight from the trace files.</p>
    <div class="wt-bubble-row">
      <div class="wt-avatar">YOU</div>
      <div class="wt-bubble">${esc(data.prompt)}</div>
    </div>
    <p class="wt-lede">Three roles cooperate to get it done. Click <strong>Next step</strong> to watch the run unfold.</p>
    <div class="wt-legend">
      <div class="wt-card">
        ${roleBadge("planner", "PLANNER")}
        <h3>Breaks the prompt apart</h3>
        <p>Reads the request once and turns it into an ordered graph of small, checkable subtasks.</p>
        <span class="wt-model">${esc(shortModel(data.planner?.model))}</span>
      </div>
      <div class="wt-card">
        ${roleBadge("executor", "EXECUTOR")}
        <h3>Works the page</h3>
        <p>Sees the live page, then clicks, types, and scrolls — one subtask at a time.</p>
        <span class="wt-model">${esc(shortModel(data.executorModels[0]))}</span>
      </div>
      <div class="wt-card">
        ${roleBadge("verifier", "VERIFIER")}
        <h3>Checks the evidence</h3>
        <p>Accepts a subtask only when on-page evidence matches its success criteria.</p>
        <span class="wt-model">deterministic contract check</span>
      </div>
    </div>
  </div>`;
}

function renderRecognize(data: RunData): string {
  const p = data.planner!;
  const skill = data.nodes[0].skill;
  return `<div class="wt-step">
    <p class="wt-eyebrow">Step 1 · workflow selection</p>
    <h2>The planner recognizes a known workflow.</h2>
    <div class="wt-card edge-planner">
      <div class="wt-rolerow">
        ${roleBadge("planner", "PLANNER")}
        <span class="wt-model">${esc(p.model)}</span>
        <span class="wt-meta">${secs(p.durationMs)} · ${num(p.usage.total_tokens)} tokens</span>
      </div>
      <p class="wt-lede" style="margin:0">In ${secs(p.durationMs)} the planner read the request and —
      instead of decomposing it — matched it to the <strong>${esc(skill?.id ?? "")}</strong> skill.
      Its recorded reason: <em>“${esc(clean(skill?.reason))}”</em></p>
    </div>
    <div class="wt-card">
      <p class="wt-lede" style="margin:0">Trusted workflows run as deterministic procedures: every field
      write is echoed back for checking, and a submit only counts as done if the record actually leaves
      the form. The next ${data.nodes[0].session?.totalToolCalls ?? 0} steps are the recorded form
      operations, verbatim.</p>
    </div>
  </div>`;
}

function renderAction(data: RunData, meta: RunMeta, step: Extract<Step, { kind: "action" }>): string {
  const c = step.call;
  const total = data.nodes[0].session?.sampleToolCalls.length ?? 0;
  const note = meta.actionNotes?.[step.i];
  return `<div class="wt-step">
    <p class="wt-eyebrow">Step ${step.i + 2} · form operation ${step.i + 1} of ${total}</p>
    <h2>${esc(meta.shortTitles[step.i] ?? c.tool)}</h2>
    ${note ? `<p class="wt-criteria">${note}</p>` : ""}
    <div class="wt-card edge-executor">
      <div class="wt-rolerow">
        ${roleBadge("executor", "EXECUTOR")}
        <span class="wt-model">${esc(data.nodes[0].session?.models?.[0] ?? "")}</span>
        <span class="wt-meta">${esc(c.tool)}</span>
      </div>
      <div class="wt-toolblock">
        <div class="tb-args">${esc(c.tool)} ${esc(JSON.stringify(c.args).slice(0, 220))}</div>
        <pre class="tb-result">${esc(c.result ?? (c.success ? "ok" : "failed"))}</pre>
      </div>
    </div>
  </div>`;
}

function renderPlan(data: RunData, meta: RunMeta): string {
  const p = data.planner!;
  const chain = data.nodes
    .map((n, i) => {
      const link =
        i < data.nodes.length - 1
          ? `<div class="wt-chain-link" style="animation-delay:${0.12 * i + 0.1}s"></div>`
          : "";
      return `<div class="wt-chain-node" style="animation-delay:${0.12 * i}s">
        <span class="wt-chain-idx">${i + 1}</span>
        <span class="wt-chain-obj">${esc(meta.shortTitles[i] ?? clean(n.objective))}</span>
        <span class="wt-skill wt-chain-skill">${esc(n.skill?.id ?? "")}</span>
      </div>${link}`;
    })
    .join("");
  return `<div class="wt-step">
    <p class="wt-eyebrow">Step 1 · decomposition</p>
    <h2>The planner splits the prompt into a strict chain.</h2>
    <div class="wt-card edge-planner">
      <div class="wt-rolerow">
        ${roleBadge("planner", "PLANNER")}
        <span class="wt-model">${esc(p.model)}</span>
        <span class="wt-meta">${secs(p.durationMs)} · ${num(p.usage.total_tokens)} tokens</span>
      </div>
      <p class="wt-lede" style="margin:0">In ${secs(p.durationMs)} the planner rated the task
      <strong>${esc(data.plan.difficulty ?? "—")}</strong> and produced ${data.plan.nodeCount} subtasks.
      ${meta.planNote} It also picked a reusable <strong>skill</strong> (a proven procedure) for each
      subtask, shown on the right.</p>
    </div>
    <div class="wt-chain">${chain}</div>
  </div>`;
}

function renderTools(n: RunNode): string {
  const s = n.session;
  const calls = s?.sampleToolCalls ?? [];
  if (!calls.length) {
    return `<p class="wt-summary" style="font-style:italic">No clicks needed: the executor read the page,
      found the state this subtask asks for already in place, and declared it complete after a single
      turn of inspection.</p>`;
  }
  const rows = calls
    .map(
      (c, i) => `<div class="wt-tool" style="animation-delay:${0.15 * i + 0.1}s">
        <span class="t-turn">T${c.turn}</span>
        <span class="t-name">${esc(c.tool)}</span>
        <span class="t-args">${esc(JSON.stringify(c.args))}</span>
        <span class="t-result">${esc(clean(c.result ?? (c.success ? "ok" : "failed")))}</span>
      </div>`,
    )
    .join("");
  const total = s?.totalToolCalls ?? 0;
  const shown =
    calls.length < total
      ? `${calls.length} of ${total} page actions shown`
      : `${total} page action${total === 1 ? "" : "s"}`;
  const tokens = (s?.usage?.promptTokens ?? 0) + (s?.usage?.completionTokens ?? 0);
  return `<div class="wt-tools">${rows}</div>
    <div class="wt-facts"><span>${s?.turnCount} turns</span><span>${shown}</span><span>${num(tokens)} tokens</span></div>`;
}

function renderNode(data: RunData, step: Extract<Step, { kind: "node" }>): string {
  const n = step.node;
  const i = step.i;
  const v = n.verifications[n.verifications.length - 1];
  const deterministic = /deterministic/i.test(v?.reason ?? "");
  return `<div class="wt-step">
    <p class="wt-eyebrow">Step ${i + 2} · subtask ${i + 1} of ${data.nodes.length}</p>
    <h2>${esc(clean(n.objective))}</h2>
    <p class="wt-criteria"><b>Success criteria:</b> ${esc(clean(n.successCriteria))}</p>

    <div class="wt-card edge-executor">
      <div class="wt-rolerow">
        ${roleBadge("executor", "EXECUTOR")}
        <span class="wt-model">${esc(n.session?.models?.[0] ?? data.executorModels[0] ?? "")}</span>
        <span class="wt-meta">skill: ${esc(n.skill?.id ?? "—")}</span>
      </div>
      ${renderTools(n)}
    </div>

    <div class="wt-card edge-verifier">
      <div class="wt-rolerow">
        ${roleBadge("verifier", "VERIFIER")}
        <span class="wt-model">${deterministic ? "deterministic contract check" : "completion check"}</span>
      </div>
      <div class="wt-verdict">
        <span class="wt-chip">${esc(v?.decision ?? "accept")}</span>
        <span class="wt-conf">confidence ${(v?.confidence ?? 0).toFixed(2)}</span>
        <span class="wt-conf">· subtask closed in ${secs(n.durationMs ?? 0)}</span>
      </div>
      ${v?.reason ? `<p class="wt-vreason">${esc(clean(v.reason))}</p>` : ""}
      <p class="wt-summary">${esc(clean(n.summary))}</p>
    </div>
  </div>`;
}

function renderFinale(data: RunData, meta: RunMeta, stepCount: number): string {
  const t = data.taskCompleted!.data;
  const mins = Math.floor(t.totalDurationMs / 60000);
  const rem = Math.round((t.totalDurationMs % 60000) / 1000);
  const wf = meta.mode === "workflow";
  const v = wf ? data.nodes[0].verifications[data.nodes[0].verifications.length - 1] : null;
  const tiles: Array<[string, string]> = [
    [`${t.completed}/${data.plan.nodeCount}`, wf ? "workflow verified" : "subtasks verified"],
    [mins > 0 ? `${mins} m ${rem} s` : `${(t.totalDurationMs / 1000).toFixed(1)} s`, "wall-clock time"],
    [String(data.totals.turns), "executor turns"],
    [String(data.totals.toolCalls), wf ? "form operations" : "page actions"],
  ];
  // The trusted-workflow path bypasses per-turn LLM accounting — hide
  // token/cost tiles rather than show a false zero.
  if (t.totalTokens > 0) tiles.push([num(t.totalTokens), "tokens"]);
  if (t.totalCostUsd > 0) tiles.push([`$${t.totalCostUsd.toFixed(2)}`, "total model cost"]);
  return `<div class="wt-step">
    <p class="wt-eyebrow">Step ${stepCount} · task complete</p>
    <div class="wt-card edge-good">
      <h2>${meta.finaleTitle}</h2>
      <p class="wt-lede" style="margin:0">${meta.finaleLede} ${
        wf ? "" : `All ${t.completed} subtasks completed and verified; ${t.failed} failed, ${t.skipped} skipped.`
      }</p>
    </div>
    ${
      wf && v
        ? `<div class="wt-card edge-verifier">
      <div class="wt-rolerow">
        ${roleBadge("verifier", "VERIFIER")}
        <span class="wt-model">deterministic contract check</span>
      </div>
      <div class="wt-verdict">
        <span class="wt-chip">${esc(v.decision ?? "accept")}</span>
        <span class="wt-conf">confidence ${(v.confidence ?? 0).toFixed(2)}</span>
      </div>
      ${v.reason ? `<p class="wt-vreason">${esc(clean(v.reason))}</p>` : ""}
    </div>`
        : ""
    }
    <div class="wt-tiles">
      ${tiles.map(([val, k]) => `<div class="wt-tile"><div class="v">${val}</div><div class="k">${k}</div></div>`).join("")}
    </div>
    <div class="wt-card">
      <div class="wt-rolerow" style="margin:0 0 6px">${roleBadge("planner", "PLANNER")} <span class="wt-model">${esc(data.planner?.model ?? "")}</span></div>
      <div class="wt-rolerow" style="margin:0 0 6px">${roleBadge("executor", "EXECUTOR")} <span class="wt-model">${esc(data.executorModels[0] ?? "")}</span></div>
      <div class="wt-rolerow" style="margin:0">${roleBadge("verifier", "VERIFIER")} <span class="wt-model">deterministic completion-envelope check</span></div>
    </div>
    <p class="wt-foot">Model seats are configurable per role — the three runs on this page were recorded
    weeks apart and show different seat assignments. Run <code>${data.runId.slice(0, 8)}</code> · trace
    recorded by the OpenSidebar orchestrator, replayed here without edits.</p>
  </div>`;
}

/* ---------- shell ---------- */
const stage = document.getElementById("stage")!;
const spine = document.getElementById("spine")!;
const runtabs = document.getElementById("runtabs")!;
const prevBtn = document.getElementById("prev") as HTMLButtonElement;
const nextBtn = document.getElementById("next") as HTMLButtonElement;
const fill = document.getElementById("fill")!;
const count = document.getElementById("count")!;
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

const initialKey = window.location.hash.replace("#", "");
let runIdx = Math.max(
  0,
  runs.findIndex((r) => r.meta.key === initialKey),
);
const progress = runs.map(() => ({ cur: 0, maxSeen: 0 }));

function current() {
  const { data, meta } = runs[runIdx];
  return { data, meta, steps: buildSteps(data, meta), state: progress[runIdx] };
}

function renderTabs(): void {
  runtabs.innerHTML = runs
    .map(
      (r, i) => `<button class="wt-runtab ${i === runIdx ? "active" : ""}" data-r="${i}"
        role="tab" aria-selected="${i === runIdx}">
        ${esc(r.meta.tab)} <span class="n">${esc(r.meta.tabNote ?? r.data.plan.nodeCount + " subtasks")}</span>
      </button>`,
    )
    .join("");
}

function renderSpine(): void {
  const { steps, state } = current();
  spine.innerHTML = steps
    .map((s, i) => {
      const cls = [
        "wt-spine-item",
        i === state.cur ? "active" : "",
        i < state.cur ? "done" : "",
        i > state.maxSeen ? "locked" : "",
      ].join(" ");
      return `<button class="${cls}" data-i="${i}" ${i > state.maxSeen ? 'aria-disabled="true"' : ""} aria-current="${i === state.cur}">
        <span class="wt-rail"><span class="wt-dot"></span><span class="wt-railline"></span></span>
        <span class="wt-spine-label">
          <span class="wt-kicker">${esc(s.spine.kicker)}</span>
          <span class="wt-title">${esc(s.spine.title)}</span>
        </span>
      </button>`;
    })
    .join("");
}

function render(): void {
  const { data, meta, steps, state } = current();
  const s = steps[state.cur];
  stage.innerHTML =
    s.kind === "intro"
      ? renderIntro(data, meta)
      : s.kind === "plan"
        ? meta.mode === "workflow"
          ? renderRecognize(data)
          : renderPlan(data, meta)
        : s.kind === "node"
          ? renderNode(data, s)
          : s.kind === "action"
            ? renderAction(data, meta, s)
            : renderFinale(data, meta, steps.length);
  renderTabs();
  renderSpine();
  prevBtn.disabled = state.cur === 0;
  nextBtn.disabled = state.cur === steps.length - 1;
  nextBtn.textContent = state.cur === steps.length - 2 ? "Finish →" : "Next step →";
  fill.style.width = ((state.cur + 1) / steps.length) * 100 + "%";
  count.textContent = "STEP " + (state.cur + 1) + " / " + steps.length;
  window.scrollTo({ top: 0 });
}

function go(i: number): void {
  const { steps, state } = current();
  if (i < 0 || i >= steps.length || i > state.maxSeen + 1) return;
  state.cur = i;
  state.maxSeen = Math.max(state.maxSeen, state.cur);
  render();
}

function switchRun(i: number): void {
  if (i === runIdx || i < 0 || i >= runs.length) return;
  runIdx = i;
  history.replaceState(null, "", "#" + runs[i].meta.key);
  render();
}

prevBtn.addEventListener("click", () => go(current().state.cur - 1));
nextBtn.addEventListener("click", () => go(current().state.cur + 1));
spine.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>(".wt-spine-item");
  if (b && Number(b.dataset.i) <= current().state.maxSeen) go(Number(b.dataset.i));
});
runtabs.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>(".wt-runtab");
  if (b) switchRun(Number(b.dataset.r));
});
window.addEventListener("hashchange", () => {
  const i = runs.findIndex((r) => r.meta.key === window.location.hash.replace("#", ""));
  if (i >= 0) switchRun(i);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") {
    e.preventDefault();
    go(current().state.cur + 1);
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    go(current().state.cur - 1);
  }
});

render();
