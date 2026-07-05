# Roadmap

What's planned after v0.3.0, roughly in order. Items link to their RFCs where
one exists; anything RFC-gated needs an owner Decision Stamp before
implementation ([process](./engineering/rfc-decision-process.md)). If you want
to pick one of these up, open an issue first — see
[CONTRIBUTING](../CONTRIBUTING.md) for the seam map.

## Near-term (weeks)

- **Published benchmark numbers** ([RFC LP-1](./engineering/rfcs/lp-0001-public-benchmark-adapter.md))
  — first full Online-Mind2Web sweep with per-task receipts, published in the
  README's Measured Performance section.
- **Chrome Web Store listing** — submission is in review; GitHub releases stay
  the primary channel until it clears.

## Code health (ongoing decomposition series)

The repo has four large files that are being decomposed incrementally with
behavior-preserving moves (the ServiceNow adapter extraction from
`tools/index.ts` was the first):

- `completion-kernel.ts` (~14K lines) — split per contract kind into
  `completion/contracts/`.
- `loop.ts` (~11K lines) — continue extracting stateful collaborators and
  `*-policy.ts` modules.
- `tools/index.ts` (~7K lines) — split `registerTools()` per tool family;
  extract ServiceNow knowledge-base helpers into the adapter.
- `orchestrator/index.ts` (~6.5K lines) — extract lane/verification
  collaborators.
- **`any` burndown** — `no-explicit-any` is now a lint warning; burn down the
  ~240 occurrences starting with typed shims for chrome-API gaps.

## Observability

- **DuckDB analytics tier** ([RFC LP-7](./engineering/rfcs/lp-0007-unified-observability-engine.md),
  Stage B2) — analytical queries move to DuckDB views over the Parquet span
  spine behind an `OBS_ANALYTICS` flag; SQLite remains the fallback, with a
  parity test.
- Retire the legacy derived trace store once B2 lands (gated on e2e + parity).

## Platform packs

- **PackPlugin interface** ([GAP-12](./engineering/contribution-seams.md)) — a
  plugin API so a new platform pack (Salesforce, SAP, Zendesk) needs zero
  core-file edits. The extracted `tools/servicenow/` adapter becomes the first
  conforming implementation. RFC-gated; actively recruited for.

## Experimental

- **OpenClaw integration M6/M7** — deeper brain/hands integration beyond the
  current default-off MCP surface, pending real-world validation of M1–M5.
- **Warmup migration** — move the panel-open perception warmup off the
  deprecated `perceive()` path onto `PerceptionAgent.observe()`.
