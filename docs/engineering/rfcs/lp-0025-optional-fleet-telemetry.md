# RFC LP-25 — Optional privacy-preserving fleet telemetry

Lifecycle status: Decision stamped
Date: 2026-07-27
Decision date: 2026-07-27 (owner approved LP-25 as recommended in session)
Scope: an explicit-opt-in, default-off fleet telemetry path for published
OpenSidebar extensions; a closed, versioned session-summary schema; an
AWS-hosted ingest and analytics backend; and a backend-only Bluebox OTLP
projection for natural-language queries. This changes OpenSidebar's current
public promise that it has no telemetry or first-party servers, so product code
and external collection remain blocked until an owner Decision Stamp exists and
the disclosure work in this RFC is complete.
Related: [GitHub issue #120](https://github.com/krisshkodrani/OpenSidebar/issues/120)
(trivial YouTube tasks never called `done()`), LP-7 (local observability spine
and backend-side OTLP mapping), `docs/guides/bluebox-otel.md`, and
`docs/architecture/trace-viewer-otel-mapping.md`.

## 1. Problem

OpenSidebar can diagnose failures from local development traces, but it has no
visibility into reliability failures in published extension installations. That
gap is now concrete:

- Issue #120 found zero `done()` calls across 32 observed sessions and 143 model
  turns. Trivial tasks continued until turn caps or stuck/give-up guardrails.
- All observed calls used one non-default executor model, but the available
  sample could not establish whether model choice caused the missing completion
  signal.
- The current telemetry came from local development infrastructure. It cannot
  answer how often this happens across published versions, providers, models,
  task shapes, or browser environments.
- Full local traces are deliberately rich. Uploading them would expose prompts,
  URLs, page content, screenshots, tool arguments, model responses, and other
  browsing data. Regex redaction cannot make that safe for automatic fleet
  collection.

The product also makes the opposite public promise today:

- `PRIVACY_POLICY.md`: no analytics, telemetry, tracking, crash reporting, or
  hosted OpenSidebar service.
- `docs/store-listing.md`: no telemetry and no OpenSidebar servers.
- `docs/store-privacy-answers.md`: the developer collects nothing.
- `docs/providers.md` and `docs/features/security.md`: no hosted telemetry or
  relay.

Adding a backend is therefore a product and privacy direction change, not merely
an observability implementation.

## 2. Goals

1. Measure reliability of published extension sessions without collecting task
   content or browsing content.
2. Make issue #120's failure shape directly queryable:
   - Was `done()` ever proposed?
   - Was completion accepted or rejected?
   - Was objective evidence observed?
   - How many turns followed that evidence?
   - Did the session stop through completion, user action, error, or a guardrail?
3. Compare failure rates by extension version and normalized executor, planner,
   and judge model identifiers.
4. Keep S3/Athena as the exact, replayable source of truth.
5. Add Bluebox as a backend-only natural-language query and correlation layer.
6. Keep telemetry failures completely outside the agent's correctness and
   latency paths.
7. Hold the AWS beta budget to USD 20/month, excluding a Bluebox commercial
   subscription.

## 3. Non-goals

- Uploading local traces, prompts, plans, screenshots, DOM, URLs, page titles,
  tool arguments/results, model responses, reasoning, profile data, form data,
  cookies, history entries, downloads, API keys, or authentication material.
- Remotely executing tasks or proxying model-provider traffic.
- Identifying or counting unique people or installations.
- Product analytics, advertising, attribution, growth profiling, or generalized
  market research.
- Replacing the local trace viewer or the LP-7 development observability spine.
- Using telemetry as execution truth. Fleet analytics may reveal a problem, but
  it may not mark an individual task complete or change completion policy.
- Claiming that the system is legally anonymous. The design minimizes and
  avoids persistent identity, but network processors still observe connection
  metadata.

## 4. Chosen data boundary

The extension may construct exactly one wire type:
`FleetTelemetryEnvelopeV1`. It is not a `TraceEntry`, `ObsSpan`, or generic
dictionary. The encoder accepts only a closed schema of enums, booleans,
bounded integers, and allowlisted identifiers.

Illustrative shape:

```ts
interface FleetTelemetryEnvelopeV1 {
  schemaVersion: 1;
  eventId: string; // random per session summary; never reused
  extension: {
    version: string;
    channel: "stable" | "beta" | "dev";
  };
  environment: {
    browserMajor: number;
    osFamily: "windows" | "macos" | "linux" | "chromeos" | "other";
  };
  runtime: {
    provider: FleetProviderId;
    executorModel: FleetModelId;
    plannerModel: FleetModelId;
    judgeModel: FleetModelId;
    taskShape: FleetTaskShape;
  };
  execution: {
    plannerStepCount: number;
    turnCount: number;
    durationBucket: FleetDurationBucket;
    toolCounts: Partial<
      Record<
        FleetToolName,
        {
          attempted: number;
          failed: number;
        }
      >
    >;
  };
  completion: {
    doneCallCount: number;
    firstDoneCandidateTurn?: number;
    acceptedDoneTurn?: number;
    acceptedSource: "model_done" | "trusted_tool" | "none";
    rejectedDoneCount: number;
    rejectionReasons: FleetCompletionReason[];
    evidenceTypes: FleetEvidenceType[];
    firstSatisfiedEvidenceTurn?: number;
    turnsAfterFirstSatisfiedEvidence?: number;
  };
  result: {
    outcome: FleetOutcome;
    terminalReason: FleetTerminalReason;
    errorCodes: FleetErrorCode[];
  };
}
```

This is illustrative rather than the final generated TypeScript contract. The
contract review in Phase 1 fixes bounds, optionality, and every enum member
before network code exists.

### 4.1 Identity and time

- `eventId` groups or deduplicates one session summary only. It is not an
  installation ID and expires with the record.
- No account, email, Chrome profile, extension installation, device, advertising,
  or persistent random identifier is collected.
- The client does not send an exact wall-clock start time. AWS stamps receipt
  time and exposes a day/hour partition appropriate for aggregate analysis.
- Exact browser patch versions and detailed hardware characteristics are
  excluded to reduce fingerprinting.
- IP addresses and request headers are not copied into the telemetry dataset.
  API access logs are disabled by default; any operational logs use a minimal
  format without source IP, user agent, request body, or query string.

### 4.2 Allowlisted model and provider values

Provider and model values are mapped locally to a reviewed allowlist. Unknown or
custom values become `other`; the user's custom endpoint or model string is
never sent. This keeps a useful issue-#120 comparison without creating a
free-text exfiltration field.

### 4.3 Task shape

`taskShape` is derived from actions already executed, not from user text. The
initial vocabulary is intentionally coarse:

- `single_interaction`
- `navigation`
- `read`
- `form`
- `multi_tab`
- `download`
- `browser_management`
- `mixed`
- `unknown`

No site, domain, fixture, product, benchmark, or task noun appears in the value.

### 4.4 Completion evidence

Evidence fields report only closed semantic categories already produced by the
completion pipeline, for example:

- `navigation_committed`
- `target_state_observed`
- `media_state_changed`
- `form_state_observed`
- `download_observed`
- `page_confirmation_observed`
- `none`

They never contain evidence text, selectors, element labels, URLs, page state,
or judge explanations. The pipeline in `agent/completion/pipeline.ts` remains
the sole completion authority; telemetry only projects its decisions.

### 4.5 Defense in depth

Both boundaries validate the same generated JSON Schema:

1. The extension projector can construct only the closed TypeScript type.
2. The AWS ingest Lambda rejects unknown keys, arbitrary strings, out-of-range
   numbers, excess collection lengths, unsupported schema versions, compressed
   bombs, and payloads over 32 KiB after decompression.

Server-side PII regexes may reject suspicious values as a final alarm, but they
are not the privacy boundary. The absence of open-ended content fields is the
privacy boundary.

## 5. Extension architecture

New product behavior lives under
`apps/extension/src/background/telemetry/`, with reusable external I/O routed
through the existing small environment-port direction rather than adding a
parallel browser-adapter tree. The closed wire type, JSON Schema, and
dependency-free validator live in
`packages/observability-schema/src/fleet-telemetry.ts`; this reuses the shared
schema package without reusing its rich trace types.

Proposed modules:

```text
background/telemetry/
  projector.ts         — pure session state → closed summary
  consent-policy.ts    — disclosure-version and opt-in rules
  sampler.ts           — per-session sampling, initially 5%
  queue.ts             — bounded local delivery queue
  uploader.ts          — HTTPS delivery with bounded retry
  controller.ts        — lifecycle integration and kill switches
```

### 5.1 Consent

- Default is off for new and existing users.
- No telemetry network request occurs before an affirmative action in the
  extension UI.
- Consent is tied to a disclosure version. Adding a data category or recipient
  invalidates prior consent until the changed disclosure is accepted.
- Opt-out stops new collection immediately and clears the unsent local queue.
- Settings provide “View example payload,” “View last payload,” “Clear unsent
  telemetry,” and the on/off control.
- A future manual diagnostic report is a separate feature with a per-report
  preview and consent. It is not part of this RFC.

Sidepanel components remain environment-agnostic and use
`sidepanel/runtime.ts`; they do not call `chrome.*`.

### 5.2 Projection and queueing

- One summary is generated per terminal session: completed, user-stopped,
  failed, guardrail-stopped, or recovered-as-abandoned on the next worker start.
- The projector receives only the fields needed for the safe contract, not the
  full trace object.
- The local queue is bounded by record count, total bytes, and age. Proposed
  defaults: 20 records, 512 KiB, seven days.
- Retry uses exponential backoff with jitter and a hard attempt cap. Delivery is
  best-effort; records may be dropped.
- Telemetry never extends an agent session, holds a service-worker keepalive,
  changes the outcome, or surfaces as a task error.
- Sampling starts at 5% of consenting sessions and is decided independently for
  each session. No persistent seed is used.

### 5.3 Kill switches

There are independent controls for:

- local collection;
- AWS upload acceptance;
- Bluebox export.

The extension build can disable fleet telemetry entirely. For consenting
clients, the ingest response may communicate a short-lived upload-disable flag;
clients that never consent do not fetch remote telemetry configuration.
Backend rejection and budget alarms provide an immediate server-side stop even
when clients have not received the flag.

## 6. AWS backend

The initial production region is `eu-central-1`. Infrastructure is defined in
TypeScript AWS CDK under a new, isolated telemetry-infrastructure project; no
AWS SDK or credentials enter the extension bundle.

```text
POST /v1/telemetry
  → API Gateway HTTP API
  → validation Lambda
  → Data Firehose
  → S3 (KMS, day/hour/schema/version partitions)
  → Glue Catalog
  → Athena workgroup
```

### 6.1 Ingest

- The endpoint is public and treated as untrusted. A key embedded in a published
  extension would not be a secret and is not used as an authentication claim.
- API Gateway route throttles, Lambda reserved concurrency, a 32 KiB payload
  limit, and account budgets bound abuse and accidental cost.
- Validation happens before Firehose.
- The Lambda returns quickly and does not perform Bluebox export synchronously.
- Accepted, rejected, throttled, and dropped counts are operational metrics.
  Request bodies are never CloudWatch logs.
- A rate or cost incident can disable the route without affecting the extension.

### 6.2 Storage and queries

- S3 blocks public access and uses server-side KMS encryption.
- Raw accepted summaries expire after 30 days through an S3 lifecycle rule.
- Curated aggregate tables may be retained for 12 months only after small-cell
  suppression removes rare combinations.
- Firehose buffers records to avoid one S3 object/KMS operation per session and
  may convert curated data to Parquet.
- Athena workgroups cap bytes scanned and publish saved, versioned queries.
- Raw-data access is limited to named operators; routine investigation uses
  aggregates.

### 6.3 Cost controls

The beta target is below USD 20/month:

- AWS Budget notifications at USD 20, 50, and 100;
- a forecast alarm before the first threshold;
- route throttling and Lambda concurrency caps;
- 5% client sampling;
- no success-body logs;
- partitioned Parquet for repeat queries;
- no optional dashboard service in the first release.

The expected AWS cost at one million 5 KiB uploads is approximately USD 7–15
per month. Bluebox licensing and ingestion charges are separate and must be
known before production Bluebox activation.

## 7. Bluebox query support

S3/Athena is authoritative. Bluebox is an optional, asynchronous read and
correlation surface:

```text
S3 accepted-summary object event
  → SQS
  → Bluebox exporter Lambda
  → OTLP/http-protobuf
  → Bluebox
  → `bluebox ask`
```

### 7.1 Export boundary

- Only already-validated `FleetTelemetryEnvelopeV1` records are readable by the
  exporter.
- The exporter maps the closed summary to OTel with
  `service.name=opensidebar-fleet` and low-cardinality `os.*` attributes.
- Deterministic trace/span IDs derive from `eventId`, making retry and backfill
  idempotent.
- The Bluebox endpoint and ingest token live in AWS Secrets Manager. They never
  ship in the extension, repository, Lambda logs, or client responses.
- SQS retry and a dead-letter queue isolate outages. Bluebox cannot block API
  acceptance or S3 storage.
- The exporter has an independent disable switch and supports bounded backfill
  from S3 within the raw retention window.

This preserves the existing rule in `docs/guides/bluebox-otel.md`: ingest tokens
must not ship in a browser bundle.

### 7.2 Query contract

The first supported natural-language questions are:

```text
Which extension versions had the highest completion-overrun rate this week?

Which executor and judge model combinations most often ended without done()?

Show the count of sessions where objective evidence existed but execution
continued for more than two turns.

Compare max-turn exhaustion and done-call rates by task shape.

Did completion-loop failures increase after the latest stable release?
```

Every release has equivalent saved Athena SQL. A fixture dataset is queried
through both systems; Bluebox groupings and counts must match Athena within the
documented time-window and ingestion-lag tolerance. Bluebox answers are
investigative aids, not authoritative numbers when they cannot be reproduced
from Athena.

### 7.3 Vendor gate

Before production Bluebox activation, the owner must record:

- the applicable Bluebox plan and expected monthly charge;
- supported OTLP transport and authentication;
- data storage region and retention;
- deletion/export behavior;
- DPA/subprocessor terms;
- whether natural-language query text is retained or used for model training;
- the named people allowed to query fleet data.

If this review fails, AWS telemetry may operate without Bluebox. The product
must not silently substitute another recipient; that requires a disclosure
revision and owner decision.

## 8. Privacy, store, and user-facing changes

The feature must be described as “optional privacy-preserving reliability
telemetry,” not guaranteed anonymous telemetry.

Before any store build can transmit:

- update `PRIVACY_POLICY.md`;
- update `docs/store-listing.md`;
- update `docs/store-privacy-answers.md`;
- update `docs/providers.md`;
- update `docs/features/security.md`;
- update `docs/oss-byok-launch-roadmap.md`;
- update `docs/release-checklist.md`;
- add the in-product prominent disclosure and affirmative consent UI;
- declare AWS and Bluebox roles, purposes, categories, retention, and contact
  path consistently.

Chrome's current policy permits proportionate performance/reliability analytics
that support the disclosed single purpose, but requires prominent disclosure of
all collection and proactive disclosure when practices change. The extension
must not transmit until the store listing, privacy policy, dashboard answers,
and runtime behavior agree.

This RFC is technical policy, not legal advice. Production activation requires
the project's privacy/legal owner to confirm the lawful basis, processor terms,
and EU transfer posture.

## 9. Security and abuse model

| Risk                                              | Control                                                                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A field becomes a covert arbitrary-string channel | Closed enums/numbers only; generated schema; reject unknown keys at both boundaries                              |
| Full traces accidentally reach the uploader       | Projector accepts a narrow input; type and dependency tests forbid imports from trace/blob payload modules       |
| Embedded credential is extracted                  | No client secret; public untrusted endpoint; backend throttling and budgets                                      |
| Cost-amplification attack                         | Payload cap, route throttle, reserved concurrency, sampling, alarms, emergency route disable                     |
| Data poisoning                                    | Treat results statistically; release/channel validation; anomaly flags; do not use fleet data as execution truth |
| Re-identification from rare combinations          | Coarse environment fields, no persistent ID, no exact client time, small-cell suppression                        |
| Operational logging retains network identity      | No request-body logs; minimal access logging without source IP/user agent/query string                           |
| Bluebox outage or compromise affects ingestion    | Async SQS fan-out, least privilege, independent kill switch, S3 canonical                                        |
| Query model fabricates a trend                    | Saved Athena parity queries; Bluebox is advisory                                                                 |
| Schema expansion occurs silently                  | Versioned consent and schema; new category/recipient requires disclosure revision                                |

## 10. Implementation phases

| Phase | Content                                                                                                                | Exit criterion                                                                            |
| ----- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 0     | Approve this RFC; record privacy owner and AWS/Bluebox production gates                                                | Valid owner Decision Stamp                                                                |
| 1     | Final closed contract, JSON Schema, projector, threat-model tests; no network code                                     | Forbidden-field and field-coverage tests green                                            |
| 2     | Consent setting, disclosure UI, sampler, bounded local queue, payload inspector; uploader points only to a test double | E2E proves zero requests before opt-in and immediate opt-out                              |
| 3     | CDK stack: API Gateway, validator Lambda, Firehose, KMS/S3 lifecycle, Glue/Athena, budgets/alarms                      | Synthetic valid records queryable; invalid records rejected; lifecycle/config tests green |
| 4     | Extension uploader enabled only in internal builds; failure/retry/MV3 recovery tests                                   | Backend outage has no agent-visible effect                                                |
| 5     | S3→SQS→Bluebox exporter, Secrets Manager, DLQ, backfill, Athena parity query suite                                     | Issue-#120 query answers match the fixture's Athena result                                |
| 6     | Privacy/store/docs consistency pass and internal dogfood                                                               | Release checklist and data-practice review signed off                                     |
| 7     | Explicit-opt-in beta, 5% sample, USD 20 budget                                                                         | Two weeks within privacy, reliability, data-quality, and cost limits                      |
| 8     | Small stable canary, then controlled expansion                                                                         | Owner reviews beta evidence and authorizes each expansion                                 |

Estimated engineering effort is 10–14 focused days plus one to two weeks of
dogfood/beta observation. Each implementation phase is independently revertible.

Implementation status (2026-07-27): See the maintained
[fleet telemetry roadmap](../fleet-telemetry-roadmap.md) for achieved work,
remaining phases, and verification evidence. Phases 1 and 2 are implemented in
the working tree. Phase 1 provides the shared closed contract and validator,
pure projector, forbidden-field and bounds tests, model normalization tests,
and the five-case issue-#120 corpus.

Phase 2 adds installation-local, versioned consent that is deliberately
separate from synced user settings; a default 5% per-session sampler with no
persistent seed; lazy projection after the consent and sampling gates; a queue
bounded to 20 records, 512 KiB, and seven days; immediate queue and inspector
clearing on opt-out or stale consent; and an Advanced settings disclosure and
payload inspector. The only transport is an injected interface exercised by a
test double. Tests prove that absent, disabled, or stale consent cannot invoke
the random sampler, projector, or transport.

The published extension has no production endpoint or credential. A runtime
audit found that an individual `AgentLoop` terminal event is the wrong
activation point because it represents one execution lane and would
misattribute or double-count planner and judge work. The implemented Phase 4
adapter therefore attaches at the orchestrator's task-level terminal boundary.

Phase 3 infrastructure is implemented under `infra/telemetry/`. The isolated
CDK stack includes the public API Gateway route, validator Lambda, Firehose,
private KMS/S3 retention, Glue/Athena query surface, throttles, concurrency cap,
alarm, and a USD 40 account-wide budget. The Lambda policy tests pass locally, and the stack
synthesizes successfully with the available CDK CLI. No AWS account or
credentials were used and nothing was deployed.

Phase 4 now attaches local collection at the orchestrator's task-level terminal
boundary rather than an individual execution lane. The adapter keeps only the
closed aggregate facts needed by the schema; task text, URLs, results, DOM,
tool arguments, and trace entries are never retained or projected. Published
builds compile an empty upload endpoint. Only an explicit internal build can
drain a consented queue to the configured backend; a failed upload preserves
the bounded queue and never affects task completion.

## 11. Verification

### 11.1 Extension

- Unit: every projector branch emits only schema-approved values.
- Unit: custom models/providers map to `other`.
- Unit: sampling has no persistent seed or identifier.
- Unit: retry and queue bounds drop safely.
- Integration: telemetry off, consent absent, or consent version stale means no
  telemetry HTTP request.
- Integration: opt-out clears unsent records and stops projection.
- Integration: agent outcome, turns, timing, and UI are identical with upload
  success, failure, timeout, and route disable.
- Bundle audit: no AWS SDK credential, Bluebox token, OTLP endpoint secret, raw
  trace serializer, or forbidden telemetry field is reachable from the
  extension artifact.

### 11.2 Backend

- Contract tests share fixtures with the extension schema.
- Fuzz tests reject unknown keys, arbitrary strings, invalid enums, oversized
  arrays, and decompression bombs.
- Infrastructure tests assert private S3, KMS, lifecycle expiry, least
  privilege, route throttles, concurrency caps, and budget alarms.
- Logs are inspected to prove request bodies and source network identifiers are
  absent from configured application/access logs.
- Load test stays under the cost/concurrency envelope and returns controlled
  `429` responses.
- Backfill is idempotent.

### 11.3 Issue #120 regression observability

A synthetic corpus includes:

1. one session that calls `done()` and is accepted;
2. one that calls `done()` and is rejected before later acceptance;
3. one where objective evidence appears but `done()` is never called;
4. one that stops only at max turns;
5. one user-stopped session.

Athena and Bluebox must both report cases 3–4 as completion-loop failures, must
not classify case 2 as a failure after its eventual acceptance, and must keep
case 5 separate from autonomous failure.

### 11.4 Release evidence

- `pnpm run verify`;
- focused unit/integration/backend infrastructure tests;
- a store build network audit with telemetry disabled;
- a consented beta build payload review;
- Athena↔Bluebox fixture parity;
- a 30-day lifecycle expiration exercise in a shortened-lived test bucket;
- documented AWS cost forecast and Bluebox commercial cost;
- owner review of two weeks of beta metrics before stable expansion.

## 12. Rollout and rollback

Rollout order is synthetic → internal/unpacked → explicit-opt-in beta at 5%
sampling → small stable canary → controlled expansion.

Immediate rollback triggers:

- any prompt, URL, DOM, screenshot, arbitrary model string, tool payload, or
  persistent identifier reaches AWS or Bluebox;
- the extension sends before valid consent;
- store disclosures and runtime behavior diverge;
- telemetry changes agent behavior or task latency materially;
- projected monthly AWS cost exceeds USD 20 during beta without an approved
  explanation;
- endpoint abuse is not contained;
- Bluebox results materially disagree with Athena and cannot be explained by
  ingestion lag or query-window semantics.

Rollback disables AWS route acceptance and Bluebox export first, then ships an
extension update if client collection must be removed. Retained records continue
to follow the declared lifecycle and deletion obligations.

## 13. Alternatives

### Direct OTLP from the extension

Rejected. It would either embed a reusable ingest credential or expose an
unauthenticated general OTLP endpoint, and it risks mapping rich trace fields
that should never leave the browser.

### Upload the existing trace after regex redaction

Rejected. URLs, page text, names, form values, prompts, and model output cannot
be made safe by matching a few common PII formats. Data minimization must happen
by construction.

### Persistent random installation ID

Rejected for the initial system. It would improve unique-user and longitudinal
analysis but creates a pseudonymous tracking identifier that is unnecessary for
the issue-#120 reliability questions.

### Default-on telemetry with opt-out

Rejected. It conflicts with the current public promise and creates avoidable
consent and expectation risk for existing users.

### Bluebox as the only store

Rejected. Exact numbers, retention enforcement, vendor portability, replay, and
query verification require an owner-controlled canonical dataset. S3/Athena
remain authoritative.

### AWS only, no Bluebox

Viable fallback, but not the chosen product path. Athena provides exact analysis;
Bluebox adds the requested natural-language incident-query workflow. Bluebox
activation remains separately disableable if vendor review or commercial terms
fail.

## Recommended Decision

> This is an agent recommendation, not an owner Decision Stamp. Per
> `rfc-decision-process.md`, no product implementation or external collection
> may begin until the owner records a `## Decision` stamp.

Recommended status: **Approved**

Chosen path (recommended):

- Add explicit-opt-in, default-off fleet reliability telemetry using a closed,
  content-free `FleetTelemetryEnvelopeV1`; do not upload or redact full traces.
- Use API Gateway → validation Lambda → Firehose → KMS-encrypted S3 as the
  ingest path, with Glue/Athena as the authoritative query layer and 30-day raw
  retention.
- Add asynchronous S3/SQS → backend OTLP export to Bluebox for
  natural-language queries, with credentials in Secrets Manager and Athena
  parity tests.
- Ship through synthetic, internal, beta, and stable-canary stages under a USD
  20/month AWS beta budget.
- Complete in-product consent and all privacy/store disclosure changes before
  any published build transmits.

Required edits before implementation (recommended):

- None.

Non-blocking follow-ups (recommended):

- Evaluate small-cell noise or differential privacy before publishing any fleet
  aggregates outside the operating team.
- Add a separately consented, user-previewed diagnostic-report workflow if
  closed fleet summaries prove insufficient for individual support cases.
- Revisit sampling rate only after beta data establishes the minimum useful
  volume.

Do not do (recommended):

- Do not add a persistent installation/user identifier.
- Do not send prompts, plans, URLs, domains, page content, screenshots, tool
  arguments/results, model responses/reasoning, profile/form data, credentials,
  raw stack traces, or arbitrary strings.
- Do not emit directly from the extension to Bluebox or embed AWS/Bluebox
  credentials.
- Do not make Bluebox authoritative or let telemetry influence task completion.
- Do not enable collection before valid consent and matching store/privacy
  disclosures.

Evidence required before merge (recommended):

- Shared schema/forbidden-field tests, zero-request-before-consent E2E, opt-out
  and bounded-retry tests, bundle secret/field audit, and agent-behavior parity
  under telemetry failures.
- Backend validation/fuzz tests, private-storage/lifecycle/IAM infrastructure
  assertions, controlled-load test, logging review, budget alarms, and
  idempotent backfill.
- Athena↔Bluebox parity on the issue-#120 completion corpus, plus a live
  natural-language query that finds “objective evidence present, no `done()`,
  guardrail termination.”
- Privacy policy, Chrome Web Store privacy answers/listing, security/provider
  docs, consent UI, and release checklist reviewed together before production
  activation.

Recommended next action: **Implement**

## Decision

Status: Approved

Chosen path:

- Add explicit-opt-in, default-off fleet reliability telemetry using a closed,
  content-free `FleetTelemetryEnvelopeV1`; do not upload or redact full traces.
- Use API Gateway → validation Lambda → Firehose → KMS-encrypted S3 as the
  ingest path, with Glue/Athena as the authoritative query layer and 30-day raw
  retention.
- Add asynchronous S3/SQS → backend OTLP export to Bluebox for
  natural-language queries, with credentials in Secrets Manager and Athena
  parity tests.
- Ship through synthetic, internal, beta, and stable-canary stages under a USD
  20/month AWS beta budget.
- Complete in-product consent and all privacy/store disclosure changes before
  any published build transmits.

Required edits before implementation:

- None.

Non-blocking follow-ups:

- Evaluate small-cell noise or differential privacy before publishing any fleet
  aggregates outside the operating team.
- Add a separately consented, user-previewed diagnostic-report workflow if
  closed fleet summaries prove insufficient for individual support cases.
- Revisit sampling rate only after beta data establishes the minimum useful
  volume.

Do not do:

- Do not add a persistent installation/user identifier.
- Do not send prompts, plans, URLs, domains, page content, screenshots, tool
  arguments/results, model responses/reasoning, profile/form data, credentials,
  raw stack traces, or arbitrary strings.
- Do not emit directly from the extension to Bluebox or embed AWS/Bluebox
  credentials.
- Do not make Bluebox authoritative or let telemetry influence task completion.
- Do not enable collection before valid consent and matching store/privacy
  disclosures.

Evidence required before merge:

- Shared schema/forbidden-field tests, zero-request-before-consent E2E, opt-out
  and bounded-retry tests, bundle secret/field audit, and agent-behavior parity
  under telemetry failures.
- Backend validation/fuzz tests, private-storage/lifecycle/IAM infrastructure
  assertions, controlled-load test, logging review, budget alarms, and
  idempotent backfill.
- Athena↔Bluebox parity on the issue-#120 completion corpus, plus a live
  natural-language query that finds “objective evidence present, no `done()`,
  guardrail termination.”
- Privacy policy, Chrome Web Store privacy answers/listing, security/provider
  docs, consent UI, and release checklist reviewed together before production
  activation.

Next action:

- Implement
