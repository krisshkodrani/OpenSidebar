# Lightsail Playground runbook

Status: implementation runbook for LP-26/LP-28 Goal 1.

## Fixed testing configuration

- AWS region: `eu-central-1` (Frankfurt).
- Lightsail bundle: 2 vCPU, 2 GB RAM, 60 GB SSD, static IPv4.
- Daily PostgreSQL backups: 7 days.
- Weekly PostgreSQL backups: 4 weeks.
- Lightsail snapshots: 7 days.
- PostgreSQL: the dedicated-stack baseline is major version 16 on Alpine. The
  current USD 12 shared host deliberately reuses PlayScenario's healthy
  `pgvector/pgvector:pg15` container with a separate `opensidebar` database and
  `playground_service` owner; upgrades require a backup/restore rehearsal.
- Cognito: Essentials, managed email OTP, public web client with authorization
  code and PKCE.
- Canonical Control Center: `https://opensidebar.com/playground`.
- Target: `https://play.opensidebar.com`.
- Origin DNS: `api-origin.opensidebar.com`, reachable only through TLS. The
  Lightsail firewall exposes TCP 80/443 publicly; SSH remains restricted to an
  operator CIDR and PostgreSQL is never published.

Values are configuration defaults until applied to the AWS account. Record
resource IDs and the deployment timestamp in the private operator inventory;
never commit secrets or account identifiers here.

## Provision

1. Preview the exact resources with `pnpm lightsail:provision`. Apply only after
   review with `pnpm lightsail:provision -- --apply`. The command verifies the
   active bundle is exactly the USD 12/month, 2 vCPU, 2 GB, 60 GB plan before
   creating anything; it is safe to rerun as the instance becomes ready. The
   default backup bucket is the USD 1/month, 5 GB plan, making the fixed testing
   baseline USD 13/month before optional monitoring, DNS, taxes, and overages.
2. Point `api-origin.opensidebar.com` at the static IP. Do not proxy PostgreSQL,
   metrics, Docker, SSH, or Temporal through this hostname.
3. The provisioner's Ubuntu launch script installs Docker Engine, Compose v2,
   AWS CLI, `age`, `jq`, unattended security updates, bounded Docker logging,
   and 2 GB emergency swap. After first boot, verify
   `/var/lib/opensidebar/cloud-init-complete`, Docker/Compose versions, active
   unattended upgrades, swap configuration, and IMDSv2-required metadata. Add
   the CloudWatch agent or equivalent host alarms before public traffic.
4. Put the reviewed release at `/opt/opensidebar` and copy
   `infra/lightsail/.env.example` to `/etc/opensidebar/playground.env`, readable
   only by root. Generate distinct random PostgreSQL passwords and set Cognito,
   backup, and age-recipient values. Run
   `sudo sh infra/lightsail/install-systemd.sh`; inspect the installed stack and
   daily/weekly backup units before starting them. The installer enables the
   units for future boots but starts neither traffic nor timers immediately.
5. Create a private, versioned Lightsail object-storage bucket in Frankfurt and
   attach this instance through Lightsail resource access. Lightsail instances
   do not support EC2-style service roles; do not put a general IAM access key
   on the host. Generate an age recovery identity offline and configure only its
   public recipient on the server.
6. Run `docker compose -f infra/lightsail/compose.yaml config` and inspect the
   resolved output for missing variables or public database ports.
7. Start with `sudo systemctl start opensidebar-stack`; inspect container health
   and `journalctl -u opensidebar-stack`. Run one manual encrypted backup, then
   start both backup timers and inspect `systemctl list-timers`.
8. Verify `/health/live` and `/health/ready` through localhost and the origin.

### Existing shared PlayScenario host

For the current downsized testing host, do not run the dedicated PostgreSQL or
proxy services from `compose.yaml`. Initialize the isolated role/database with
`init-shared-database.sh`, run the API with `compose.shared.yaml`, and install
`opensidebar-shared.service`. The API is limited to 256 MB, 0.5 CPU, and a
192 MB Node heap on the existing `playscenario_default` network.

LP-28 adds a separate `opensidebar_service` database role and
`CONTROL_DATABASE_URL`; never reuse the `playground_service` credential for the
control schema. Re-run `init-shared-database.sh` with distinct
`PLAYGROUND_DB_PASSWORD` and `CONTROL_DB_PASSWORD` values before enabling the
master cloud-control flag.

