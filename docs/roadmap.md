# Roadmap

What's planned after v0.3.0, roughly in order. Items link to their RFCs where
one exists; anything RFC-gated needs an owner Decision Stamp before
implementation ([process](./engineering/rfc-decision-process.md)). If you want
to pick one of these up, open an issue first — see
[CONTRIBUTING](../CONTRIBUTING.md) for the seam map.

## Near-term (weeks)

- **PostgreSQL cloud sessions** ([LP-29 through LP-31](./engineering/cloud-platform-roadmap.md))
  — retention/export/deletion, portable restore, and device coordination pass
  published-client reconnect/takeover UX, local and real two-profile Chrome,
  and exact-host PostgreSQL acceptance behind disabled flags. Bounded text and
  locally approved, postcondition-verified clicks now pass; staged activation
  and any future non-click sensitive actions remain.
  Default-off stage controls and a dedicated Cognito-subject tester allowlist
  are implemented; no tester account is enabled yet.
  Temporal is parked research.

- **Authenticated cloud UX normalization**
  ([cloud platform Phase 10](./engineering/cloud-platform-roadmap.md#phase-10--authenticated-cloud-ux-normalization))
  — unify the signed-in Account, Dashboard, Sessions, Settings, and Playground
  experience after named-tester acceptance. Normalize navigation and capability
  language, remove contradictory cached-auth states, and make Local key, cloud
  credential, relay, and cloud-session status clearly distinct.

- **Published benchmark numbers** ([RFC LP-1](./engineering/rfcs/lp-0001-public-benchmark-adapter.md))
  — first full Online-Mind2Web sweep with per-task receipts, published in the
  README's Measured Performance section.

## Code health (ongoing decomposition series)

The repo's large files are being decomposed incrementally with
behavior-preserving moves, each guarded by a shrink-only size budget
(`scripts/loop-ratchet.mjs`; run `--report` for current numbers — the figures
below drift).

- `completion-kernel.ts` (~5.9K lines) — split per contract kind into
  `completion/contracts/`. The oversized `completion/*-analysis.ts` modules it
  already spun out are the other half of this work.
- `loop.ts` (~5.6K lines, down from ~10.3K) — continue extracting stateful
  collaborators and `*-policy.ts` modules. End-state target: 3.5K lines / 80
  methods.
- `orchestrator/index.ts` (~5.8K lines) — extract lane/verification
  collaborators.

Done: `tools/index.ts` is now a ~130-line barrel (`registerTools()` split per
tool family, ServiceNow handlers in the adapter), and the agent-side ServiceNow
controllers have left `loop.ts` for `agent/servicenow/`.

- **`any` burndown** — `no-explicit-any` is now a lint warning; burn down the
  ~240 occurrences starting with typed shims for chrome-API gaps.

## Perception (RFC series LP-9…LP-14, from the 2026-07-04 SOTA audit)

The perception layer [matches the converged SOTA hybrid pattern](./engineering/rfcs/README.md#perception-series-post-v030-from-the-2026-07-04-sota-audit);
these RFCs close the remaining gaps: screenshot pipeline engineering (LP-9),
new-element diff marking (LP-10), unified_vl default (LP-11),
closed-shadow-root/cross-origin-iframe reach (LP-12), region zoom (LP-13),
PDF handling (LP-14, parked).

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

- **Deeper brain/hands integration** — beyond the current default-off browser
  bridge (pi extension + MCP surface): richer mission protocols, grounded
  submits, cross-mission memory.
- **Warmup migration** — move the panel-open perception warmup off the
  deprecated `perceive()` path onto `PerceptionAgent.observe()`.
