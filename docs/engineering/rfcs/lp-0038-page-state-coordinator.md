# LP-38 — Revisioned Page State Coordinator

Status: Verification; phases 1-2 implemented, production cutover gated
Date: 2026-08-29
Decision date: 2026-08-29 (owner approved the RFC in session)
Related: LP-9 (screenshot pipeline), LP-10 (DOM element diffs), LP-11
(unified-VL default), LP-13 (region inspection), LP-15/LP-16 (runtime
boundaries and decomposition), LP-36 (ModelBench-100)

## Problem

OpenSidebar already collects the information needed to ground browser actions,
but no single runtime component owns one authoritative page observation.

- The content script produces DOM snapshots and stable element tags.
- The agent context stores the current snapshot and executor screenshot;
- `PerceptionScreenshotState` separately retains the last screenshot for
  turn preparation and traces;
- screenshot capture has its own fingerprint cache;
- post-tool refresh, mutation evidence, stagnation, completion, and navigation
  each compare related but independently obtained state.

This fragmentation permits several classes of ambiguity:

1. A DOM snapshot and screenshot can describe different moments on a dynamic
   page.
2. A page can change while the executor is thinking, after it selected an
   element but before the tool call executes.
3. A tool result, post-action DOM refresh, screenshot, and completion evidence
   do not share one revision or provenance chain.
4. Screenshot capture failure or reuse can be represented independently from
   DOM freshness, making it harder to distinguish an intentional fallback from
   stale multimodal state.
5. The verifier can receive a narrative of an action's effect without a single
   typed receipt identifying the before state, after state, and evidence.

The perception benchmark reinforces this diagnosis. The tested models can
answer the direct screenshot questions while some integrated runs still fail.
That makes observation delivery, grounding, action effects, and verification a
more promising integration target than adding another always-on perception
model.

Earlier OpenSidebar versions did have a dedicated perception-model seat. That
seat has been removed: current structured mode is model-free, and unified-VL
sends the screenshot directly to the executor. This RFC must not restore the
removed free-form Page Interpretation agent under a new name.

## Decision requested

Introduce a deterministic, revisioned `PageStateCoordinator` as the canonical
owner of page observations used by one agent run. Adopt it in stages, first in
shadow mode and then as the sole state path only if a controlled ModelBench
comparison passes the acceptance gates in this RFC.

The coordinator is an internal runtime collaborator, not an autonomous agent or
new model seat. The executor remains responsible for choosing actions. The
completion pipeline remains the only authority for declaring task completion.

Do not add executor-visible tools, settings, prompts, or a user-selectable
runtime mode in the initial consolidation.

## Goals

- Give each executor turn one immutable, provenance-bearing page observation.
- Bind grounded actions to the exact document state on which they were chosen.
- Reject stale actions before they mutate the page.
- Join tool outcomes, DOM changes, visual evidence, and navigation into one
  typed action receipt.
- Preserve the current unified-VL and structured-mode behavior while removing
  duplicate state ownership.
- Make capture, delivery, grounding, action, and verification failures easier
  to classify in traces and ModelBench.
- Keep the implementation reusable across the extension, overlay, and future
  browser-page environments by composing the existing small ports.

## Non-goals

- A continuously running Page Manager LLM that summarizes every page turn.
- Moving planning, action selection, tool execution, or completion authority
  into the coordinator.
- A new `BrowserAdapter` hierarchy or replacement for `BrowserPagePort` and
  `ContentBridgePort`.
- Pixel-perfect atomic capture of a live web page; the contract detects and
  reports inconsistency rather than claiming browser-level transactions.
- Full-page stitching, video understanding, or continuous screenshot capture.
- Benchmark-specific runtime behavior, fixture selectors, expected values, or
  task-ID branches.
- New user-facing settings or a permanent compatibility mode.

## Architecture

### Ownership and communication

The agent loop mediates all communication. The executor does not converse with
the coordinator directly.

1. The coordinator settles the page and produces a `PageObservation`.
2. Turn preparation projects that observation into the existing DOM text and,
   when selected by perception policy, the existing image content block.
3. The executor returns the same structured tool calls it returns today.
4. The runtime stamps grounded calls with the observation basis; the model is
   not asked to copy revision identifiers.
5. Before a page mutation, the content script validates the expected document
   identity and mutation epoch.
6. After execution, the coordinator settles and observes again, then emits an
   `ActionReceipt` joining the tool result to the before and after observations.
7. The next turn, mutation ledger, stagnation monitor, trace recorder, and
   completion pipeline consume projections of that shared receipt.

The two logical channels are therefore typed and directional:

- coordinator to executor: page facts and prior action evidence;
- executor to coordinator: an action intent, mediated and stamped by trusted
  runtime code.

Free-form prose produced by a model is never the canonical page state.

### Internal contracts

The exact TypeScript placement is an implementation detail, but the runtime
contract must preserve these semantics:

```ts
interface ObservationBasis {
  observationRevision: number;
  documentInstanceId: string;
  mutationEpoch: number;
  snapshotFingerprint: string;
}

interface PageObservation {
  basis: ObservationBasis;
  capturedAt: number;
  url: string;
  title: string;
  dom: {
    snapshot: DomSnapshot;
    source: "fresh" | "reused";
  };
  image?: {
    artifactId: string;
    sha256: string;
    width: number;
    height: number;
    scaleFactor: number;
    detail: "low" | "high";
    source: "fresh" | "reused";
  };
  consistency: "consistent" | "inconsistent" | "dom_only";
  consistencyReason?: string;
}

interface GroundedActionBasis {
  observationRevision: number;
  documentInstanceId: string;
  mutationEpoch: number;
}

interface ActionReceipt {
  actionId: string;
  status: "executed" | "failed" | "stale" | "uncertain";
  before: ObservationBasis;
  after?: ObservationBasis;
  effect: {
    documentChanged: boolean;
    urlChanged: boolean;
    domChanged: boolean;
    visualChanged: "changed" | "unchanged" | "not_observed";
  };
  toolResultRef?: string;
  evidenceRefs: string[];
  reason?: string;
}
```

`observationRevision` is monotonic and scoped to one run. It is not a browser
tab ID and is safe to use in adapter-neutral traces. A new observation revision
is created whenever the coordinator accepts a newly captured bundle, including
DOM-only fallback observations.

`documentInstanceId` is generated by the content script once per document and
changes on navigation or document replacement. `mutationEpoch` is a monotonic
counter maintained by a long-lived content-script observer. OpenSidebar-owned
presence and capture choreography must not advance it.

The screenshot data URL may remain in private in-memory state, but portable
receipts and trajectories carry only the artifact reference and metadata.

### Synchronized observation protocol

The content protocol extends snapshot and readiness responses with
`documentInstanceId` and `mutationEpoch`. Observation capture follows this
sequence:

1. wait for the existing DOM readiness policy;
2. request a fresh DOM snapshot and record its document identity, epoch,
   viewport, scroll position, URL, and fingerprint;
3. if perception policy selects vision, suspend OpenSidebar presence and
   capture/transform the visible screenshot through the existing screenshot
   pipeline;
4. probe readiness/state again;
5. accept a multimodal observation as `consistent` only when document identity,
   mutation epoch, URL, viewport, and scroll geometry still match;
6. retry the bundle once when they do not match, then return an explicit
   `inconsistent` or `dom_only` observation according to the existing fallback
   policy.

This is optimistic consistency detection, not a page freeze. Canvas-bearing
pages remain exempt from DOM-fingerprint screenshot reuse because their pixels
can change without a DOM mutation. A reused screenshot is valid only when the
current document basis and the existing reuse policy both match.

### Stale-action enforcement

Turn preparation snapshots the active observation basis. The dispatcher stamps
each DOM-grounded tool request with its `documentInstanceId` and
`mutationEpoch`. Immediately before resolving or mutating the target, the
content script compares them with the live document basis.

On mismatch it returns a typed `stale_observation` result without performing
the action. The loop refreshes through the coordinator and asks the executor to
choose again. Existing stale-element checks remain defense in depth.

Browser-level navigation actions that do not depend on page grounding do not
require an epoch match. Coordinate and visual-region actions do require a fresh
basis, even when no DOM element is referenced.

### Action receipts and downstream projections

The receipt records observed evidence, not inferred success. In particular,
`visualChanged` is `not_observed` when no comparable screenshot exists; absence
of a screenshot must never be represented as visual equality.

Existing consumers receive narrow projections:

- executor context receives the current observation and concise prior action
  outcome in today's prompt shape;
- the mutation ledger receives the receipt and DOM evidence;
- stagnation uses the accepted observation fingerprint;
- completion receives evidence references and effect classifications, but
  still independently accepts or rejects completion;
- traces record observation/receipt metadata and separately store screenshot
  artifacts.

`AgentContext` becomes a projection consumer. It must not remain a second
mutable source of page truth after cutover. `PerceptionScreenshotState` and
parallel screenshot/snapshot refresh state are removed once every consumer has
migrated.

### Runtime boundaries

