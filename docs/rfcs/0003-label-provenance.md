# RFC 0003 - Label Provenance for Findings & Verdicts

Status: Implemented
Date: 2026-05-30
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
- Drop confidence entirely: rejected; it's useful *with* provenance.

## Testing

- Unit: each finding category maps to the expected `source`; deterministic
  findings never report `heuristic`.
- Component: provenance badge renders for each `source`.

## Rollout

Low for the field + badge. Completion-path attribution may be staged behind a
runtime change; until then default completion-finding `source` conservatively.
