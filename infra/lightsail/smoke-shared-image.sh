#!/bin/sh
set -eu

test "$(id -u)" -eq 0 || {
  echo "run as root" >&2
  exit 2
}

IMAGE=${1:?pass the candidate image tag}
ENV_FILE=${ENV_FILE:-/etc/opensidebar/playground.env}
NAME=opensidebar-cloud-api-candidate
set -a
. "$ENV_FILE"
set +a

docker rm -f "$NAME" >/dev/null 2>&1 || true
cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run -d --name "$NAME" \
  --network playscenario_default \
  --memory 256m --cpus 0.5 --read-only --tmpfs /tmp:size=32m \
  --security-opt no-new-privileges:true \
  -e PORT=8787 \
  -e NODE_OPTIONS=--max-old-space-size=192 \
  -e DATABASE_URL="postgresql://playground_service:${PLAYGROUND_DB_PASSWORD}@db:5432/opensidebar" \
  -e CONTROL_DATABASE_URL="postgresql://opensidebar_service:${CONTROL_DB_PASSWORD}@db:5432/opensidebar" \
  -e CONTROL_ORIGIN="$CONTROL_ORIGIN" \
  -e TARGET_ORIGIN="$TARGET_ORIGIN" \
  -e COOKIE_SECURE=true \
  -e COGNITO_DOMAIN="$COGNITO_DOMAIN" \
  -e COGNITO_CLIENT_ID="$COGNITO_CLIENT_ID" \
  -e AWS_REGION="$AWS_REGION" \
  -e AWS_ACCESS_KEY_ID="$OPENSIDEBAR_KMS_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$OPENSIDEBAR_KMS_SECRET_ACCESS_KEY" \
  -e AUTH_QUOTA_HMAC_KEY="$AUTH_QUOTA_HMAC_KEY" \
  -e CLOUD_CONTROL_ENABLED=false \
  -e EXTENSION_AUTH_ENABLED=false \
  -e CREDENTIAL_WRITES_ENABLED=false \
  -e RELAY_ENABLED=false \
  -e PREFERENCE_WRITES_ENABLED=false \
  -e COGNITO_EXTENSION_CLIENT_ID="$COGNITO_EXTENSION_CLIENT_ID" \
  -e OPENSIDEBAR_EXTENSION_ID="$OPENSIDEBAR_EXTENSION_ID" \
  -e CREDENTIAL_KMS_KEY_ID="$CREDENTIAL_KMS_KEY_ID" \
  -e CLOUD_TESTER_SUBJECTS="$CLOUD_TESTER_SUBJECTS" \
  -e RELAY_MODEL_ALLOWLIST="$RELAY_MODEL_ALLOWLIST" \
  "$IMAGE" >/dev/null

attempt=0
until docker exec "$NAME" node -e '
  const ready = await fetch("http://127.0.0.1:8787/health/ready");
  if (!ready.ok) process.exit(1);
  const disabled = await fetch("http://127.0.0.1:8787/api/v1/account");
  const body = await disabled.json();
  if (disabled.status !== 503 || body?.error?.code !== "cloud_control_disabled") process.exit(1);
  const login = await fetch("http://127.0.0.1:8787/api/v1/playground/auth/login?return=/account", { redirect: "manual" });
  if (login.status !== 302 || !login.headers.get("location")?.startsWith(process.env.COGNITO_DOMAIN)) process.exit(1);
' 2>/dev/null; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    docker logs --tail 100 "$NAME" >&2
    exit 1
  fi
  sleep 2
done

echo "Candidate readiness and disabled control boundary passed."
