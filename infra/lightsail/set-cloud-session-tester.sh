#!/bin/sh
set -eu

test "$(id -u)" -eq 0 || {
  echo "run as root" >&2
  exit 2
}

EMAIL=${1:?pass the exact named-tester email}
ENV_FILE=${ENV_FILE:-/etc/opensidebar/playground.env}
DB_CONTAINER=${DB_CONTAINER:-playscenario-db-1}
case "$EMAIL" in
  *@*.*) ;;
  *) echo "invalid tester email" >&2; exit 2 ;;
esac

account_ids=$(printf "%s\n" \
  "select account_id from control.accounts where lower(email)=lower(:'tester_email');" | \
  docker exec -i "$DB_CONTAINER" psql -U postgres -d opensidebar -At \
    -v tester_email="$EMAIL")
test "$(printf '%s\n' "$account_ids" | sed '/^$/d' | wc -l)" -eq 1 || {
  echo "expected exactly one account for the named tester" >&2
  exit 2
}
account_id=$(printf '%s\n' "$account_ids" | sed '/^$/d')

python3 - "$ENV_FILE" "$account_id" <<'PY'
import os
import pathlib
import sys
import tempfile

path = pathlib.Path(sys.argv[1])
account_id = sys.argv[2]
lines = path.read_text(encoding="utf-8").splitlines()
current = {}
for line in lines:
    if "=" in line and not line.lstrip().startswith("#"):
        key, value = line.split("=", 1)
        current[key] = value
general = {value.strip() for value in current.get("CLOUD_TESTER_SUBJECTS", "").split(",") if value.strip()}
if account_id not in general:
    raise SystemExit("the requested session tester is not in CLOUD_TESTER_SUBJECTS")
updates = {"CLOUD_SESSION_TESTER_SUBJECTS": account_id}
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

echo "Configured one existing cloud account as the cloud-session named tester."
