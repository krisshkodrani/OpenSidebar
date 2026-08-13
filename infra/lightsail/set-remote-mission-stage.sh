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
  *) echo "invalid remote-mission stage" >&2; exit 2 ;;
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
general = {value.strip() for value in current.get("CLOUD_TESTER_SUBJECTS", "").split(",") if value.strip()}
sessions = {value.strip() for value in current.get("CLOUD_SESSION_TESTER_SUBJECTS", "").split(",") if value.strip()}
if stage == "named-testers":
    if current.get("CLOUD_CONTROL_ENABLED") != "true" or current.get("EXTENSION_AUTH_ENABLED") != "true":
        raise SystemExit("remote missions require cloud control and extension auth")
    if current.get("CLOUD_SESSIONS_ENABLED") != "true":
        raise SystemExit("run set-cloud-session-stage.sh sessions before remote-mission activation")
    if not sessions or not sessions.issubset(general):
        raise SystemExit("remote missions require a valid named cloud-session tester subset")
updates = {"REMOTE_MISSIONS_ENABLED": "true" if stage == "named-testers" else "false"}
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
  grep -E '^REMOTE_MISSIONS_ENABLED=' "$ENV_FILE"
  cp -p "$backup" "$ENV_FILE"
  committed=true
  rm -f -- "$backup"
  trap - EXIT INT TERM
  echo "Remote-mission stage preview is $STAGE; no service was restarted."
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
docker exec -e EXPECTED_REMOTE_MISSIONS="$expected" opensidebar-cloud-api node -e '
  if ((process.env.REMOTE_MISSIONS_ENABLED === "true") !== (process.env.EXPECTED_REMOTE_MISSIONS === "true")) process.exit(1);
  const ready = await fetch("http://127.0.0.1:8787/health/ready");
  if (!ready.ok) process.exit(1);
'

committed=true
rm -f -- "$backup"
trap - EXIT INT TERM
echo "Remote-mission stage is now $STAGE; access remains restricted to cloud-session named testers."
