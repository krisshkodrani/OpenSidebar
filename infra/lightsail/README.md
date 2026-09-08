# Lightsail application host

Production-shaped single-host deployment for the first few OpenSidebar testers.
It runs Caddy, the modular Node API, and PostgreSQL. Temporal is deliberately
absent until LP-32.

## Local smoke run

Copy `.env.example` to `.env`, replace the password, set
`COOKIE_SECURE=false` and add `NODE_ENV=development` plus `DEV_ACCOUNT_ID` to
the API environment only for local development. Then run:

```sh
docker compose up --build
```

Production must not set `DEV_ACCOUNT_ID`. CloudFront routes allowlisted API and
launch paths to `api-origin.opensidebar.com`; static site and Playground assets
remain private-S3 origins. Security groups expose only TCP 80/443.

Preview infrastructure creation from the repository root with
`pnpm lightsail:provision`. It makes no AWS calls unless `--apply` is provided.
Configuration overrides are listed at the top of
`scripts/provision-lightsail.mjs`; the defaults implement the approved Frankfurt
testing baseline. New instances receive `cloud-init.sh`; its completion marker
is `/var/lib/opensidebar/cloud-init-complete`. The provisioner also converges
instance metadata to token-required IMDSv2.

Backups use `backup.sh` with an attached private Lightsail bucket and
`BACKUP_AGE_RECIPIENT`. Keep the matching age identity offline; provide it as
`BACKUP_AGE_IDENTITY_FILE` only during recovery. A restore always targets
`opensidebar_restore` first and never overwrites the live database.
Run and record a clean-host restore before switching production traffic.
Install `jq` as well as `age` and the AWS CLI. After each successful upload,
`prune-backups.sh` removes expired object versions only below the fixed
`postgres/daily/` or `postgres/weekly/` prefixes; this is necessary because a
versioned Lightsail bucket otherwise retains deleted versions indefinitely.

On the host, keep the release at `/opt/opensidebar` and secrets in the root-only
`/etc/opensidebar/playground.env`. `install-systemd.sh` installs the boot-time
Compose unit and persistent daily/weekly backup timers. It never starts the
public application stack; that remains an explicit operator action after review.

The downsized PlayScenario host uses `compose.shared.yaml` instead: it adds only
the capped API container to `playscenario_default`, creates an isolated database
and role with `init-shared-database.sh`, and lets the existing frontend Nginx
load `nginx-api-origin.conf`. It must not run the dedicated PostgreSQL or Caddy
services. Install its boot unit with `install-shared-systemd.sh`.
