# RFC LP-27 — Semantic targeting for Watch Mode

Lifecycle status: Draft for owner review
Date: 2026-08-03
Scope: ground a Watch instruction against semantic page evidence at session
start, prioritize mutations that affect that evidence, recover targets after SPA
rerenders, and make the active target visible to the user without weakening the
existing whole-page and periodic safety nets.
Related: `apps/extension/src/background/passive-monitor/`,
`apps/extension/src/content/content.ts`,
`packages/shared-types/src/messages/watch-mode.ts`, LP-10 (stable element
identity), and LP-26 (Watch Mode restock demonstration).

This draft is planning only. It has no owner Decision Stamp. No product code or
protocol change is authorized until the owner records the complete Decision
block required by `docs/engineering/rfc-decision-process.md`.

## 1. Summary

Watch Mode currently observes the entire document with a `MutationObserver`,
debounces any meaningful mutation, captures a fresh page snapshot, and asks the
evaluator whether the user's condition is met. This is robust but unselective:
the runtime does not identify what evidence it intends to watch when the
session starts, and the UI cannot tell the user what it understood.

Add a setup-time grounding step that turns the instruction and initial snapshot
into a small set of semantic watch targets. A target describes evidence such as
an availability label, purchase button, dashboard value, or containing region.
It uses multiple semantic hints rather than relying on a single CSS selector.

The existing document-level observer remains the wake-up primitive. Mutations
are classified by their relationship to the current targets, and target-related
changes receive prompt evaluation. Whole-page fingerprint comparison, periodic
checks, and re-grounding remain authoritative recovery paths.

```text
Watch instruction + initial snapshot
                |
                v
       semantic target grounding
                |
                v
 target descriptors + initial evidence -----> user-visible confirmation
                |
                v
 document MutationObserver
                |
                v
 target / container / unrelated classification
                |
                v
 settle -> snapshot -> fingerprint -> evaluator
                |
                +---- target lost or page context changed ----> re-ground
```

## 2. Problem

The current design has four gaps:

1. **No setup confirmation.** “Tell me when this is back in stock” starts a
   session without showing whether Watch Mode identified the availability
   status, the correct product, or the purchase control.
2. **Every meaningful mutation is equivalent.** A clock, carousel, animation,
   or unrelated notification wakes the same evaluation path as the watched
   evidence.
3. **No durable target concept.** The runtime cannot distinguish “the watched
   control changed” from “the page changed somewhere.”
4. **Weak diagnostics.** The UI exposes only the latest status, so an observer
   wake-up may be quickly replaced by “no relevant change” without explaining
   which evidence was checked.

Targeting only a CSS selector would create a different failure mode. SPAs often
replace nodes, generated classes change, variants swap product regions, and
some conditions are established by multiple signals. Targeting must therefore
be semantic, redundant, and recoverable.

## 3. Goals

1. Identify likely evidence for the Watch instruction when the session starts.
2. Confirm the interpreted target and initial state to the user.
3. Prioritize changes to the target or its semantic container.
4. Use multiple signals when the condition warrants it; for stock status this
   may include status text, button presence, and button enabled state.
5. Recover after node replacement, SPA navigation, and ambiguous grounding.
6. Preserve generic behavior across sites and task types.
7. Reduce unnecessary evaluator calls without allowing silent missed changes.

## 4. Non-goals

- Site-, product-, fixture-, or task-specific selectors.
- A shopping-only availability detector.
- Replacing the document-level `MutationObserver` with one observer per node.
- Making a target selector the sole source of truth.
- Persisting raw DOM nodes, tab IDs, or Chrome storage details in replayable
  trajectory data.
- Automatically acting unless the existing Watch instruction explicitly
  contains a pre-confirmed action.
- Moving product behavior into the E2E fixture or overlay harness.

## 5. Proposed target contract

The background owns semantic target intent. The content script owns ephemeral
DOM resolution. Shared messages carry serializable descriptors only.

```ts
type WatchTargetRole = "status" | "value" | "control" | "region";

interface WatchTargetDescriptor {
  id: string;
  description: string;
  role: WatchTargetRole;
  initialState: {
    text?: string;
    value?: string;
    disabled?: boolean;
    hidden?: boolean;
  };
  hints: {
    tagName?: string;
    semanticRole?: string;
    accessibleName?: string;
    associatedLabel?: string;
    nearbyText?: string[];
    stableAttributes?: Record<string, string>;
    initialElementTag?: number;
  };
  confidence: "low" | "medium" | "high";
}
```

