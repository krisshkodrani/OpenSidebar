# Fleet telemetry roadmap

Status: implementation roadmap for approved RFC LP-25. Last updated 2026-07-27.

The goal is an explicit-opt-in, privacy-bounded way to learn why browser-agent
tasks finish, fail, or continue after their real-world objective is met. S3 and
Athena remain the authoritative source; Bluebox is an optional backend-only
investigative layer.

## Achieved so far

### Foundation and local privacy controls — complete

- A closed, versioned summary schema and JSON validation exist in
  `packages/observability-schema`.
- The projector accepts only a narrow, content-free input surface. Unknown
  providers, models, tools, evidence, terminal reasons, and error codes map to
  reviewed coarse values rather than leaking strings.
- The issue-#120 five-case completion corpus is included as a baseline for
  analyzing premature completion and non-termination failures.
- Telemetry is off by default. Consent is versioned and stored locally rather
  than synced; stale consent is treated as off.
- A 5% independent session sampler, 20-record / 512 KiB / seven-day local
  queue, opt-out clearing, and settings payload inspector are implemented.

### AWS ingest and authoritative query surface — implemented, not deployed

- An isolated CDK project in `infra/telemetry` synthesizes an HTTP ingest API,
  schema validator Lambda, Firehose, KMS-encrypted private S3 storage, Glue,
  Athena, throttling, error alarm, and a USD 40 account-wide monthly budget.
- Validation happens before Firehose; request bodies are not logged.
- The raw bucket expires accepted summaries after 30 days.
- CDK synthesis and validator-policy tests pass locally. No AWS credentials
  were used and no stack has been deployed.

### Extension terminal collection and internal upload — core path implemented

- Collection occurs at the orchestrator task terminal boundary, not per
  `AgentLoop`, avoiding multi-lane double counting.
- The adapter retains only schema-relevant aggregates. It does not retain or
  project task text, URLs, DOM, page content, executor results, tool arguments,
  or trace records.
- Published builds compile an empty endpoint and cannot upload telemetry.
- An explicit `internal` build can anonymously POST consented queued summaries.
  A non-`202` response preserves the bounded queue for MV3 worker recovery, and
  upload is detached from agent task execution.

## Remaining roadmap

| Phase | Outcome | Gate / evidence |
| --- | --- | --- |
| 4a | Finish internal uploader resilience: bounded retry backoff, attempt cap, and worker-recovery coverage against a deployed test endpoint. | Simulated backend outage has no agent-visible effect; queued records expire/drop safely. |
| 4b | Deploy the Phase 3 stack to an internal AWS account and run valid/invalid ingest plus Athena smoke queries. | Valid synthetic record queryable in Athena; invalid record rejected; lifecycle and budget controls observed. |
| 5 | Build S3 → SQS → Bluebox exporter with Secrets Manager, DLQ, kill switch, bounded backfill, and Athena parity queries. | Vendor gate recorded; issue-#120 answers match the fixture's Athena result within agreed lag. |
| 6 | Privacy, store listing, disclosure, release-checklist, and data-practice consistency pass; internal dogfood. | Privacy/data-practice review signed off. |
| 7 | Explicit-opt-in 5% beta under the USD 20 AWS budget. | Two weeks within privacy, reliability, data-quality, and cost limits. |
| 8 | Small stable canary and controlled expansion. | Owner reviews evidence and authorizes every expansion. |

## Required decisions before Phase 5 / external beta

- Record the Bluebox plan, expected cost, OTLP transport/authentication,
  storage region, retention, deletion/export behavior, query retention/model
  training terms, and named authorized users.
- Deploy the AWS stack and make the internal endpoint available only through an
  internal build configuration.
- Complete the privacy/store disclosure review before any published build is
  given an endpoint or beta consent is enabled.

## Verification snapshot

- 19 focused extension telemetry tests pass.
- Extension TypeScript check passes.
- Production Vite build passes and contains no configured telemetry endpoint.
- Internal Vite build was verified to contain an explicitly supplied test
  endpoint.
- CDK synthesis and four ingest-policy tests pass.

The detailed design, schema, decision stamp, and acceptance criteria remain in
[RFC LP-25](rfcs/lp-0025-optional-fleet-telemetry.md).
