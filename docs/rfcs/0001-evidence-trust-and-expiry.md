# RFC 0001 - Evidence Trust & Expiry Signaling

Lifecycle status: Archived
Date: 2026-05-30
Decision date: 2026-06-06
Archived date: 2026-06-06
Closure: Verified implementation accepted.
Scope: `analysis/analyze.ts`, `analysis/evidence.ts`, `components/traces/TurnSnapshotSection.tsx`, `components/traces/PanoramicThumbnails.tsx`, `components/traces/InvestigationSummary.tsx`

## Problem

Two distinct ways the viewer can show _untrustworthy evidence_:

1. **Dangling evidence pointers.** An `InvestigationFinding` cites
   `TraceEvidencePointer`s (turn / tool / event / perception / log). Nothing
   guarantees the referenced artifact exists in the currently loaded session, so
   a finding can point at a turn/tool that isn't there (e.g. after partial load,
   schema drift, or a recovered/older trace).
2. **Silent screenshot expiry.** Raw screenshots are a hot artifact pruned after
   ~7 days (see Observability doc). An expired screenshot currently renders as a
   broken image, which reads as "perception produced nothing" rather than
   "evidence was pruned".

## Motivation (both lenses)

- **AI engineer:** This is the doc's #1 risk: "selected sessions cannot show
  stale evidence." A broken screenshot misattributed to a perception failure
  sends debugging down the wrong path.
- **AI researcher:** A finding that cites evidence which no longer resolves is a
  _false observation_; and confusing "pruned" with "absent" corrupts any
  perception-usage statistic. You also need to see the reproducibility boundary
  explicitly.

## Proposal

1. **Pointer resolution guarantee.** In `analyze.ts`/`evidence.ts`, after
   building findings, validate each `TraceEvidencePointer` against the loaded
   `entries` (and tool-call/event indexes). Preserve unresolved pointers with
   `resolved: false` and a short reason so the UI can render them as
   "evidence unavailable" rather than silently losing the trust signal.
2. **Expiry affordance.** `TurnSnapshotSection` / `PanoramicThumbnails`: on image
   load error (or a known-expired marker), render an explicit placeholder
   distinct from "no screenshot captured". Use "Screenshot pruned (hot window
   elapsed)" only when the server or artifact metadata identifies pruning; use a
   generic load-failure message for broken URLs, server errors, or corrupt files.

## Data-model change

Add optional `resolved?: boolean`, `resolutionStatus?: "resolved" |
"unresolved" | "pruned" | "load_failed"`, and `resolutionDetail?: string` to
`TraceEvidencePointer` (default resolved). Non-breaking.

## Alternatives

- Do nothing and rely on reviewers to notice broken images: rejected; this is a
  recurring, trust-eroding bug class.
- Re-fetch/re-generate screenshots on demand: out of scope; pruning is by design.

## Testing

- Unit: a finding whose pointer references a missing turn/tool yields a
  `resolved: false` pointer (or is dropped), never a dangling link.
- Component: an `<img>` whose src 404s renders the "pruned" affordance, not a
  broken image (Coverage Plan Tier 1).

## Rollout

Low effort, non-breaking. Ship behind the existing component tests; no migration.

## Decision

Status: Approved

Chosen path:

- Resolve evidence pointers against the loaded trace, preserve explicit
  unresolved/pruned/load-failed states, and render screenshot expiry separately
  from generic image failures.

Required edits before implementation:

- None.

Non-blocking follow-ups:

- None.

Do not do:

- Do not silently drop unresolved evidence or describe an unclassified image
  failure as retention pruning.

Evidence required before merge:

- `analysis.test.ts` proves missing pointers remain visible as unresolved.
- `turn-snapshot-section.test.tsx` distinguishes known pruning from generic
  image load failure.

Next action:

- Archive
