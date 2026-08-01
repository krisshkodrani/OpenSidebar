# OpenSidebar fleet telemetry infrastructure

This is the isolated AWS CDK project for RFC LP-25 Phase 3. It is not part of
the extension bundle and contains no client credentials or Bluebox token.

The stack creates:

- API Gateway HTTP API `POST /v1/telemetry`;
- browser-extension CORS preflight for anonymous JSON `POST` requests;
- a validator Lambda with five reserved concurrent executions;
- a closed-schema validation gate and 32 KiB request limit;
- direct Firehose delivery to a private KMS-encrypted S3 bucket;
- 30-day raw-object expiry and seven-day non-current-version expiry;
- a Glue JSON table and Athena workgroup capped at 100 MiB per query;
- API throttling, Lambda error alarms, and an optional email budget alert.

The Lambda never logs request bodies. API Gateway is intentionally public and
does not use an embedded client key: a key in a published extension would not
be secret. Abuse is bounded by throttles, concurrency, payload size, schema
validation, and budget/route controls.

From this directory, after installing the local dependencies:

```text
npm install
npx cdk synth
npx cdk diff
```

The internal stack is deployed in `eu-central-1`, independent of the AWS
profile's default region. Override it only through `TELEMETRY_AWS_REGION` after
an approved region change. Set `BUDGET_EMAIL` only after an approved recipient
is recorded; the current deployment has no notification subscriber. No deploy
command belongs in the extension release workflow.
Athena operators must receive explicit read access to the curated bucket and
write access to the Athena result prefix through a separate named IAM role.

Phase 3 does not create a Bluebox exporter, SQS queue, Secrets Manager token, or
extension upload path. The exporter remains Phase 5; the Phase 4 uploader lives
in the extension and receives its endpoint only in an explicit internal build.

## Internal extension upload (Phase 4)

The published extension has no telemetry endpoint compiled into it. An internal
build may opt into the uploader with:

```powershell
$env:FLEET_TELEMETRY_INTERNAL_ENDPOINT = "https://<api-id>.execute-api.eu-central-1.amazonaws.com/v1/telemetry"
pnpm exec vite build --config apps/extension/vite.config.ts --mode internal
```

The uploader sends only consented, sampled, schema-validated summaries. It is
best-effort: accepted records are removed individually, while a non-`202`,
timeout, or network failure persists an equal-jitter exponential backoff for a
later natural MV3 worker wake. A record is dropped after six failed deliveries
or seven days in the bounded queue. Upload never adds an alarm or keepalive and
never changes or waits on an agent task.