Mount `nginx-api-origin.conf` into the existing frontend with
`playscenario-opensidebar.override.yaml`. Validate Nginx before recreating only
the frontend service, then verify both `playscenario.ai` and the API readiness
endpoint. Install `opensidebar-cert-renew.timer`; it uses the existing Certbot
volumes and reloads Nginx only after a successful renewal check.

The shared host needs the AWS CLI and `age` for backups. Keep both backup timers
disabled until an offline-generated age recipient is present and a manual
encrypted backup/restore has passed.

Production must never set `DEV_ACCOUNT_ID` or `COOKIE_SECURE=false`.

## LP-28 cloud-control prerequisites

1. Verify the published Chrome Web Store item ID. The OpenSidebar production ID
   is `hakbnbbkiehiofnafdkcibbnkbdmjiha`. Set it as
   `OPENSIDEBAR_EXTENSION_ID`; the API uses that exact origin for CORS.
   Unpacked acceptance IDs may be added temporarily through the validated
   comma-separated `OPENSIDEBAR_EXTENSION_TEST_IDS` allowlist. Remove them after
   acceptance. They never replace the published identity.
2. Converge Cognito with `pnpm playground:provision-cognito -- --apply`.
   Extension sign-in uses the cloud service's bounded email-code and verify
   endpoints; Cognito remains the email-OTP authority. The extension does not
   embed Cognito configuration or request Chrome's `identity` permission.
3. Preview `pnpm cloud:provision-kms`, then apply it. If a new access key is
   required, use the explicit `--create-access-key --access-key-output` option,
   move the one-time values into `/etc/opensidebar/playground.env`, set that
   file to mode 600/root ownership, and securely remove the output file. The IAM
   user is limited to DescribeKey, GenerateDataKey, and Decrypt on the one
   credential key.
   On the shared host, pass the transferred one-time JSON to
   `configure-lp28-env.sh`; it atomically updates the root-only environment,
   generates the separate control-role password, forces every cloud flag off,
   and removes the transferred credential file.
4. Deploy the image with all five LP-28 flags false. Verify existing Playground
   acceptance and that `/api/v1/account` returns `cloud_control_disabled`.
   When Docker is unavailable on the build workstation, build the verified
   `apps/cloud-service/dist/server.js` bundle first, transfer only the runtime
   package, migrations, and `Dockerfile.prebuilt`, then build that minimal
   runtime context on Lightsail. Never transfer workspace `node_modules`.
   Run `smoke-shared-image.sh <candidate-tag>` before changing
   `OPENSIDEBAR_API_IMAGE`; it starts the candidate without a public port and
   proves readiness, the disabled control response, and an unaffected
   Playground login redirect, then removes it.
   Promote with `deploy-shared-image.sh <candidate-tag>`; it atomically updates
   the root environment, waits for container health, verifies the control
   boundary, and restores the previous image automatically on failure.
5. Configure the exact extension ID/client, KMS alias, named Cognito tester
   subjects, and reviewed model allowlist. Enable flags in order:
   `CLOUD_CONTROL_ENABLED`, `EXTENSION_AUTH_ENABLED`,
   `CREDENTIAL_WRITES_ENABLED`, `PREFERENCE_WRITES_ENABLED`, then
   `RELAY_ENABLED`. Run the relevant acceptance check after each restart.
   On the shared host, use `set-cloud-control-stage.sh` with the stages
   `account`, `auth`, `credentials`, `preferences`, and `relay`; each stage
   restarts, checks health, proves Playground login is unaffected, validates
   the expected account/auth boundary, and rolls the environment back on
   failure. Use `disabled` for the full feature rollback.
6. Roll back by setting the affected leaf flag false first; keep authenticated
   credential deletion and device revocation available whenever safely
   possible. Never return a vaulted credential to facilitate rollback.

## CloudFront and static assets

1. Build and publish with `node scripts/deploy-sandbox.mjs`. This uploads the
   Control Center at `/playground`, a static `/sandbox` redirect, and a separate
   target entry page.
2. Preview the custom-origin change with
   `node scripts/attach-lightsail-origin.mjs --dry-run`, then apply it. At final
   cutover use `--cutover` to remove the legacy `/api/sandbox/*` behaviors. The apex forwards only
   `/api/v1/*`; the target distribution forwards only `/api/v1/target/*` and
   `/launch/*`.