The coordinator belongs to reusable background agent behavior and composes
`BrowserPagePort` and `ContentBridgePort`. It does not absorb unrelated tab,
storage, lifecycle, or UI operations. Chrome-specific capture and content
messaging move behind existing ports where the touched path already has a port.

The overlay and test harness may provide page/content port implementations and
observe coordinator output. They must not reproduce coordinator policy or
encode task behavior.

## Delivery

### Phase 1 — Shadow observations

- Add the contracts, document identity/epoch metadata, coordinator, and trace
  events.
- Mirror current refreshes into the coordinator without changing prompts,
  tool execution, screenshot selection, or completion behavior.
- Compare coordinator observations with current context/screenshot state and
  report disagreement, consistency retries, and additional latency.

### Phase 2 — Authoritative internal path

- Put the coordinator behind an internal development flag and make it the
  source for turn preparation, post-tool refresh, and action receipts.
- Enable stale-action rejection for grounded page tools.
- Preserve executor-visible tools, prompt format, perception settings, image
  detail policy, and screenshot budget behavior.
- Run the controlled comparison below before changing the default path.

### Phase 3 — Cutover and cleanup

- Make the coordinator the only production page-state path after the adoption
  gate passes.
- Remove the internal flag, legacy refresh ownership, and superseded
  screenshot state rather than keeping permanent dual paths.
- Update perception, agent-loop, content-protocol, runtime-boundary, tool, and
  trace documentation to describe the shipped contract. Correct the stale
  statement that structured mode still returns a model-generated five-section
  interpretation.

### Optional follow-up — Selective visual specialist

After coordinator cutover, classify residual failures before adding another
model call. A bounded visual specialist experiment is permitted only for
canvas, OCR, region-detail, or DOM/image-disagreement cases that remain
material.

It must be on-demand, return evidence tied to an image artifact/region, and
never maintain independent page memory or run on every turn. Production
adoption requires its own recorded measurement and owner decision; this RFC
does not authorize an always-on Page Manager seat.

## Measurement and adoption gate

Compare the current runtime with the authoritative coordinator path while
holding target, case version, seed, provider, executor, planner, judge,
perception mode, temperature, and limits constant.

- Primary comparison: ModelBench `standard-50`, three repeats per arm.
- Confirmation: ModelBench `full-100`, one repeat on the candidate path.
- Include the canonical perception cases and targeted dynamic cases covering
  SPA rerenders, delayed content, canvas-only changes, overlays, iframe state,
  navigation, tab changes, and mutation during model latency.
- Keep discarded provider/harness attempts in retry lineage and apply LP-36's
  attempt classifications.

The coordinator becomes the default only if all of the following hold:

- at least 98 percent valid harness coverage;
- overall pass@1 is no more than 2 absolute percentage points below baseline;
- the targeted grounding/recovery subset improves by at least 5 absolute
  points, or confirmed stale-action/evidence failures fall by at least 25
  percent relative;
- no confirmed stale grounded action is executed;
- coordinator-only mode adds no LLM calls;
- median end-to-end wall time regresses by no more than 5 percent;
- image prompt tokens remain within 2 percent of baseline under the same image
  selection policy;
- direct-perception and capture-integrity results show no unexplained
  regression.

If a gate fails, keep the current production path, retain only non-invasive
instrumentation useful for diagnosis, and record the result before revising or
parking the RFC. Do not weaken the gates by special-casing benchmark tasks.

## Verification

- Unit tests for observation revision advancement, snapshot/screenshot
  consistency, unchanged-page reuse, canvas reuse exclusion, DOM-only fallback,
  capture failure, and single-retry behavior.
- Content-protocol tests for document identity, mutation epoch advancement,
  exclusion of OpenSidebar-owned mutations, navigation reset, and stale action
  rejection before execution.
- Agent-loop tests proving the dispatcher stamps the trusted basis, executor
  tool schemas remain unchanged, receipts reach downstream consumers, and the
  completion pipeline remains authoritative.
- Integration tests for SPA rerender during model latency, delayed rendering,
  overlay capture, navigation, same-origin iframe interaction, tab changes,
  coordinate actions, and visual-only canvas updates.
- Trace tests proving portable observation and receipt records contain no tab
  IDs or screenshot data URLs and link to the correct screenshot artifact.
- The A/B report under `.artifacts/modelbench/` during iteration and a stable
  acceptance summary under `docs/evals/` before cutover.
- `pnpm run verify` and the affected ModelBench suites pass.

## Risks and guardrails

- Extra probes can add latency. Shadow telemetry and the 5 percent adoption
  ceiling prevent an unmeasured tax on every turn.
