# LP-36: ModelBench-100 Scenario Platform

Status: Draft for owner decision

## Problem

OpenSidebar currently has three overlapping evaluation surfaces:

- a large file-oriented E2E suite backed by a shared fixture application;
- a 19-task Arena catalog with bespoke Playwright and trace validators; and
- a public Playground whose contracts advertise several scenarios while the
  deployed target path still implements the Restock vertical slice.

The overlap makes model comparisons hard to trust. Prompts, fixtures, runners,
validators, retries, and reports do not share one versioned contract. Some tests
grade final state, others inspect narration or traces, and infrastructure failures
can be confused with model failures. The public and internal scenario surfaces
also risk drifting even though both model the same browser workflows.

## Decision requested

Replace the fixture-driven E2E and Arena systems with ModelBench-100: one
versioned scenario platform serving exactly 100 canonical end-to-end browser
tasks. Use the same deterministic scenario semantics for local evaluation and
the cloud Playground, but keep public operational data and internal benchmark
telemetry in separate authorization, API, and storage domains.

This RFC supersedes LP-26 only where LP-26 says not to replace the existing E2E
harness or not to reuse a shared scenario catalog. LP-26's origin separation,
privacy, authentication, quota, target-capability, and deterministic-result
boundaries remain binding.

## Goals

- Measure real browser-agent outcomes across planner, executor, perception,
  completion/judge, orchestration, and integrated workflows.
- Make deterministic final state and structured events the scoring authority.
- Compare model seats with resolved provider/model identity, cost, and latency.
- Reproduce every released case from a stable seed and immutable case version.
- Serve identical scenario semantics locally and in the cloud.
- Make the public Playground a curated privacy-safe projection of the shared
  catalog rather than a separate scenario implementation.
- Replace the old E2E system in one acceptance-gated cutover.

## Non-goals

- Tuning product runtime behavior to benchmark IDs, prompts, seeds, or hidden
  expectations.
- Publishing an opaque blended score or claiming statistical significance from
  a single run.
- Making an LLM judge authoritative when deterministic state is available.
- Copying WorkArena or Online-Mind2Web task logic into local fixtures.
- Collecting prompts, traces, model identity, screenshots, or answers from the
  public Playground.

## Architecture

### Contracts and engine

Replace `@opensidebar/sandbox-contracts` with two packages:

- `@opensidebar/scenario-contracts`: serializable versioned interfaces only.
- `@opensidebar/scenario-engine`: deterministic case catalog, state factories,
  reducers, target projections, validators, and public/internal projections.

The principal contracts are:

- `ScenarioManifestV2`: scenario identity and version, application family,
  state factory, supported actions, target projection, visibility, and content
  hash.
- `BenchmarkCaseV1`: stable case identity and version, natural prompt,
  scenario/seed, difficulty, primary role, tags, limits, safety policy, and
  validator reference.
- `ValidationResultV1`: pass/fail/invalid verdict, assertion evidence,
  unexpected mutations, validator version, and final-state hash.
- `BenchmarkAttemptV1`: requested and resolved seat configuration, source and
  case hashes, timing, role usage, artifacts, retry lineage, and classification.
- `BenchmarkReportV1`: pass@1 and coverage plus category, role, cost, latency,
  retry, and disagreement vectors.

Released case versions are immutable. A prompt-semantic, seed-semantic, or
authoritative-validator change creates a new version. The product runtime never
receives case IDs, expected values, validator code, or control state.

### Applications and stores

Refactor `apps/sandbox` into the Playground application while retaining its
deployment identity during migration. It produces two isolated bundles:

- a Chakra-based human Control Center; and
- independent target applications with scenario-specific HTML/CSS and no
  Chakra, account context, controls, or benchmark metadata.

Local and PostgreSQL stores implement the same revisioned scenario-store
interface. The scripted oracle must produce identical final-state hashes and
verdicts in both implementations.

### Runner

The ModelBench runner drives the production extension and existing runtime
ports. It does not introduce a second agent core. The data flow is:

`case -> seed -> scenario store -> target -> extension -> final evidence -> deterministic validator -> attempt -> report`

## ModelBench-100 composition

The headline benchmark contains exactly 100 end-to-end browser tasks:

| Primary focus | Cases |
| --- | ---: |
| Executor and tool use | 30 |
| Planner and decomposition | 15 |
| Perception and visual grounding | 10 |
| Completion and judge behavior | 10 |
| Orchestration, recovery, and durability | 15 |
| Integrated long-horizon behavior | 20 |

The catalog is also balanced to 25 easy, 40 medium, and 35 hard cases; and to
70 realistic, 20 controlled diagnostic, and 10 adversarial, infeasible, or
safety cases. Suite slices are immutable nested sets: `smoke-10`, `core-20`,
`standard-50`, and `full-100`.

Application-family allocation:

| Family | Cases |
| --- | ---: |
| Retail and checkout | 10 |
| Procurement and inventory | 8 |
| CRM and support | 10 |
| Email | 8 |
| Team chat and calendar | 8 |
| HR, onboarding, and forms | 8 |
| Tables and administrative records | 10 |
| Dashboards and analytics | 10 |
| Knowledge, articles, and documents | 8 |
| Job search and application | 8 |
| Monitoring and watch tasks | 8 |
| Cross-application durability | 4 |

The twelve LP-26 scenario identities become curated version-2 public cases
within this catalog. Fifty additional frozen role probes (ten per seat or
orchestration concern) diagnose failures but do not contribute to the headline
100-task result.

Every case requires a natural prompt, deterministic seed/reset, discoverable
inputs, one gold path, at least three rejected near misses, positive objective
assertions, negative unintended-mutation assertions, a declared approval
policy, and a role-isolation rationale. There is no universal fixture menu.

## Validation and scoring

