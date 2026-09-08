#!/bin/sh
set -eu

test "$(id -u)" -eq 0 || {
  echo "run as root" >&2
  exit 2
}

STAGE=${1:?pass disabled or named-testers}
ENV_FILE=${ENV_FILE:-/etc/opensidebar/playground.env}
case "$STAGE" in
  disabled|named-testers) ;;
  *) echo "invalid hosted-MCP stage" >&2; exit 2 ;;
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
import sys
import tempfile

path = pathlib.Path(sys.argv[1])
stage = sys.argv[2]
lines = path.read_text(encoding="utf-8").splitlines()
current = {}
for line in lines:
    if "=" in line and not line.lstrip().startswith("#"):
        key, value = line.split("=", 1)
        current[key] = value
if stage == "named-testers":
    required_true = (
        "CLOUD_CONTROL_ENABLED",
        "CLOUD_SESSIONS_ENABLED",
        "REMOTE_MISSIONS_ENABLED",
    )
    for key in required_true:
        if current.get(key) != "true":
            raise SystemExit(f"hosted MCP requires {key}=true")
    required_values = (
        "COGNITO_DOMAIN",
        "COGNITO_ISSUER",
        "COGNITO_MCP_CLIENT_ID",
        "MCP_SCOPE_PREFIX",
    )
    for key in required_values:
        if not current.get(key):
            raise SystemExit(f"hosted MCP requires {key}")
    if current.get("COGNITO_MCP_CLIENT_ID") == current.get("COGNITO_EXTENSION_CLIENT_ID"):
        raise SystemExit("hosted MCP requires a separate Cognito client")
    general = {value.strip() for value in current.get("CLOUD_TESTER_SUBJECTS", "").split(",") if value.strip()}
    sessions = {value.strip() for value in current.get("CLOUD_SESSION_TESTER_SUBJECTS", "").split(",") if value.strip()}
    if not sessions or not sessions.issubset(general):
        raise SystemExit("hosted MCP requires a valid named cloud-session tester subset")
updates = {"HOSTED_MCP_ENABLED": "true" if stage == "named-testers" else "false"}
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

if [ "${DRY_RUN:-false}" = true ]; then
  grep -E '^HOSTED_MCP_ENABLED=' "$ENV_FILE"
  cp -p "$backup" "$ENV_FILE"
  committed=true
  rm -f -- "$backup"
  trap - EXIT INT TERM
  echo "Hosted-MCP stage preview is $STAGE; no service was restarted."
  exit 0
fi

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

expected=false
test "$STAGE" = named-testers && expected=true
docker exec -e EXPECTED_HOSTED_MCP="$expected" opensidebar-cloud-api node -e '
  if ((process.env.HOSTED_MCP_ENABLED === "true") !== (process.env.EXPECTED_HOSTED_MCP === "true")) process.exit(1);
  const ready = await fetch("http://127.0.0.1:8787/health/ready");
  if (!ready.ok) process.exit(1);
  const metadata = await fetch("http://127.0.0.1:8787/.well-known/oauth-protected-resource/mcp");
  if (process.env.EXPECTED_HOSTED_MCP === "true" ? !metadata.ok : metadata.status !== 404) process.exit(1);
'

committed=true
rm -f -- "$backup"
trap - EXIT INT TERM
echo "Hosted-MCP stage is now $STAGE; access remains restricted to named testers and scoped OAuth."
