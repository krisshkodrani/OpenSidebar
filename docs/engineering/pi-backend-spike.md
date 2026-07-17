# Pi backend — working notes (paused 2026-07-14)

Working state for the pi-as-optional-backend work. Approved plan:
`~/.claude/plans/what-do-you-know-nested-meteor.md`. Branch `feat/pi-backend`,
worktree `.claude/worktrees/pi-backend`, based on clean `main` (`35968546`).

The main worktree is on `feat/trace-viewer-simplify` with ~31 files of unrelated
WIP — that is why this work lives in its own worktree. Don't merge the two.

## Where we are

| Phase | State |
| --- | --- |
| 0 — contain seed PII | **DONE 2026-07-17** (seed lives outside the repo at `~/.opensidebar/seed/` via `OPENSIDEBAR_SEED_DIR`; synthetic in-repo fixture for offline coverage; design below) |
| 1 — completion seam + bridge repairs | **DONE, committed, verify green; PROVEN in a real browser 2026-07-15** (e2e `tests/e2e/browser-bridge.test.ts`, 26s) |
| 2 — pi extension | **DONE, committed** (`.pi/extensions/opensidebar.ts`; spike answer below) |
| 3 — mission/report handover | **DONE 2026-07-16** (sessions + cancellation; design below) |
| 4 — grounded submit | **DONE 2026-07-16** (approval forwarding; design below) |
| 5 — JobAgent workspace | not started |
| 6 — remove OpenClaw | **DONE 2026-07-16** (see CHANGELOG [Unreleased]; RL-rubric "OpenClaw" in obs engine deliberately untouched) |

## Phase 1 — done (2 commits)

**`f3c2a3e3` fix(runtime): deliver service-worker broadcasts to in-process subscribers**

The headline finding, now proven rather than argued: **the browser bridge had
never completed a task in a real browser.** `chrome.runtime.sendMessage` does not
deliver back to the sending context; the orchestrator broadcasts
`TASK_COMPLETION` from the service worker and `createAgentRuntime` subscribes in
that same service worker, so the completion never arrived and every thick tool
call hung until the MCP host's 120s timeout. The sidepanel was unaffected only
because it is a different context.

- `environment/chrome.ts` — `broadcast()` keeps its chrome send **and** hands off
  to listeners registered via this port's own `onMessage`. `runtime.ts:53` is the
  only such subscriber, so the blast radius is exactly the intended one; code on
  raw `chrome.runtime.onMessage` (`background.ts`) is untouched.
- `orchestrator/task-messaging.ts` — routed through the port (it bypassed it,
  which is why the broadcast was chrome-only); its `payload: any` cast is gone.
- `environment/types.ts` — the self-delivery requirement is now documented on
  `RuntimeMessagingPort` as a contract, not an implementation detail.
- `tests/fakes/environment-events.ts` — the fake honours the same contract.

Why it survived: `chromeRuntimeMessagingPort` had **zero** coverage (`tests/setup.ts`
stubs `sendMessage`/`addListener` as no-ops), and the one test touching the seam
(`tests/headless/runtime-smoke.test.ts`) used a fake port whose `deliver()`
supplied the loopback by fiat. New test `tests/background/messaging-port-delivery.test.ts`
mocks chrome faithfully — `sendMessage` records and never notifies — **with a
canary that fails if that ever stops being true**. Keep the canary.

**`69010ed8` fix(browser-bridge): stop discarding the run's progress handoff**

- `mapCompletion` collapsed `partial`/`stopped`/`failed` into `{status:"error"}`
  and narrowed the payload to `{status?, summary?}`, dropping `partialHandoff`,
  `subtaskResults`, `metrics`, `terminationReason`. **`partial` now maps to
  `needs_human`** — the wire contract already defines that as "paused, may resume
  — NOT an error". The handoff rides along on every status.
- **Fixed an inverted dependency that broke the removability contract**:
  `runtime.ts:18` imported `CompletionPayload` *from* `browser-bridge/`, so the
  generic library API depended on the bridge. It now derives from the shared
  `TaskCompletionMessage` contract.
