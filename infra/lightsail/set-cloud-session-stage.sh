#!/bin/sh
set -eu

test "$(id -u)" -eq 0 || {
  echo "run as root" >&2
  exit 2
}

STAGE=${1:?pass disabled, sessions, checkpoint-writes, checkpoint-restore, commands, or takeover}
ENV_FILE=${ENV_FILE:-/etc/opensidebar/playground.env}
case "$STAGE" in
  disabled|sessions|checkpoint-writes|checkpoint-restore|commands|takeover) ;;
  *) echo "invalid cloud-session stage" >&2; exit 2 ;;
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
order = ["disabled", "sessions", "checkpoint-writes", "checkpoint-restore", "commands", "takeover"]
enabled_through = order.index(stage)
current = {}
lines = path.read_text(encoding="utf-8").splitlines()
for line in lines:
    if "=" in line and not line.lstrip().startswith("#"):
        key, value = line.split("=", 1)
        current[key] = value
general_testers = {value.strip() for value in current.get("CLOUD_TESTER_SUBJECTS", "").split(",") if value.strip()}
session_testers = {value.strip() for value in current.get("CLOUD_SESSION_TESTER_SUBJECTS", "").split(",") if value.strip()}
if enabled_through > 0 and (
    current.get("CLOUD_CONTROL_ENABLED") != "true"
    or current.get("EXTENSION_AUTH_ENABLED") != "true"
):
    raise SystemExit("session activation requires cloud control and extension auth")
if enabled_through > 0 and not session_testers:
    raise SystemExit("session activation requires at least one named CLOUD_SESSION_TESTER_SUBJECTS entry")
if not session_testers.issubset(general_testers):
    raise SystemExit("CLOUD_SESSION_TESTER_SUBJECTS must be a subset of CLOUD_TESTER_SUBJECTS")
updates = {
    "CLOUD_SESSIONS_ENABLED": enabled_through >= 1,
    "CHECKPOINT_WRITES_ENABLED": enabled_through >= 2,
    "CHECKPOINT_RESTORE_ENABLED": enabled_through >= 3,
    "SESSION_EXPORTS_ENABLED": False,
    "DEVICE_COMMANDS_ENABLED": enabled_through >= 4,
    "DEVICE_TAKEOVER_ENABLED": enabled_through >= 5,
    # LP-32 rejected Temporal on this shared host. The stage tool must never
    # enable it implicitly.
    "TEMPORAL_SHADOW_ENABLED": False,
    "TEMPORAL_COORDINATION_ENABLED": False,
}
updates = {key: str(value).lower() for key, value in updates.items()}
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
  grep -E '^(CLOUD_SESSIONS|CHECKPOINT_WRITES|CHECKPOINT_RESTORE|SESSION_EXPORTS|DEVICE_COMMANDS|DEVICE_TAKEOVER|TEMPORAL_SHADOW|TEMPORAL_COORDINATION)_ENABLED=' "$ENV_FILE"
  cp -p "$backup" "$ENV_FILE"
  committed=true
  rm -f -- "$backup"
  trap - EXIT INT TERM
  echo "Cloud-session stage preview is $STAGE; no service was restarted."
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

docker exec -e EXPECTED_SESSION_STAGE="$STAGE" opensidebar-cloud-api node -e '
  const order = ["disabled", "sessions", "checkpoint-writes", "checkpoint-restore", "commands", "takeover"];
  const enabledThrough = order.indexOf(process.env.EXPECTED_SESSION_STAGE);
  const expected = {
    CLOUD_SESSIONS_ENABLED: enabledThrough >= 1,
    CHECKPOINT_WRITES_ENABLED: enabledThrough >= 2,
    CHECKPOINT_RESTORE_ENABLED: enabledThrough >= 3,
    SESSION_EXPORTS_ENABLED: false,
    DEVICE_COMMANDS_ENABLED: enabledThrough >= 4,
    DEVICE_TAKEOVER_ENABLED: enabledThrough >= 5,
    TEMPORAL_SHADOW_ENABLED: false,
    TEMPORAL_COORDINATION_ENABLED: false,
  };
  for (const [key, value] of Object.entries(expected)) {
    if ((process.env[key] === "true") !== value) process.exit(1);
  }
  const ready = await fetch("http://127.0.0.1:8787/health/ready");
  if (!ready.ok) process.exit(1);
'

committed=true
rm -f -- "$backup"
trap - EXIT INT TERM
echo "Cloud-session stage is now $STAGE; Temporal remains disabled."
