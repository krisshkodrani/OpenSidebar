# Isolated $7 Temporal evaluation

LP-33 research only. Nothing in this directory enables product flags. The
stack publishes no ports; the worker makes outbound HTTPS calls to claim opaque
shadow events and is the only process connected to Temporal.

1. Run `pnpm temporal:isolated:provision` to review the exact dry run.
2. Authenticate AWS as `aipoweredapps-admin`, then add `--apply`. SSH is
   restricted to Lightsail browser-connect. The provisioner refuses any bundle other than the active
   $7/1-GB/40-GB plan.
3. Copy this directory and the worker image to `/opt/opensidebar-temporal`.
4. Store secrets in root-only `/etc/opensidebar-temporal/isolated.env` and run
   Compose with `--env-file`; do not commit that file.
5. Run `run-gates.sh`; named testers remain blocked until its report passes.

Sustained swap, less than 150 MiB available memory, OOM/restart, less than 40%
disk free, or failed canary scanning rejects this topology. Stop the stack and
retain evidence; do not upgrade automatically.
