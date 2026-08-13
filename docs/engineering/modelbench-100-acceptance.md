# ModelBench-100 acceptance record

Date: 2026-08-13

Status: Implementation complete; final benchmark acceptance and legacy cutover pending.

## Passed evidence

- Catalog check: 100 released cases, 50 frozen role probes, and 119 checked legacy migration dispositions.
- Scripted oracle: 100 gold paths passed, 300 declared near misses rejected, and 688 assertions evaluated.
- Store parity: `MemoryScenarioStore` and `PostgresModelBenchRepository` produced identical initial state, oracle final state, and deterministic verdict for all 100 cases against an isolated PostgreSQL 16 database.
- Public-target boundary check: three isolated target assets passed.
- Local quality gates: lint, all 11 project typechecks, the full extension test suite, production extension build, distribution inspection, sandbox build, and cloud tests pass.
- Live driver smoke: the reference Luna executor and Terra planner resolved as requested through OpenRouter; the repaired CRM priority case produced `valid_pass` with role usage, cost, latency, turn, and tool telemetry.

## Pending gates

- Complete the case-by-case target realism and strategy-leak review. The live smoke found and fixed generic navigation, ambiguous field semantics, stale post-success controls, and provider attribution defects; the remaining complex workflows still require review before they can support headline model claims.
- Run three `full-100 x3` reference baselines on identical code and configuration, with at least 98 percent valid coverage, no unexplained model-resolution mismatch, no confirmed validator false positive, and audited false-negative disagreement below 2 percent.
- Run deployment smoke and rollback rehearsal for the version-2 public target and internal ModelBench service.
- After every gate above passes, perform the single cutover commit that removes the frozen legacy fixture E2E/Arena system and superseded infrastructure.

The legacy suite remains intentionally present until these gates pass. Its presence is a rollback boundary, not a permanent compatibility decision.
