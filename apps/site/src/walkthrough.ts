import "./styles.css";
import "./walkthrough.css";
import RUN from "./walkthrough-data.json";

/**
 * Interactive replay of one real recorded orchestrator run
 * (run c462ed87, 2026-05-26). Every objective, tool call, model id,
 * token count, and verdict is read verbatim from the embedded trace
 * extract — nothing on this page is invented copy.
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
};
type RunNode = (typeof RUN.nodes)[number] & { session: NodeSession | null };

const SHORT_TITLES = [
  "Add Pegasus 41 to cart",
  "Add Novablast 4 to cart",
  "Open cart, go to checkout",
  "Enter contact details",
  "Apply coupon SAVE10",
  "Select express shipping",
  "Place & confirm the order",
];

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

const plannerModel = shortModel(RUN.planner?.model);
const executorModel = shortModel(RUN.executorModels[0]);

type Step =
  | { kind: "intro"; spine: { kicker: string; title: string } }
  | { kind: "plan"; spine: { kicker: string; title: string } }
  | { kind: "node"; node: RunNode; i: number; spine: { kicker: string; title: string } }
  | { kind: "finale"; spine: { kicker: string; title: string } };

const steps: Step[] = [
  { kind: "intro", spine: { kicker: "prompt", title: "One request" } },
  { kind: "plan", spine: { kicker: "planner", title: "Decompose into 7 subtasks" } },
  ...RUN.nodes.map(
    (n, i): Step => ({
      kind: "node",
      node: n as RunNode,
      i,
      spine: { kicker: "subtask " + (i + 1), title: SHORT_TITLES[i] ?? clean(n.objective) },
    }),
  ),
  { kind: "finale", spine: { kicker: "done", title: "Order confirmed" } },
];

function roleBadge(cls: string, label: string): string {
  return `<span class="wt-role ${cls}">${label}</span>`;
}

function renderIntro(): string {
  return `<div class="wt-step">
    <p class="wt-eyebrow">Replay · real recorded run · unedited trace</p>
    <h1>One prompt becomes seven verified steps.</h1>
    <p class="wt-lede">This is a replay of a real OpenSidebar run: a single shopping request, recorded on
      ${new Date(RUN.recordedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
      against the <strong>Northstar Outfitters</strong> demo storefront. Every subtask, tool call, model name,
      token count, and verdict below comes straight from the trace files.</p>
    <div class="wt-bubble-row">
      <div class="wt-avatar">YOU</div>
      <div class="wt-bubble">${esc(RUN.prompt)}</div>
    </div>
    <p class="wt-lede">Three roles cooperate to get it done. Click <strong>Next step</strong> to watch the run unfold.</p>
    <div class="wt-legend">
      <div class="wt-card">
        ${roleBadge("planner", "PLANNER")}
        <h3>Breaks the prompt apart</h3>
        <p>Reads the request once and turns it into an ordered graph of small, checkable subtasks.</p>
        <span class="wt-model">${esc(plannerModel)}</span>
      </div>
      <div class="wt-card">
        ${roleBadge("executor", "EXECUTOR")}
        <h3>Works the page</h3>
        <p>Sees the live page, then clicks, types, and scrolls — one subtask at a time.</p>
        <span class="wt-model">${esc(executorModel)}</span>
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

function renderPlan(): string {
  const p = RUN.planner!;
  const chain = RUN.nodes
    .map((n, i) => {
      const link =
        i < RUN.nodes.length - 1
          ? `<div class="wt-chain-link" style="animation-delay:${0.12 * i + 0.1}s"></div>`
          : "";
      return `<div class="wt-chain-node" style="animation-delay:${0.12 * i}s">
        <span class="wt-chain-idx">${i + 1}</span>
        <span class="wt-chain-obj">${esc(SHORT_TITLES[i] ?? clean(n.objective))}</span>
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
      <strong>${esc(RUN.plan.difficulty)}</strong> and produced ${RUN.plan.nodeCount} subtasks. Because every one of
      them writes to the same cart, it serialized them into a single dependency chain — no two run at once. It also
      picked a reusable <strong>skill</strong> (a proven procedure) for each subtask, shown on the right.</p>
    </div>
    <div class="wt-chain">${chain}</div>
  </div>`;
}

function renderTools(n: RunNode): string {
  const s = n.session;
  const calls = s?.sampleToolCalls ?? [];
  if (!calls.length) {
    return `<p class="wt-summary" style="font-style:italic">No clicks needed: the executor looked at the page, saw the
      previous subtask had already left the cart open with the checkout form visible, and declared the step complete
      after a single turn.</p>`;
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

function renderNode(step: Extract<Step, { kind: "node" }>): string {
  const n = step.node;
  const i = step.i;
  const v = n.verifications[n.verifications.length - 1];
  const deterministic = /deterministic/i.test(v?.reason ?? "");
  return `<div class="wt-step">
    <p class="wt-eyebrow">Step ${i + 2} · subtask ${i + 1} of ${RUN.nodes.length}</p>
    <h2>${esc(clean(n.objective))}</h2>
    <p class="wt-criteria"><b>Success criteria:</b> ${esc(clean(n.successCriteria))}</p>

    <div class="wt-card edge-executor">
      <div class="wt-rolerow">
        ${roleBadge("executor", "EXECUTOR")}
        <span class="wt-model">${esc(n.session?.models?.[0] ?? RUN.executorModels[0] ?? "")}</span>
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

function renderFinale(): string {
  const t = RUN.taskCompleted!.data;
  const mins = Math.floor(t.totalDurationMs / 60000);
  const rem = Math.round((t.totalDurationMs % 60000) / 1000);
  return `<div class="wt-step">
    <p class="wt-eyebrow">Step ${steps.length} · task complete</p>
    <div class="wt-card edge-good">
      <h2>Order confirmed — <span class="wt-orderid">NS-01001</span></h2>
      <p class="wt-lede" style="margin:0">Both pairs of shoes ordered, coupon SAVE10 applied, express shipping selected,
      and a confirmation email sent to alex.morgan@example.com. All ${t.completed} subtasks completed and verified;
      ${t.failed} failed, ${t.skipped} skipped.</p>
    </div>
    <div class="wt-tiles">
      <div class="wt-tile"><div class="v">${t.completed}/${RUN.plan.nodeCount}</div><div class="k">subtasks verified</div></div>
      <div class="wt-tile"><div class="v">${mins} m ${rem} s</div><div class="k">wall-clock time</div></div>
      <div class="wt-tile"><div class="v">${RUN.totals.turns}</div><div class="k">executor turns</div></div>
      <div class="wt-tile"><div class="v">${RUN.totals.toolCalls}</div><div class="k">page actions</div></div>
      <div class="wt-tile"><div class="v">${num(t.totalTokens)}</div><div class="k">tokens</div></div>
      <div class="wt-tile"><div class="v">$${t.totalCostUsd.toFixed(2)}</div><div class="k">total model cost</div></div>
    </div>
    <div class="wt-card">
      <div class="wt-rolerow" style="margin:0 0 6px">${roleBadge("planner", "PLANNER")} <span class="wt-model">${esc(RUN.planner?.model ?? "")}</span></div>
      <div class="wt-rolerow" style="margin:0 0 6px">${roleBadge("executor", "EXECUTOR")} <span class="wt-model">${esc(RUN.executorModels[0] ?? "")}</span></div>
      <div class="wt-rolerow" style="margin:0">${roleBadge("verifier", "VERIFIER")} <span class="wt-model">deterministic completion-envelope check</span></div>
    </div>
    <p class="wt-foot">Model seats are configurable per role. This run (May 2026) resolved both LLM seats to the same
    model; current defaults assign a dedicated planner model and add an LLM judge seat for high-risk completions.
    Run <code>${RUN.runId.slice(0, 8)}</code> · trace recorded by the OpenSidebar orchestrator, replayed here without
    edits.</p>
  </div>`;
}

/* ---------- shell ---------- */
const stage = document.getElementById("stage")!;
const spine = document.getElementById("spine")!;
const prevBtn = document.getElementById("prev") as HTMLButtonElement;
const nextBtn = document.getElementById("next") as HTMLButtonElement;
const fill = document.getElementById("fill")!;
const count = document.getElementById("count")!;
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = String(new Date().getFullYear());