- Added the missing timeout to `createBrowserAgentRunner` (it hung forever).

Removability now literally holds: `background.ts:12` (import) and `:324` (call)
are the only references outside `browser-bridge/`; the one other mention is a
comment in `runtime.ts:25`.

Verify: 4558 tests pass (5 new), typecheck clean, lint 0 errors, build +
dist-check pass, browser-mcp host's own 11 tests pass.

## Phase 2 — the spike

Read from the **real published package** (`npm pack`, extracted to a scratch dir),
not from the docs. All of this is confirmed from `.d.ts`:

- `@earendil-works/pi-coding-agent@0.80.7`, MIT, `engines.node >= 22.19.0`.
  (Repo is on Node 22+ / v24.12 locally — fine.)
- `export type ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>` —
  the default export of an extension file.
- `registerTool<TParams extends TSchema>(tool: ToolDefinition<TParams>): void`
- `ToolDefinition.parameters: TParams` — **`TSchema` imported `from "typebox"`**,
  i.e. TypeBox **v1**, not `@sinclair/typebox`.
- `execute(toolCallId, params: Static<TParams>, signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback | undefined, ctx: ExtensionContext):
  Promise<AgentToolResult<TDetails>>`
  — **the `AbortSignal` is in the signature**; Phase 3 cancellation hangs off this.
- `prepareArguments?: (args: unknown) => Static<TParams>` — documented "Must
  return an object conforming to TParams", which implies validation happens.
- `core/tools/tool-definition-wrapper.js` passes `parameters` through **verbatim**
  to pi-ai's `AgentTool`. So the coding agent never inspects the schema itself.
- All of pi's own built-in tools declare `parameters: Type.Object({...})` via
  `import { Type } from "typebox"`.
- `defineTool()` exists for the SDK path and exists purely to preserve param
  inference when tools are passed through arrays like `customTools`.

### THE OPEN QUESTION — ANSWERED 2026-07-15: plain JSON Schema works

**Q: does `parameters` accept a plain JSON Schema object, or must it be real TypeBox?**
**A: plain JSON Schema is a first-class, deliberately supported input. No converter.**

It mattered because `scripts/browser-mcp/tools.ts` defines `BROWSER_TOOLS[].inputSchema`
as plain JSON Schema and we want that file to stay the single source of truth.

Validation lives in pi-ai (`dist/utils/validation.js`, `validateToolArguments`), and it
contains an **explicit non-TypeBox branch** — this is the whole answer:

```js
const TYPEBOX_KIND = Symbol.for("TypeBox.Kind");
Value.Convert(tool.parameters, args);
const validator = getValidator(tool.parameters);          // Compile(schema)
if (!Object.getOwnPropertySymbols(tool.parameters).includes(TYPEBOX_KIND)) {
  const coerced = coerceWithJsonSchema(args, tool.parameters);   // hand-written
  ...                                                            // JSON-Schema walker
}
if (validator.Check(args)) return args;
```

`coerceWithJsonSchema` (walks `allOf`/`anyOf`/`oneOf`/`type`) exists **solely** to serve
schemas that lack TypeBox's Kind symbol. Plain JSON Schema isn't tolerated by luck — it's
a supported path with code written for it. `Compile` is typebox v1's, which is built on
standard JSON Schema.

**Verified empirically, not just by reading** (`<scratchpad>/pi-spike/probe.mjs`,
pi-ai 0.80.7 + typebox 1.1.38, real `BROWSER_TOOLS` schemas):

| case | plain JSON Schema | `Type.Object` |
| --- | --- | --- |
| valid args | pass | pass |
| missing required | **throws** | **throws** |
| nested object (`browser_extract_structured`) | pass | — |
| `url: 42` → wrong type | coerced to `"42"` | coerced to `"42"` |
| `url: {a:1}` → uncoercible | **throws** | **throws** |

