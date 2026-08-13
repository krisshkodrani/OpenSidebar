#!/bin/sh
set -eu

test "$(id -u)" -eq 0 || {
  echo "run as root" >&2
  exit 2
}

SESSION_KEY=${1:?pass the session KMS alias}
SESSION_BUCKET=${2:?pass the private session bucket name}
ENV_FILE=${ENV_FILE:-/etc/opensidebar/playground.env}
case "$SESSION_KEY" in alias/opensidebar-*) ;; *) echo "unexpected session KMS alias" >&2; exit 2 ;; esac
case "$SESSION_BUCKET" in opensidebar-sessions-*) ;; *) echo "unexpected session bucket" >&2; exit 2 ;; esac

python3 - "$ENV_FILE" "$SESSION_KEY" "$SESSION_BUCKET" <<'PY'
import os
import pathlib
import sys
import tempfile

path = pathlib.Path(sys.argv[1])
updates = {
    "SESSION_KMS_KEY_ID": sys.argv[2],
    "SESSION_BUCKET_NAME": sys.argv[3],
    "CLOUD_SESSIONS_ENABLED": "false",
    "REMOTE_MISSIONS_ENABLED": "false",
    "CHECKPOINT_WRITES_ENABLED": "false",
    "CHECKPOINT_RESTORE_ENABLED": "false",
    "SESSION_EXPORTS_ENABLED": "false",
    "DEVICE_COMMANDS_ENABLED": "false",
    "DEVICE_TAKEOVER_ENABLED": "false",
    "TEMPORAL_SHADOW_ENABLED": "false",
    "TEMPORAL_COORDINATION_ENABLED": "false",
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

echo "Configured isolated session storage with every session capability disabled."