- Mutation epochs can produce false staleness on animated or noisy pages.
  Ignore extension-owned changes and retain one bounded re-observation path;
  never silently execute after a mismatch.
- Two state owners would make the architecture worse. Shadow mode is temporary,
  and successful cutover deletes superseded ownership.
- Stronger receipts could tempt completion code to equate change with success.
  Receipts are evidence only; the completion pipeline keeps final authority.
- An additional model could add latency, cost, disagreement, and prompt-
  injection exposure. No always-on Page Manager model is allowed.
- The coordinator could become a god object. Keep policy in focused observation,
  consistency, action-basis, and receipt modules behind a small coordinator
  surface; do not move unrelated browser or agent behavior into it.

## Recommended Decision

This is an agent recommendation, not an owner Decision Stamp. No product
implementation may begin until the owner records the complete `## Decision`
block required by the RFC decision process.

Recommended status: Approved

Recommended chosen path:

- Implement the deterministic, revisioned Page State Coordinator in shadow
  mode, then behind an internal authoritative-path flag.
- Adopt it as the sole production page-state path only after every measurement
  and verification gate in this RFC passes; remove the superseded parallel
  state owners after cutover.
- Keep model perception in the executor. Treat any selective visual specialist
  as a separately measured, owner-decided follow-up.

Recommended required edits before implementation:

- None.

Recommended non-blocking follow-ups:

- Run the bounded visual-specialist experiment only if post-cutover failure
  classification shows a material residual visual-only bottleneck.

Recommended do not do:

- Do not add an always-on Page Manager LLM or free-form agent-to-agent dialogue.
- Do not create a second completion authority or let an action receipt declare
  the user objective complete.
- Do not introduce a giant browser adapter, permanent dual state paths, new
  user settings, or new executor-visible tools for the initial consolidation.
- Do not add benchmark IDs, seeds, prompts, selectors, or hidden expectations to
  product behavior.
- Do not claim a synchronized observation is consistent when its document
  identity, mutation epoch, URL, viewport, or scroll geometry changed during
  capture.

Recommended evidence required before merge:

- Complete every item in this RFC's Verification section and pass every
  Measurement and adoption gate before the production cutover.

Recommended next action: Implement

## Decision

Status: Approved

Chosen path:

- Implement the deterministic, revisioned Page State Coordinator in shadow
  mode, then behind an internal authoritative-path flag.
- Adopt it as the sole production page-state path only after every measurement
  and verification gate in this RFC passes; remove the superseded parallel
  state owners after cutover.
- Keep model perception in the executor. Treat any selective visual specialist
  as a separately measured, owner-decided follow-up.

Required edits before implementation:

- None.

Non-blocking follow-ups:

- Run the bounded visual-specialist experiment only if post-cutover failure
  classification shows a material residual visual-only bottleneck.

Do not do:

- Do not add an always-on Page Manager LLM or free-form agent-to-agent dialogue.
- Do not create a second completion authority or let an action receipt declare
  the user objective complete.
- Do not introduce a giant browser adapter, permanent dual state paths, new
  user settings, or new executor-visible tools for the initial consolidation.
- Do not add benchmark IDs, seeds, prompts, selectors, or hidden expectations to
  product behavior.
- Do not claim a synchronized observation is consistent when its document
  identity, mutation epoch, URL, viewport, or scroll geometry changed during
  capture.

Evidence required before merge:

- Complete every item in this RFC's Verification section and pass every
  Measurement and adoption gate before the production cutover.

Next action:

- Implement

## Implementation status

Phases 1 and 2 are implemented behind the internal
`VITE_PAGE_STATE_COORDINATOR_MODE` build flag. The production default remains
`shadow`; `authoritative` enables consistency enforcement and stale-action
rejection for controlled evaluation only.

Implemented evidence includes content-document identity and mutation epochs,
revision-bound DOM/image observations, trusted action bases, stale mutation
guards, action receipts, receipt projections into the mutation/completion
paths, portable trace records, and removal of the superseded
`PerceptionScreenshotState` owner.

The focused coordinator/protocol tests, extension typecheck, lint, and
production build pass. A preliminary matched-case ModelBench smoke produced a
valid pass in both modes with no confirmed stale action executed. That smoke is
diagnostic only: the required repeated `standard-50`, candidate `full-100`, and
targeted dynamic-case comparison has not yet been completed, so it does not
authorize Phase 3 or removal of the internal flag. Iteration artifacts are kept
under `.artifacts/modelbench/lp-0038/`; no stable `docs/evals/` acceptance
summary exists before the formal gate.