**The two paths are behaviourally identical, coercion included.** `Value.Convert` runs
before the Kind check, so lenient primitive coercion is pi's deliberate design for LLM
output, not an artifact of the plain path. So: **pass `inputSchema` straight through to
`parameters`. Do not write a converter, do not hand-port the 7 schemas.**

Two things to expect when writing the extension:

- **Types, not runtime.** `registerTool<TParams extends TSchema>` means a plain object
  may not typecheck. Runtime is proven fine; if tsc complains, cast at the single
  registration site — do not reshape `tools.ts` to please the type.
- **Coercion is not a safety boundary.** `42` becomes `"42"` silently. Irrelevant for the
  bridge, but it means Phase 4's byte-match verification must stay pi-side as designed —
  schema validation is not the gate and never was.

### Other Phase 2 notes

- Use `StringEnum` from `@earendil-works/pi-ai` for any enum —
  `Type.Union`/`Type.Literal` breaks Google's API.
- Pin the pi packages; the SDK is young (0.80.x).
- Extension auto-discovery: `.pi/extensions/*.ts` (project-local) or
  `~/.pi/agent/extensions/*.ts` (global); `settings.json` `extensions: [...]`
  takes extra paths; `pi -e ./path.ts` for a one-off.
- Reuse `scripts/browser-mcp/{tools,bridge,ws-bridge}.ts` verbatim —
  `WebSocketBridge implements BrowserBridge` and needs no change.
- Extension flag `opensidebar:browserMcpWsPort` must be set to `8787` in
  `chrome.storage.local`; default-off, no settings UI.

## Phase 3 — DONE 2026-07-16 (sessions + cancellation)

Both deferred items landed together as the mission-protocol change:

- **Session-scoped tab reuse.** `BrowserToolRequest` gained `session?: string` —
  out-of-band transport metadata, minted once per pi process
  (`.pi/extensions/opensidebar.ts` `SESSION`), never in any LLM-facing tool
  schema (`tools.ts` untouched). The driver keeps an in-memory
  `Map<session, {workspaceId, tabId, queue}>`: same session ⇒ same workspace +
  same tab (a `task.url` on a reused session navigates the tab; a dead tab
  falls back to a fresh one, keeping the workspace, so the orchestrator's
  `recentCompletionTracker` context folding still applies). Session tabs are
  deliberately never closed. Sessionless calls behave exactly as before.
- **Runs on one session are SERIALIZED (mandatory, not a nicety).** The
  orchestrator's same-workspace replacement (`startTask` → `stopTask`) does not
  await the graceful stop drain; a follow-up started mid-drain gets its
  `tasksByWorkspace` entry deleted by the old task's finalize and its completion
  listener fed the old "stopped" broadcast. The per-session promise queue in
  `orchestrator-driver.ts` prevents both.