3. The attach command creates or validates least-privilege origin-request
   policies. The control policy forwards only the host account/CSRF cookies,
   required mutation headers, and callback query strings. The target policy
   forwards only `__Host-os_playground_target` and its required headers; it
   cannot forward `__Host-os_session` or `os_csrf`.
4. Both API behaviors use CloudFront's disabled-cache policy. Do not forward the
   viewer `Host` header to the custom origin.

## Acceptance smoke

Using a named internal Cognito account:

1. Sign in through `/api/v1/playground/auth/login`; verify authorization code,
   state, and S256 PKCE are present.
2. Verify the apex receives `__Host-os_session` (`Secure`, `HttpOnly`,
   `SameSite=Lax`) and `os_csrf` (`Secure`, `SameSite=Strict`).
3. Create one Restock run, set it in stock with inventory, and create a launch.
4. Consume the launch once. A second use must return `410`.
5. Confirm the target receives only `__Host-os_playground_target` and its API
   projection omits feasibility, timers, relevance, expected results, and owner.
6. Add one shoe, submit a successful result, verify the Control Center observes
   the revisioned terminal result, then delete the run.
7. Attempt cross-account IDs, account-cookie-on-target, target-cookie-on-apex,
   missing/wrong Origin, missing/wrong CSRF, stale revision, fourth concurrent
   run, and 26th daily run. Each must fail with the documented status.

## Backups and restore

Schedule `infra/lightsail/backup.sh` daily and with `weekly` once per week.
The post-upload pruner enforces seven daily and four weekly backups, including
old object versions; keep the Lightsail bucket versioned and private. Dumps are encrypted locally to the
offline age recovery identity before upload, in addition to storage-provider
encryption at rest.

On the shared host, the backup deliberately uses the container-local PostgreSQL
peer superuser: the application roles remain mutually isolated, while the
encrypted archive contains both `playground` and `control` schemas. The script
validates the custom-format archive before encryption. Restore acceptance checks
both Playground runs and the control migration version.

Every release candidate performs a restore with `restore.sh`. The script restores
to `opensidebar_restore`, never the live database. On a clean replacement host:

Run `drill-shared-restore.sh` for an on-host transactional restore check without
retaining plaintext; it creates a root-only temporary dump, restores both
schemas into `opensidebar_restore`, verifies them, and removes the dump. The
separate offline-identity drill below is still required to prove decryption of
an uploaded encrypted object.

Keep the age identity off the server. Download and decrypt the selected object
on an operator workstation, then pipe the decrypted custom-format dump to
`sudo sh restore.sh --decrypted-stdin`. The script keeps the plaintext only in
its root-owned temporary file for the duration of the restore and removes it on
exit. The direct S3 mode exists for disaster-recovery environments where the
operator explicitly mounts the offline identity through
`BACKUP_AGE_IDENTITY_FILE`.

1. Deploy pinned containers without starting public traffic.
2. Restore the newest backup into `opensidebar_restore`.
3. Run schema/count/ownership checks and the Restock smoke against that database.
4. Record elapsed time; the Goal 1 target is under four hours.
5. Promote only through an explicit database connection change and restart.

## Monitoring and resource gates

Alert at 70/80/90% memory, 70/80/90% disk, repeated container restarts, failed
backups, readiness failures, PostgreSQL connection exhaustion, 5xx rate, and
AWS budget thresholds USD 10/18/23. Test load passes only if steady whole-host
memory is below 75%, stress is below 85%, there is no OOM or sustained swapping,
and at least 40% of disk remains free.

## Cutover and rollback

Keep the Lambda/DynamoDB Playground read-only but deployable until the new slice
passes all acceptance evidence. During cutover, stop new serverless run creation,
allow or expire existing synthetic runs, switch CloudFront behaviors, and run
the smoke. There is no production data migration for expired synthetic runs.

Rollback restores the previous CloudFront configuration and static bundle. Do
not delete either backend or DynamoDB table until the rollback drill succeeds.
After the agreed observation window, archive reusable tests/contracts and remove
the serverless application stack so only one production backend remains.

Temporal is absent from Goal 1 and from `infra/lightsail/compose.yaml`.
