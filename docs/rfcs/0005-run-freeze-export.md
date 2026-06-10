# RFC 0005 - Freeze / Export a Run as a Permanent Bundle

Lifecycle status: Archived
Date: 2026-05-30
Decision date: 2026-06-06
Archived date: 2026-06-06
Implementation note: Export and validation are implemented; import/load and
read-only frozen-artifact rendering are parked pending a demonstrated portable
bundle exchange workflow.
Scope: `analysis/report.ts` (`buildTraceInvestigationReport`), `scripts/log-server.ts`, `scripts/trace-archive.ts`, viewer `api.ts`, a new import/load path

## Problem

Raw traces prune after ~7 days and screenshots expire, so a run cited today may
be un-openable later. `buildTraceInvestigationReport` produces a text report, but
there is no self-contained, **re-loadable** artifact: you cannot re-open the full
interactive trace (entries + run events + logs + screenshots) after pruning.

## Motivation (both lenses)

- **AI researcher:** Reproducibility: a run referenced in a writeup or used as
  evidence for a claim must remain openable indefinitely, independent of the hot
  retention window.
- **AI engineer:** A frozen run is a permanent regression repro: pin the trace
  that demonstrates a bug so it survives cleanup and can be replayed in the
  viewer or handed to Codex.

## Proposal

1. **Export:** a "Freeze run" action that bundles the session's entries, run
   events, logs, and (inlined or zipped) screenshots into a single
   self-describing file (schema-versioned JSON, optionally `.zip` for
   screenshots).
2. **Import/load (deferred):** the viewer can load a frozen bundle (drop-in or via a
   `/api/traces/import` endpoint on the log server) and render it through the
   normal detail views, read-only and marked "frozen artifact".
3. Reuse `buildTraceInvestigationReport` as the human-readable summary embedded in
   the bundle.

## Data-model

A versioned `FrozenTraceBundle` wrapping existing `TraceSession`,
`TraceEntry[]`, `RunTraceEvent[]`, logs, and screenshot blobs/refs. Add a
dedicated `validateFrozenTraceBundle` that reuses `validateTraceBundle` for the
session / entry / run-event core, then validates frozen-only fields such as
logs, embedded screenshots, blob checksums, and bundle schema version.

## Alternatives

- Just lengthen the retention window: postpones the problem and bloats `traces/`;
  doesn't give a portable, citable artifact.
- Text report only (status quo): loses the interactive evidence (timeline, turn
  cards, screenshots).

## Testing

- Unit: export a seeded session and validate entries/events/logs/screenshot
  references with `validateFrozenTraceBundle`.
- Deferred round-trip: import the frozen bundle and verify entries/events/logs/
  screenshots match.
- Component/e2e: a loaded frozen bundle renders the detail tabs read-only.

## Rollout

Medium-high (largest of the set). Independent of the others; ship when
reproducibility is prioritized. No change to live tracing.

## Decision

Status: Parked

Chosen path:

- Keep the implemented frozen-bundle export and validation plus SQLite/archive
  retention. Do not build import/load until portable bundle exchange becomes a
  concrete user or debugging workflow.

Required edits before implementation:

- None.

Non-blocking follow-ups:

- If the work is reconsidered, first define the exchange workflow, trust
  boundary, schema-migration policy, and value beyond the existing archive.

Do not do:

- Do not add a local import endpoint or read-only bundle mode opportunistically,
  and do not treat ordinary local retention as justification for reopening this
  RFC.

Evidence required before merge:

- A demonstrated workflow that requires moving a frozen bundle between
  environments.
- A round-trip test preserving entries, events, logs, screenshots, and
  redaction guarantees.
- Component coverage proving imported bundles are visibly read-only.

Next action:

- Archive
