#!/bin/sh
set -eu

test "$(id -u)" -eq 0 || {
  echo "run as root" >&2
  exit 2
}

IMAGE=${1:?pass the candidate image tag}
ENV_FILE=${ENV_FILE:-/etc/opensidebar/playground.env}
case "$IMAGE" in
  *[!A-Za-z0-9._:/-]*) echo "invalid image tag" >&2; exit 2 ;;
esac
docker image inspect "$IMAGE" >/dev/null
test -f "$ENV_FILE" || { echo "environment file is missing" >&2; exit 2; }

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

python3 - "$ENV_FILE" "$IMAGE" <<'PY'
import os
import pathlib
import tempfile
import sys

path = pathlib.Path(sys.argv[1])
image = sys.argv[2]
lines = path.read_text(encoding="utf-8").splitlines()
output = []
replaced = False
for line in lines:
    if line.startswith("OPENSIDEBAR_API_IMAGE="):
        output.append(f"OPENSIDEBAR_API_IMAGE={image}")
        replaced = True
    else:
        output.append(line)
if not replaced:
    output.append(f"OPENSIDEBAR_API_IMAGE={image}")
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
docker exec opensidebar-cloud-api node -e '
  const ready = await fetch("http://127.0.0.1:8787/health/ready");
  if (!ready.ok) process.exit(1);
  if (process.env.CLOUD_CONTROL_ENABLED !== "true") {
    const disabled = await fetch("http://127.0.0.1:8787/api/v1/account");
    const body = await disabled.json();
    if (disabled.status !== 503 || body?.error?.code !== "cloud_control_disabled") process.exit(1);
  }
  const login = await fetch("http://127.0.0.1:8787/api/v1/playground/auth/login?return=/account", { redirect: "manual" });
  if (login.status !== 302 || !login.headers.get("location")?.startsWith(process.env.COGNITO_DOMAIN)) process.exit(1);
'

committed=true
rm -f -- "$backup"
trap - EXIT INT TERM
echo "Deployed $IMAGE with readiness verification."
