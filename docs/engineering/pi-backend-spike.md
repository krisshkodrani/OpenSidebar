# Pi backend — working notes (paused 2026-07-14)

Working state for the pi-as-optional-backend work. Approved plan:
`~/.claude/plans/what-do-you-know-nested-meteor.md`. Branch `feat/pi-backend`,
worktree `.claude/worktrees/pi-backend`, based on clean `main` (`35968546`).

The main worktree is on `feat/trace-viewer-simplify` with ~31 files of unrelated
WIP — that is why this work lives in its own worktree. Don't merge the two.

## Where we are

| Phase | State |
| --- | --- |
| 0 — contain seed PII | **not started** |
| 1 — completion seam + bridge repairs | **DONE, committed, verify green** |
| 2 — pi extension | spike ~90%, **blocked on one unanswered question** (below) |
| 3 — mission/report handover | not started (has deferred work queued into it) |
| 4 — grounded submit | not started |
| 5 — JobAgent workspace | not started |
| 6 — remove OpenClaw | not started |

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

### THE ONE OPEN QUESTION (resume here)

**Does `parameters` accept a plain JSON Schema object, or must it be a real
TypeBox schema?**

It matters because `scripts/browser-mcp/tools.ts` defines `BROWSER_TOOLS[].inputSchema`
as plain JSON Schema, and that file is the single source of truth we want to keep.

- Evidence it will work: `typebox` v1 is the rewrite built around **standard JSON
  Schema**, and the coding-agent passes `parameters` straight through.
- Evidence to check: validation lives in **pi-ai**, and a plain object lacks
  TypeBox's `Symbol(Kind)`. If pi-ai runs `Value.Check`/`Compile` on tool args,
  a plain object may fail.

**Blocked on:** every `npm pack @earendil-works/pi-ai@0.80.7` attempt returned
*"claude-opus-4-8[1m] is temporarily unavailable, so auto mode cannot determine
the safety of Bash"* — a transient classifier failure, not a permission denial
(plain `ls`/`echo` succeeded throughout). Retry should just work.

**Next command:**

```bash
cd <scratchpad>/pi-spike        # already holds package/ = pi-coding-agent 0.80.7
npm pack @earendil-works/pi-ai@0.80.7 && tar -xzf earendil-works-pi-ai-0.80.7.tgz
# then: does it Value.Check / Compile tool params, or only serialize them?
grep -rn "Value\.\|Compile(\|parameters" package/dist/**/*.js | grep -i "tool\|check\|valid"
```

Better still, settle it empirically: register one tool with a plain JSON Schema
and one with `Type.Object`, and see whether pi accepts both.

**Decision tree:**

- Plain JSON Schema accepted → pass `inputSchema` straight to `parameters`. No
  converter. Preferred: least mechanism, `tools.ts` stays the single source.
- Rejected → write **one** JSON-Schema→TypeBox converter (~15 lines, `Type.Object`
  over `inputSchema.properties` + `required`). Do **not** hand-port 7 schemas into
  TypeBox — that duplicates `BROWSER_TOOLS` and they will drift.

Do not ship the converter defensively "just in case" — that is exactly the
unnecessary mechanism the review pushed back on. Answer the question first.

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

## Deferred into Phase 3 (was Phase 1 in the plan)

Both moved deliberately — read before "fixing" them:

- **Tab lifecycle.** `createBrowserAgentRunner` opens a background tab per run and
  never closes it (a real leak). **Do not close it eagerly**: Mission B (submit)
  must land on the page Mission A (fill) left behind, so eager close destroys the
  continuity the whole submit gate depends on. Correct fix is session-scoped tab
  reuse keyed by workspace — Phase 3 protocol work.
- **Cancellation.** pi's `AbortSignal` → `STOP_AGENT` needs a cancel frame on the
  wire plus `AgentRuntime.stopTask`. Belongs with the mission protocol.

## Landmines for whoever resumes

- **Don't touch `classifyConsequentialActionConsentMode`'s semantics** in Phase 4.
  It has a live second consumer at `orchestrator/verifier.ts:146` (`isRestraintTask`),
  fixed as recently as `2bc95f70`. Add a new typed `consentMode` on
  `OrchestratorStartInput` that overrides at the gate only; absent it, classify
  from text exactly as today. Note `isRestraintTask` has no test of its own.
- **Job-application submits are hard-gated today** and cannot be automated:
  `assessConsequentialActionApproval` forces approval and defeats even
  `bypassApprovals` (`loop.ts:2563`). Phase 4 must resolve this or auto-submit
  cannot exist.
- **`.artifacts/seed/` holds real PII** (name, email, phone, address, 11 CVs)
  behind only the blanket `.artifacts/` rule at `.gitignore:69`. Phase 0.
- `tests/background/agent-runner.test.ts` imports `browser-bridge/agent-runner.ts`
  — both go together in Phase 6.
