#!/bin/sh
set -eu

test "$(id -u)" -eq 0 || {
  echo "run as root" >&2
  exit 2
}

ENV_FILE=${ENV_FILE:-/etc/opensidebar/playground.env}
ACCESS_KEY_FILE=${1:?pass the one-time KMS access-key JSON path}
: "${OPENSIDEBAR_EXTENSION_ID:?set OPENSIDEBAR_EXTENSION_ID}"
: "${COGNITO_EXTENSION_CLIENT_ID:?set COGNITO_EXTENSION_CLIENT_ID}"
: "${CLOUD_TESTER_SUBJECTS:?set CLOUD_TESTER_SUBJECTS}"
: "${RELAY_MODEL_ALLOWLIST:?set RELAY_MODEL_ALLOWLIST}"
test -f "$ENV_FILE" || { echo "environment file is missing" >&2; exit 2; }
test -f "$ACCESS_KEY_FILE" || { echo "access-key file is missing" >&2; exit 2; }

CONTROL_DB_PASSWORD=$(openssl rand -hex 32)
export CONTROL_DB_PASSWORD OPENSIDEBAR_EXTENSION_ID COGNITO_EXTENSION_CLIENT_ID
export CLOUD_TESTER_SUBJECTS RELAY_MODEL_ALLOWLIST

python3 - "$ENV_FILE" "$ACCESS_KEY_FILE" <<'PY'
import json
import os
import pathlib
import tempfile
import sys

env_path = pathlib.Path(sys.argv[1])
access_path = pathlib.Path(sys.argv[2])
access = json.loads(access_path.read_text(encoding="utf-8"))
if set(access) != {"AccessKeyId", "SecretAccessKey"}:
    raise SystemExit("unexpected access-key response shape")

updates = {
    "CONTROL_DB_PASSWORD": os.environ["CONTROL_DB_PASSWORD"],
    "OPENSIDEBAR_EXTENSION_ID": os.environ["OPENSIDEBAR_EXTENSION_ID"],
    "COGNITO_EXTENSION_CLIENT_ID": os.environ["COGNITO_EXTENSION_CLIENT_ID"],
    "CREDENTIAL_KMS_KEY_ID": "alias/opensidebar-credentials",
    "CLOUD_TESTER_SUBJECTS": os.environ["CLOUD_TESTER_SUBJECTS"],
    "RELAY_MODEL_ALLOWLIST": os.environ["RELAY_MODEL_ALLOWLIST"],
    "OPENSIDEBAR_KMS_ACCESS_KEY_ID": access["AccessKeyId"],
    "OPENSIDEBAR_KMS_SECRET_ACCESS_KEY": access["SecretAccessKey"],
    "CLOUD_CONTROL_ENABLED": "false",
    "EXTENSION_AUTH_ENABLED": "false",
    "CREDENTIAL_WRITES_ENABLED": "false",
    "RELAY_ENABLED": "false",
    "PREFERENCE_WRITES_ENABLED": "false",
}

lines = env_path.read_text(encoding="utf-8").splitlines()
seen = set()
output = []
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

fd, temporary = tempfile.mkstemp(prefix="playground.env.", dir=str(env_path.parent))
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write("\n".join(output) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary, 0o600)
    os.chown(temporary, 0, 0)
    os.replace(temporary, env_path)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
PY

chmod 0600 "$ENV_FILE"
chown root:root "$ENV_FILE"
rm -f -- "$ACCESS_KEY_FILE"
echo "LP-28 environment configured with all cloud-control flags disabled."