- **Cancellation.** New wire frame host → ext `{ id, cancel: true }` (types in
  `shared-types/browser-bridge.ts`). On abort the host sends the frame and
  resolves the call locally with `BROWSER_TOOL_CANCELED_REASON` ("canceled by
  caller" — the VALUE lives in `scripts/browser-mcp/bridge.ts`, because
  shared-types must stay type-only: the pi loader resolves `ws-bridge.ts` at
  runtime and cannot resolve the `@shared-types` alias; the extension mirrors
  the string in `orchestrator-driver.ts`). Extension side: `ws-client` keeps an
  id → `AbortController` map; the signal threads through
  `handleBrowserToolRequest` → `AgentRunner.run(task, {signal})` → new
  `deps.stopTask(workspaceId)` → new `AgentRuntime.stopTask` →
  `orchestrator.stopTask`. On abort the run does NOT settle early — it waits
  for the stopped completion (bounded by the 600s run timeout), which is what
  keeps the session queue safe. The driver re-checks `signal.aborted` after
  `startTask` resolves to cover an abort that lands mid-start. Pi extension
  forwards its `AbortSignal` into `ws.call` and throws `"<tool> aborted"` after
  a canceled resolution (pi's throw-on-failure convention).
- **Non-goals, deliberate:** closing session tabs on disconnect (the user may be
  reading them); aborting runs on transient socket close (2s reconnects);
  sessions for the MCP-server path (`session` is optional on the wire); mission
  continuity across SW restarts (registry is in-memory; next call gets a fresh
  workspace + tab).

## Phase 4 — grounded submit via approval forwarding (DONE 2026-07-16)

A consequential action (a job-application form submit) is hard-gated: the run
pauses for approval, and `forceApproval` defeats even `bypassApprovals`. Bridge
missions have no sidepanel to answer that pause — the live session proved it
fails at tab-rebind. Phase 4 forwards the approval over the wire instead of
adding an unattended/auto-submit mode.

- **Transport = a NEW `TASK_PAUSED` runtime message**, not a flagged
  TASK_COMPLETION (completion is terminal semantics for ≥4 consumers). Emitted
  from the orchestrator pause branch AFTER `pendingInteraction` is set + the
  timeout armed + the checkpoint persisted — so a caller that answers instantly
  finds resolvable state (kills the answer-before-state race the loop's raw
  `chrome.runtime.sendMessage` APPROVAL_REQUEST would have had). The sidepanel
  ignores TASK_PAUSED (it gets APPROVAL_REQUEST); the bridge driver forwards it.
- **Wire**: `BrowserToolResponse.approval?: ForwardedApprovalRequest`
  (approvalId, toolName, args, context, requestedAt, timeoutMs, expiresAt,
  dryRun?) rides on `needs_human`. The Phase 8 dry-run diff is forwarded
  structured (`ForwardedApprovalDryRun` — entries of expected/actual/status) so
  pi byte-checks the live form against the values it put in the instruction
  before approving. That IS the grounded-submit gate — pi-side, as designed.
- **Answering**: new mechanical tool `browser_respond_approval
  {approvalId, approved}` → `AgentRunner.respondApproval` → the driver joins
  the SAME session queue (a queued mission cannot start mid-resume and stop the
  paused task) → `AgentRuntime.resolveApproval` → `orchestrator.resolveApprovalResponse`,
  which replays the exact gated tool call. On approve the driver awaits the
  workspace's next outcome (completion OR another pause); on a failed resolve
  (unknown/expired/double) it errors fast so the queue never blocks.
- **Timeout**: the loop's default approval window is 30s (loop-metrics.ts) —
  hopeless for a pi→human round trip. `interactionDelivery: "handoff"` on the
  start-input (set by the bridge, copied onto the task, sanitizer-preserved)
  selects `HANDOFF_APPROVAL_TIMEOUT_MS = 600_000` via the existing loop option;
  non-bridge tasks are byte-identical. On expiry the orchestrator auto-denies +
  resumes (existing behavior); the tab fix below makes that resume actually work.
- **The live blocker, fixed generally**: `selectResumeOwnedTab` now rebinds to
  the task's OWN live primary tab by identity even when its URL is non-durable
  (about:blank) — no ambiguity exists for the task's own tab. Not bridge-gated:
  sidepanel tasks paused on about:blank failed identically before.
- **Latent bug fixed en route**: `resolveApprovalResponse` didn't guard against
  a second answer (`isPendingInteractionResolved`) — forwarding made concurrent
  answerers (sidepanel + bridge) real, which would have double-resumed.
- **Ratchet**: net-negative on both guarded files — extracted
  `runFormSubmitDryRun` → `agent/form-submit-dry-run.ts` and
  `emitPendingInteraction`'s body → `orchestrator/pending-interaction.ts`;
  budgets tightened (loop 6821→6766, orchestrator 5775→5758).
- **Deferred (unchanged intent)**: unattended/auto-submit mode +
  `groundedSubmitAuthorization` token; a structured answers-map channel;
  clarification forwarding (approval only this phase). PII note: forwarded
  args/dryRun entries are values pi itself supplied — no new exposure.
- **Landmine correction**: the spike-doc warning about a verifier
  `isRestraintTask` consumer of `classifyConsequentialActionConsentMode` is
  STALE — that consumer does not exist on this branch (grep-verified). The
  classifier's semantics are still left byte-identical (Phase 4 reads only
  `.requiresApproval` and never branches on task text).

