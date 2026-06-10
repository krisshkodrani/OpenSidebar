# RFC 0003 - Label Provenance for Findings & Verdicts

Lifecycle status: Archived
Date: 2026-05-30
Decision date: 2026-06-06
Archived date: 2026-06-06
Closure: Implemented scope accepted; remaining viewer attribution superseded by
[GitHub issue #37](https://github.com/krisshkodrani/OpenSidebar/issues/37).
Scope: `analysis/types.ts` (`InvestigationFinding`), `analysis/analyze.ts`, `components/traces/InvestigationSummary.tsx`; relates to completion logic in `background/agent/loop.ts` + `background/agent/completion-kernel.ts`

## Problem

- `InvestigationFinding.confidence` is a bare number with no documented
  derivation or calibration; consumers can't tell a heuristic guess from a
  deterministic fact.
- The `completion`/`verification` finding categories inherit ambiguity from the
  runtime: per CLAUDE.md, "is the task done?" logic is **split** between a
  deterministic contract kernel (`completion-kernel.ts`) and a legacy guard chain
  in `loop.ts`. A "completion failure" finding doesn't say which produced the
  verdict, so debugging starts blind.

## Motivation (both lenses)

- **AI researcher:** A label you can't calibrate is unusable for measurement.
  Knowing whether a verdict is deterministic, heuristic, or LLM-judged is
  prerequisite to trusting any aggregate built on it.
- **AI engineer:** Provenance routes the investigation: a deterministic-kernel
  rejection vs a legacy-guard rejection vs an LLM-verifier rejection lead to
  different fixes.

## Proposal

1. Add `source: "deterministic" | "heuristic" | "llm_verifier"` and an optional
   short `derivation` note to `InvestigationFinding`.
2. Where findings are constructed in `analyze.ts`, set `source` from the
   underlying signal (e.g. trace-integrity/contract checks -> deterministic;
   pattern heuristics -> heuristic; verifier events -> llm_verifier).
3. For completion verdicts, record which path produced them (kernel vs guard
   chain) in the trace events so the finding can attribute it; render a small
   provenance badge in `InvestigationSummary`.

## Data-model change

Additive optional fields on `InvestigationFinding`. Non-breaking. The completion
path attribution depends on the runtime emitting that distinction (may be a
follow-up if not already in events).

## Alternatives

- Keep a single opaque confidence and document it globally: rejected; provenance
  is per-finding and changes behavior.
- Drop confidence entirely: rejected; it's useful _with_ provenance.

## Testing

- Unit: each finding category maps to the expected `source`; deterministic
  findings never report `heuristic`.
- Component: provenance badge renders for each `source`.

## Rollout

Low for the field + badge. Completion-path attribution may be staged behind a
runtime change; until then default completion-finding `source` conservatively.

## Decision

Status: Approved

Chosen path:

- Keep the implemented finding source, derivation, provenance badges, and
  completion decision metadata; move the remaining authoritative-path viewer
  attribution to GitHub issue #37 and close this RFC.

Required edits before implementation:

- None.

Non-blocking follow-ups:

- Complete GitHub issue #37 without reopening or expanding this RFC.

Do not do:

- Do not present shadow completion decisions as authoritative, and do not keep
  this broad RFC active for one bounded viewer-analysis change.

Evidence required before merge:

- Existing trace-viewer analysis tests prove deterministic, heuristic, and LLM
  verifier source assignment with derivation text.
- `InvestigationSummary.tsx` renders provenance badges for the supported source
  values.
- Runtime tests prove `completion_decision` events distinguish authoritative
  and shadow/legacy paths.

Next action:

- Archive