The exact TypeScript shape may be simplified during implementation, but these
properties are binding design requirements:

- no raw `Element` crosses the content/background boundary;
- no generated CSS path is treated as authoritative;
- a descriptor includes human-readable meaning and initial state;
- resolution may use a current element tag as a fast path but must survive its
  loss; and
- uncertainty is explicit.

Grounding returns zero or more descriptors plus a concise summary:

```ts
interface WatchGroundingResult {
  summary: string;
  targets: WatchTargetDescriptor[];
  confidence: "low" | "medium" | "high";
  fallbackReason?: string;
}
```

Zero targets is valid. The session then operates in whole-page fallback mode
and tells the user that no reliable single target was found.

## 6. Setup flow

1. Validate the instruction, site-access rules, and tab as today.
2. Wait for DOM readiness and capture the initial semantic snapshot.
3. Ground the instruction against the snapshot. Use the existing configured
   evaluator/model path rather than adding a provider-specific planner.
4. Limit the result to a small evidence set (recommended maximum: four targets)
   and validate all model output before storing it.
5. Send descriptors to the content script with Watch page-activity state.
6. Resolve descriptors against the live DOM and report which targets resolved.
7. Broadcast a user-visible summary and initial state.
8. Continue with the initial observation and normal periodic schedule.

Example confirmation:

> Watching the availability status and “Add to cart” button for Blue Running
> Shoes. Current state: Out of stock.

Fallback confirmation:

> Watching this page generally. I could not identify one reliable availability
> element, so I will re-check the full page periodically.

Grounding failure must not prevent the session from starting when the existing
whole-page monitor can operate safely.

## 7. Mutation classification

Keep one observer on `document.documentElement`. The content script maintains
an ephemeral map from target IDs to currently resolved elements and optional
semantic containers.

Each meaningful mutation batch is classified as:

- `target`: the mutation affects a resolved target or its descendants;
- `container`: the mutation affects a resolved target's enclosing semantic
  region and may replace the target;
- `unrelated`: no known relationship to a resolved target; or
- `unresolved`: one or more descriptors no longer resolve.

Classification is a scheduling hint, not proof that the condition changed.
The background still captures a fresh snapshot and compares fingerprints before
evaluation.

Recommended scheduling policy:

| Change class | Behavior |
| --- | --- |
| `target` | Debounce the page burst, then evaluate promptly |
| `container` | Re-resolve targets, then evaluate promptly |
| `unresolved` | Re-ground from a fresh snapshot, then evaluate |
| `unrelated` | Coalesce with the normal periodic safety check unless the whole-page fingerprint has materially changed |

The implementation may initially evaluate `unrelated` changes with the current
debounce while telemetry/tests establish a safe deferral threshold. Missing a
condition is worse than spending an extra evaluation.

## 8. Re-resolution and re-grounding

Target recovery has two levels:

1. **Local re-resolution:** score live candidates from stable attributes,
   accessible name, semantic role, associated label, nearby text, tag name, and
   initial state. No single hint is mandatory.
2. **Semantic re-grounding:** capture a fresh snapshot and regenerate target
   descriptors when local resolution is ambiguous, all targets disappear, the
   URL/page identity changes, or the containing context materially changes.

Re-grounding replaces the target set atomically. It must not carry a stale
product or record target across a navigation merely because similar text exists
on the new page.

## 9. Evaluation behavior

The evaluator receives:

- the original Watch instruction;
- current full-page evidence as today;
- the target summary and initial state;
- current resolved target evidence;
- the mutation classification; and
- prior suggestion state.

Targets narrow attention but do not redefine success. The evaluator must still
decide whether the user's real condition is met. For compound evidence, it may
use corroborating signals—for example, changed availability text and an enabled
purchase button.

Snapshot fingerprints remain the model-free duplicate suppression mechanism.
Optional screenshot and tab-audio inputs retain their existing roles. The
periodic `minIntervalMs` observation remains a safety net for canvas rendering,
closed shadow DOM, missed content-script events, and other observer blind spots.

## 10. User experience and diagnostics

The Watch control should expose three distinct facts without creating a noisy
chat log:

1. **What is watched:** the grounding summary.
2. **What happened:** target change, nearby change, periodic check, or target
   recovery.
3. **What was concluded:** condition met, not met, or uncertain.

The latest status may remain compact, but diagnostics should retain structured
reason data so traces and tests can distinguish observer firing, scheduling,
snapshot suppression, evaluation, and suggestion posting.

