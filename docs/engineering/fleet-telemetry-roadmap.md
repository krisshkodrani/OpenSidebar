# Fleet telemetry roadmap

Status: implementation roadmap for approved RFC LP-25. Last updated 2026-07-31.

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

### AWS ingest and authoritative query surface — deployed and verified

- An isolated CDK project in `infra/telemetry` deploys an HTTP ingest API,
  schema validator Lambda, Firehose, KMS-encrypted private S3 storage, Glue,
  Athena, throttling, error alarm, and a USD 40 account-wide monthly budget.
- Validation happens before Firehose; request bodies are not logged.
- The raw bucket expires accepted summaries after 30 days.
- The internal stack is deployed in `eu-central-1`. A valid synthetic summary
  was accepted and found through Athena, while a distinct summary containing a
  forbidden field was rejected and confirmed absent from Athena.
- Browser-extension CORS preflight is enabled only for anonymous `POST`
  requests with `content-type`; credentials remain omitted by the uploader.
- The deployed raw-object lifecycle, Lambda concurrency cap, Athena scan cap,
  encryption, error alarm, and account-wide budget were inspected. Alert
  recipients remain unconfigured until an approved recipient is recorded.

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

### Internal uploader resilience — complete

- Accepted records are acknowledged and removed individually, so a later
  failure cannot resend earlier `202` responses or erase a record queued while
  an upload is in flight.
- Failed requests persist a six-attempt, equal-jitter exponential backoff with
  a one-hour cap. Retries run only when the MV3 worker naturally wakes; they do
  not add alarms, sleeps, keepalives, or agent-visible failures.
- Legacy queue records migrate in place, expired records still drop after seven
  days, and transport timeouts or rejections resolve as best-effort drain
  results rather than escaping to task execution.
- A live browser-context exercise through the product uploader delivered and
  acknowledged a valid summary. An unavailable route produced a persisted
  retry with backoff, and an early worker wake made no network request.

## Remaining roadmap

| Phase        | Outcome                                                                                                                | Gate / evidence                                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 5            | Build S3 → SQS → Bluebox exporter with Secrets Manager, DLQ, kill switch, bounded backfill, and Athena parity queries. | Vendor gate recorded; issue-#120 answers match the fixture's Athena result within agreed lag.                          |
| 6            | Privacy, store listing, disclosure, release-checklist, and data-practice consistency pass; internal dogfood.           | Privacy/data-practice review signed off.                                                                               |
| 7            | Explicit-opt-in 5% beta under the USD 20 AWS budget.                                                                   | Two weeks within privacy, reliability, data-quality, and cost limits.                                                  |
| 8            | Small stable canary and controlled expansion.                                                                          | Owner reviews evidence and authorizes every expansion.                                                                 |

## Required decisions before Phase 5 / external beta

- Record the Bluebox plan, expected cost, OTLP transport/authentication,
  storage region, retention, deletion/export behavior, query retention/model
  training terms, and named authorized users.
- Keep the deployed endpoint available only through an internal build
  configuration.
- Complete the privacy/store disclosure review before any published build is
  given an endpoint or beta consent is enabled.

## Verification snapshot

- 26 focused extension telemetry tests pass, including retry persistence,
  partial acknowledgement, timeout, attempt-cap, and worker-recovery coverage.
- Extension TypeScript check passes.
- Production Vite build passes and contains no configured telemetry endpoint.
- Internal Vite build was verified to contain an explicitly supplied test
  endpoint.
- A live browser-context uploader smoke test passes against the internal stack,
  including successful acknowledgement and outage deferral.
- CDK synthesis, four ingest-policy tests, and four stack-policy tests pass (34
  focused telemetry tests in total).

The detailed design, schema, decision stamp, and acceptance criteria remain in
[RFC LP-25](rfcs/lp-0025-optional-fleet-telemetry.md).