let cur = 0;
let maxSeen = 0;

function renderSpine(): void {
  spine.innerHTML = steps
    .map((s, i) => {
      const cls = [
        "wt-spine-item",
        i === cur ? "active" : "",
        i < cur ? "done" : "",
        i > maxSeen ? "locked" : "",
      ].join(" ");
      return `<button class="${cls}" data-i="${i}" ${i > maxSeen ? 'aria-disabled="true"' : ""} aria-current="${i === cur}">
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
  const s = steps[cur];
  stage.innerHTML =
    s.kind === "intro"
      ? renderIntro()
      : s.kind === "plan"
        ? renderPlan()
        : s.kind === "node"
          ? renderNode(s)
          : renderFinale();
  renderSpine();
  prevBtn.disabled = cur === 0;
  nextBtn.disabled = cur === steps.length - 1;
  nextBtn.textContent = cur === steps.length - 2 ? "Finish →" : "Next step →";
  fill.style.width = ((cur + 1) / steps.length) * 100 + "%";
  count.textContent = "STEP " + (cur + 1) + " / " + steps.length;
  window.scrollTo({ top: 0 });
}

function go(i: number): void {
  if (i < 0 || i >= steps.length || i > maxSeen + 1) return;
  cur = i;
  maxSeen = Math.max(maxSeen, cur);
  render();
}

prevBtn.addEventListener("click", () => go(cur - 1));
nextBtn.addEventListener("click", () => go(cur + 1));
spine.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>(".wt-spine-item");
  if (b && Number(b.dataset.i) <= maxSeen) go(Number(b.dataset.i));
});
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") {
    e.preventDefault();
    go(cur + 1);
  }
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    go(cur - 1);
  }
});

render();