Suggested statuses include:

- `Watching availability status and Add to cart button.`
- `Watched availability changed. Checking the condition…`
- `The watched element was replaced. Finding it again…`
- `No relevant change. Watching availability status.`

Do not display a raw selector or internal element tag as the user-facing target.

## 11. Runtime boundaries

- **Background:** grounding policy, session-owned descriptors, scheduling,
  re-ground decisions, evaluation context, and status broadcasts.
- **Content:** live DOM resolution, mutation-to-target classification, and
  extension-element filtering.
- **Shared protocol:** environment-neutral descriptor and event shapes.
- **Sidepanel:** renders summaries and status through `sidepanel/runtime.ts`;
  no direct `chrome.*` access.
- **Harness/fixtures:** configure mutations and assert behavior only; no target
  selection logic.

Target resolution should live in a focused content module rather than adding
substantial logic to `content.ts`. Background policy should live under
`background/passive-monitor/`, not in the orchestrator or `AgentLoop`.

## 12. Failure and safety behavior

- Invalid model-produced descriptors are discarded.
- Low-confidence grounding is presented honestly and retains whole-page mode.
- A detached target triggers recovery; it does not stop Watch Mode.
- A content-script restart is handled by reasserting page activity and target
  descriptors after bridge readiness.
- Concurrent mutation bursts never start concurrent evaluations; the existing
  pending-change mechanism remains.
- Site-access rules and active-agent-task pausing remain authoritative.
- Targeting never authorizes a new action or weakens the existing action gate.

## 13. Alternatives considered

### A. Keep whole-page observation only

This is robust and simple but leaves the comprehension, prioritization, and
diagnostic gaps unresolved.

### B. Observe only a planner-selected element

Rejected. Node replacement and ambiguous evidence would silently blind the
watcher.

### C. Store an exact CSS or XPath selector

Rejected as the authority. A selector may be a short-lived resolution hint only
when derived from stable page semantics; generated DOM paths and classes are too
brittle.

### D. Encode stock, price, or dashboard detectors

Rejected. Domain nouns and site-specific rules would violate the generic-skill
and WorkArena policies and would not generalize to arbitrary Watch conditions.

### E. Poll the whole page more frequently

Rejected. It increases capture and evaluator cost without explaining the target
or improving semantic grounding.

## 14. Proposed implementation sequence after approval

This is sequencing guidance, not an authorized implementation plan.

1. Add pure target descriptor validation and model-free candidate scoring with
   focused unit tests.
2. Add setup-time grounding and session state behind whole-page fallback.
3. Extend the watch protocol with descriptors and classified change events.
4. Extract content-side target resolution and mutation classification into a
   focused module; retain the existing observer and debounce.
5. Add re-resolution/re-grounding policy and structured diagnostic reasons.
6. Add sidepanel target confirmation and recovery status copy.
7. Verify with a generic focused test and the Watch restock E2E fixture, then
   run the relevant staged suite.

Each phase must leave whole-page fallback operational. A rollout flag is optional
if the work can land incrementally without changing default behavior until the
end-to-end path is complete.

## 15. Evidence required before merge

- Unit tests prove target, container, unrelated, and unresolved mutation
  classification while excluding OpenSidebar-owned elements.
- Unit tests prove descriptor validation rejects malformed model output.
- Unit tests prove node replacement re-resolves or re-grounds without ending
  the session.
- Controller tests prove mutation bursts remain debounced and never create
  concurrent evaluations.
- Controller tests prove low-confidence or failed grounding retains whole-page
  periodic monitoring.
- A generic page test proves a semantically grounded text/control change posts
  the expected suggestion.
- The restock E2E proves Watch Mode identifies understandable evidence, reacts
  to the real availability transition, and passes the validator without
  fixture selectors or hidden expected values in product code.
- A negative-noise test proves an unrelated animated region does not produce a
  suggestion or starve the periodic safety check.
- Typecheck, focused tests, and the applicable staged E2E suite pass.
- Trace/status evidence makes observer wake-up, classification, re-grounding,
  fingerprint suppression, evaluation, and posting distinguishable.

## 16. Recommendation for owner review

Recommend **Approved with edits** only if the owner wants implementation to
begin after the protocol shape and unrelated-mutation scheduling policy are
confirmed. Otherwise recommend **Approved** with the hybrid boundary fixed:
semantic targets optimize attention, while whole-page observation, fingerprint
comparison, and periodic checks remain safety authorities.

The owner must provide the complete Decision Stamp before implementation.
