#!/bin/sh
set -eu

test "$(id -u)" -eq 0 || {
  echo "run as root" >&2
  exit 2
}

STAGE=${1:?pass disabled, index, download, or upload}
ENV_FILE=${ENV_FILE:-/etc/opensidebar/playground.env}
case "$STAGE" in
  disabled|index|download|upload) ;;
  *) echo "invalid trace-sync stage" >&2; exit 2 ;;
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
order = ["disabled", "index", "download", "upload"]
enabled_through = order.index(stage)
updates = {
    "TRACE_SYNC_ENABLED": enabled_through >= 1,
    "TRACE_DOWNLOADS_ENABLED": enabled_through >= 2,
    "TRACE_UPLOADS_ENABLED": enabled_through >= 3,
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

docker exec -e EXPECTED_TRACE_STAGE="$STAGE" opensidebar-cloud-api node -e '
  const expected = {
    disabled: ["false", "false", "false"],
    index: ["true", "false", "false"],
    download: ["true", "false", "true"],
    upload: ["true", "true", "true"],
  }[process.env.EXPECTED_TRACE_STAGE];
  const actual = [
    process.env.TRACE_SYNC_ENABLED,
    process.env.TRACE_UPLOADS_ENABLED,
    process.env.TRACE_DOWNLOADS_ENABLED,
  ];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) process.exit(1);
  const ready = await fetch("http://127.0.0.1:8787/health/ready");
  if (!ready.ok) process.exit(1);
'

committed=true
rm -f -- "$backup"
trap - EXIT INT TERM
echo "Trace-sync stage is now $STAGE."