## Live pi session findings (2026-07-16, first real pi ↔ extension contact)

Ran real `pi -p` (Fireworks minimax-m3 brain) against the branch extension in
a seeded throwaway Chrome. Result: **loop proven end-to-end except unattended
completion** — pi loaded all 7 tools (project-local extensions need `-a`
trust!), called `browser_run_task` with clean instructions, the extension
connected and ran a real 2.5-minute agent mission, structured errors
propagated back, and pi reported honestly (no fabrication). Findings, all
Phase-4-relevant:

1. **Bridge missions are incompatible with interactive safety gates today.**
   With approvals/plan-confirmation at defaults, the mission paused for a
   user interaction that has no surface (bridge tasks bind no sidepanel),
   then `resumeTaskAfterInteraction` failed rebinding ("No usable live
   workspace tab"). Phase 4 needs either approval forwarding over the wire
   (pi asks the human) or an explicit unattended mode on the request.
2. **Cold-start race:** the extension reconnects every 2s, so pi's FIRST tool
   call within ~2s of server start gets "not connected". Options: brief
   connect-grace in `WebSocketBridge.call`, or a retry hint in the tool
   description. (Pi recovered by pinging and retrying on its own.)
3. **MV3 idle suspension kills the reconnect loop** — an idle extension never
   connects to a late-starting server without a wake. The e2e harness never
   sees this (fresh SW per launch); real usage needs the keepalive alarm
   paired with the bridge (ws-client doc already says so) — verify it exists.
4. **`pi -p` never exited** while the extension hosted the WS server — fixed:
   the bridge server is now `unref()`ed (ws-bridge.ts) so it cannot hold the
   host process open.

## Landmines for whoever resumes

- **Don't touch `classifyConsequentialActionConsentMode`'s semantics.**
  (Phase 4 note: the claimed `orchestrator/verifier.ts` `isRestraintTask`
  consumer does NOT exist on this branch — grep-verified. The rule still holds
  as prudence, and Phase 4 obeyed it: it reads only `.requiresApproval` and
  never branches on task text.)
- **Job-application submits are hard-gated** — `assessConsequentialActionApproval`
  forces approval and defeats `bypassApprovals` (`loop.ts:2562-2563`). Phase 4
  did NOT relax the gate; it forwards the approval to pi's human instead (see the
  Phase 4 section above). A grounded auto-submit token remains deferred.
- ~~**`.artifacts/seed/` holds real PII** (name, email, phone, address, 11 CVs)
  behind only the blanket `.artifacts/` rule.~~ **Done (Phase 0, 2026-07-17):**
  the seed moved OUT of the repo tree to `~/.opensidebar/seed/` (resolved via
  `OPENSIDEBAR_SEED_DIR`, default that home path — mirrors the
  `OPENSIDEBAR_PROFILE_PATH` profile store). The seed was already decoupled from
  code (only the `E2E_LIVE_APP_KIT` env var located it); `tests/e2e/helpers/seed.ts`
  now centralizes resolution/loading, `showcase-live-application.test.ts` finds
  the kit via the default with no env var, a committed SYNTHETIC kit
  (`tests/e2e/fixtures/live-app-kit/`, fabricated identity) gives offline
  PII-free coverage (`tests/background/seed-kit.test.ts`), and `.gitignore` gained
  an explicit `.artifacts/seed/` belt-and-braces rule. Real PII is no longer one
  ignore line from a leak.
- ~~`tests/background/agent-runner.test.ts` imports `browser-bridge/agent-runner.ts`
  — both go together in Phase 6.~~ Done: both deleted with the Phase 6 removal.
