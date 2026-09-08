#!/bin/sh
set -eu

test "$(id -u)" -eq 0 || {
  echo "run as root" >&2
  exit 2
}

STAGE=${1:?pass disabled, account, auth, credentials, preferences, or relay}
ENV_FILE=${ENV_FILE:-/etc/opensidebar/playground.env}
case "$STAGE" in
  disabled|account|auth|credentials|preferences|relay) ;;
  *) echo "invalid cloud-control stage" >&2; exit 2 ;;
esac

backup=$(mktemp "${ENV_FILE}.rollback.XXXXXX")
chmod 0600 "$backup"
cp -p "$ENV_FILE" "$backup"
committed=false
rollback() {
  if [ "$committed" != true ]; then
    cp -p "$backup" "$ENV_FILE"
    systemctl restart opensidebar-shared.service || true
  fi
  rm -f -- "$backup"
}
trap rollback EXIT INT TERM

python3 - "$ENV_FILE" "$STAGE" <<'PY'
import os
import pathlib
import tempfile
import sys

path = pathlib.Path(sys.argv[1])
stage = sys.argv[2]
order = ["disabled", "account", "auth", "credentials", "preferences", "relay"]
enabled_through = order.index(stage)
updates = {
    "CLOUD_CONTROL_ENABLED": enabled_through >= 1,
    "EXTENSION_AUTH_ENABLED": enabled_through >= 2,
    "CREDENTIAL_WRITES_ENABLED": enabled_through >= 3,
    "PREFERENCE_WRITES_ENABLED": enabled_through >= 4,
    "RELAY_ENABLED": enabled_through >= 5,
}
updates = {key: str(value).lower() for key, value in updates.items()}
lines = path.read_text(encoding="utf-8").splitlines()
output = []
seen = set()
for line in lines:
    key = line.split("=", 1)[0] if "=" in line and not line.lstrip().startswith("#") else None
    if key in updates:
        output.append(f"{key}={updates[key]}")
        seen.add(key)
    else:
        output.append(line)
for key, value in updates.items():
    if key not in seen:
        output.append(f"{key}={value}")
fd, temporary = tempfile.mkstemp(prefix="playground.env.", dir=str(path.parent))
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write("\n".join(output) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, 0o600)
    os.chown(temporary, 0, 0)
    os.replace(temporary, path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
PY

systemctl restart opensidebar-shared.service
attempt=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' opensidebar-cloud-api 2>/dev/null || true)" = healthy ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 45 ]; then
    docker logs --tail 100 opensidebar-cloud-api >&2 || true
    exit 1
  fi
  sleep 2
done

docker exec -e EXPECTED_STAGE="$STAGE" opensidebar-cloud-api node -e '
  const base = "http://127.0.0.1:8787";
  const ready = await fetch(`${base}/health/ready`);
  if (!ready.ok) process.exit(1);
  const login = await fetch(`${base}/api/v1/playground/auth/login?return=/account`, { redirect: "manual" });
  if (login.status !== 302 || !login.headers.get("location")?.startsWith(process.env.COGNITO_DOMAIN)) process.exit(1);
  const account = await fetch(`${base}/api/v1/account`);
  if (process.env.EXPECTED_STAGE === "disabled") {
    const body = await account.json();
    if (account.status !== 503 || body?.error?.code !== "cloud_control_disabled") process.exit(1);
  } else if (account.status !== 401) process.exit(1);
  const link = await fetch(`${base}/api/v1/extension/auth/link`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (process.env.EXPECTED_STAGE === "account" && link.status !== 503) process.exit(1);
  if (!["disabled", "account"].includes(process.env.EXPECTED_STAGE) && link.status === 503) process.exit(1);
'

committed=true
rm -f -- "$backup"
trap - EXIT INT TERM
echo "Cloud-control stage is now $STAGE."
