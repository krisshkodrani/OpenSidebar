# ModelBench-100 acceptance record

Date: 2026-08-13

Status: Implementation complete; final benchmark acceptance and legacy cutover pending.

## Passed evidence

- Catalog check: 100 released cases, 50 frozen role probes, and 119 checked legacy migration dispositions.
- Post-headline acceptance: MB-101 exercises a production extension opening a linked record in a real Chrome tab, adopting it into the source workspace group, preserving side-panel availability, reading deterministic evidence, returning to the source tab, and saving/reporting the grounded result. MB-101 uses normal ModelBench attempt and validator records but is deliberately excluded from the frozen `full-100` score.
  Run it with `pnpm modelbench:101`. The checked-in matrix pins the release-candidate OpenRouter seats without containing credentials. The reference extension driver rebuilds both target and extension, writes the normal `attempts.json`, and `pnpm modelbench:report <attempts.json>` accepts the result while keeping it non-rankable as a one-case acceptance run.
- Scripted oracle: 100 gold paths passed, 300 declared near misses rejected, and 888 assertions evaluated.
- Store parity: `MemoryScenarioStore` and `PostgresModelBenchRepository` produced identical initial state, oracle final state, and deterministic verdict for all 100 cases against an isolated PostgreSQL 16 database.
- Target-quality gate: 100 of 100 cases pass prompt, isolation, discoverability, workflow-depth, perception, judgment, recovery, and safety checks. Fifty planner/integrated/orchestration cases now require three ordered application stages; all 15 orchestration cases additionally require an observable disruption and explicit recovery transition.
- Public-target boundary check: three isolated target assets passed.
- Local quality gates: lint, all 11 project typechecks, the full extension test suite, production extension build, distribution inspection, sandbox build, and cloud tests pass.
- Live driver smoke: the reference Luna executor and Terra planner resolved as requested through OpenRouter; the repaired CRM priority case produced `valid_pass` with role usage, cost, latency, turn, and tool telemetry.

## Pending gates

- Run a blinded manual review sample across every workflow family to complement the executable target-quality gate before publishing headline model claims.
- Run three `full-100 x3` reference baselines on identical code and configuration, with at least 98 percent valid coverage, no unexplained model-resolution mismatch, no confirmed validator false positive, and audited false-negative disagreement below 2 percent.
- Run deployment smoke and rollback rehearsal for the version-2 public target and internal ModelBench service.
- After every gate above passes, perform the single cutover commit that removes the frozen legacy fixture E2E/Arena system and superseded infrastructure.

The legacy suite remains intentionally present until these gates pass. Its presence is a rollback boundary, not a permanent compatibility decision.
