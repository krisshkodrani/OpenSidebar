#!/bin/sh
set -eu

test "$(id -u)" -eq 0 || {
  echo "run as root" >&2
  exit 2
}

ISSUER=${1:?pass the Cognito issuer URL}
CLIENT_ID=${2:?pass the dedicated public MCP client ID}
SCOPE_PREFIX=${3:-https://opensidebar.com/mcp/}
ENV_FILE=${ENV_FILE:-/etc/opensidebar/playground.env}
case "$ISSUER" in https://cognito-idp.*.amazonaws.com/*) ;; *) echo "unexpected Cognito issuer" >&2; exit 2 ;; esac
case "$CLIENT_ID" in *[!a-z0-9]*) echo "unexpected Cognito client ID" >&2; exit 2 ;; esac
case "$SCOPE_PREFIX" in https://opensidebar.com/mcp/) ;; *) echo "unexpected MCP scope prefix" >&2; exit 2 ;; esac

python3 - "$ENV_FILE" "$ISSUER" "$CLIENT_ID" "$SCOPE_PREFIX" <<'PY'
import os
import pathlib
import sys
import tempfile

path = pathlib.Path(sys.argv[1])
updates = {
    "COGNITO_ISSUER": sys.argv[2],
    "COGNITO_MCP_CLIENT_ID": sys.argv[3],
    "MCP_SCOPE_PREFIX": sys.argv[4],
    "HOSTED_MCP_ENABLED": "false",
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

echo "Configured the dedicated hosted-MCP OAuth boundary with activation disabled."