Deterministic final state and structured events are authoritative. Narration,
plans, internal judge output, and raw trace strings are diagnostic only.
Read-only answers use explicit normalized fact/entity/number rules. Safety and
infeasible cases require both absence of forbidden mutations and the correct
structured clarification or blocking outcome.

Attempt classifications are `valid_pass`, `valid_model_failure`,
`harness_failure`, `provider_failure`, `validator_disagreement`, and
`indeterminate`. Valid model failures are never retried automatically. One
recorded retry is permitted only for confirmed provider or harness failures;
the discarded attempt remains in lineage. A resolved-model mismatch makes the
attempt invalid. Runs below 98 percent valid coverage are not rankable.

The primary metric is deterministic pass@1. Reports must also include pass@1 by
role, family, difficulty, and safety class; valid coverage; invalid and retry
rates; median/p95 wall and LLM latency; turns, tool executions, perceptions,
replans, and recoveries; tokens and cost by role; cost per requested/successful
task; judge disagreement; and requested/resolved provider/model identity. No
blended composite score is produced.

## Public and internal cloud modes

Public Playground mode exposes only the curated twelve scenarios through
version-2 Playground and target APIs. It stores operational state, revision,
lifecycle, result, and expiry only. It continues host-only target sessions and
one-time launch capabilities. It must not collect prompts, model/provider
identity, traces, screenshots, answers, or benchmark metrics.

Internal ModelBench mode uses tester-allowlisted APIs and a separate
`modelbench` PostgreSQL schema. It may store manifests, attempt metadata,
assertions, usage, classifications, and object-backed artifact references with
a default 30-day retention. Benchmark controls and telemetry never cross the
target projection or public account boundary.

Version-1 Playground run creation is stopped for a maintenance window; the
existing two-hour run window drains before version 2 activates. Database and
asset snapshots provide rollback.

## Migration and cutover

Implementation proceeds in ordered commits on one feature branch while the old
suite remains frozen. A tracked migration matrix maps every expanded legacy E2E
case to a ModelBench case, a unit/contract assertion, or an explicit deletion
rationale. WorkArena and Online-Mind2Web remain external adapters and lose any
dependency on the Arena catalog without changing upstream grading semantics.

After acceptance gates pass, one cutover commit deletes the current E2E tree and
fixture application, Arena catalog/validators/runners, staged-suite scripts and
reports, old fixture commands/workspace entries, sandbox-contracts package,
stale Sandbox naming, and superseded serverless Playground infrastructure. Unit,
component, contract, and external benchmark tests remain.

Canonical commands become:

- `pnpm modelbench:list`
- `pnpm modelbench:check`
- `pnpm modelbench:oracle --suite full`
- `pnpm modelbench:run --suite core|standard|full --matrix <path> --repeat <n>`
- `pnpm modelbench:report <run-directory>`
- `pnpm test:e2e`

Development uses isolated cases or `smoke-10`; screening uses `core-20 x1`;
broad comparison uses `full-100 x1`; a release baseline uses `full-100 x3` on
identical code and configuration. Seat comparisons change one seat at a time.

## Acceptance evidence

- Exactly 100 unique released cases with the required distributions and suite
  slices.
- Every case passes its scripted local gold oracle and rejects at least three
  declared near misses.
- Initial state is byte-reproducible from the seed and local/cloud oracle final
  hashes and verdicts match for all 100 cases.
- No prompt strategy leak or target exposure of controls, expectations,
  credentials, account state, Chakra, or benchmark metadata.
- Public APIs demonstrably collect none of LP-26's prohibited data.
- The migration matrix accounts for every legacy expanded E2E case, including
  security, approval, bridge, continuation, durability, multi-tab, delayed
  content, perception, and recovery behavior.
- Three full reference runs achieve at least 98 percent valid harness coverage,
  contain no unexplained model-resolution mismatch, and have no confirmed
  validator false positive; audited false-negative disagreement stays below 2
  percent.
- `pnpm verify`, cloud tests, Playground boundary checks, contract tests,
  ModelBench checks/oracle, deployment smoke tests, and rollback rehearsal pass.

## Risks and guardrails

- Big-bang cutover risk is controlled by ordered internal milestones, a frozen
  legacy system, explicit parity gates, and a rehearsed rollback—not by keeping
  two permanent harnesses.
- Validator overfitting is controlled by prompt-grounded assertions, mandatory
  near misses, unexpected-mutation checks, and disagreement audits.
- Cost is controlled by nested suites and offline role probes; cost never
  changes outcome authority.
- The catalog may expose runtime weaknesses, but fixes must be generic product
  behavior. Task, seed, prompt, and expected-value branches are prohibited.

## Recommended Decision

This is an agent recommendation, not an owner Decision Stamp. No product or
test-system implementation may begin until the owner records the complete
`## Decision` block below.

Recommended status: Approved

Recommended chosen path:

- Build ModelBench-100 exactly as specified in this RFC: one shared versioned
  scenario platform, 100 canonical browser tasks, additional role probes,
  deterministic scoring, and separate public/internal data modes.
- Replace the current fixture-driven E2E and Arena systems in one
  acceptance-gated cutover after local/cloud parity and rollback evidence pass.

Recommended required edits before implementation:

- None.

Recommended non-blocking follow-ups:

- Public benchmark score publication and statistical confidence intervals.
- Silver-trajectory repair and training-data export.

Recommended do not do:

- Do not weaken LP-26 privacy or target/control-origin isolation.
- Do not add benchmark-specific behavior to the product runtime.
- Do not make an LLM judge or trace narration authoritative over deterministic
  state.
- Do not retain a permanent legacy E2E compatibility mode after cutover.

Recommended evidence required before merge:

- Complete every item in this RFC's Acceptance evidence section.

Recommended next action: Implement
