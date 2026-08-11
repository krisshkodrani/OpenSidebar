#!/bin/sh
set -eu

test "$(id -u)" -eq 0 || {
  echo "run as root" >&2
  exit 2
}

BUCKET=${1:?pass the private trace bucket name}
ENV_FILE=${ENV_FILE:-/etc/opensidebar/playground.env}
case "$BUCKET" in
  *[!a-z0-9.-]*|'') echo "invalid bucket name" >&2; exit 2 ;;
esac
test -f "$ENV_FILE" || { echo "environment file is missing" >&2; exit 2; }

python3 - "$ENV_FILE" "$BUCKET" <<'PY'
import os
import pathlib
import tempfile
import sys

path = pathlib.Path(sys.argv[1])
bucket = sys.argv[2]
updates = {
    "TRACE_BUCKET_NAME": bucket,
    "TRACE_SYNC_ENABLED": "false",
    "TRACE_UPLOADS_ENABLED": "false",
    "TRACE_DOWNLOADS_ENABLED": "false",
    "TRACE_TESTER_SUBJECTS": "",
}
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

echo "Trace bucket configured with every trace capability disabled."
