#!/bin/sh
set -eu

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=playground_password="$PLAYGROUND_DB_PASSWORD" <<'SQL'
CREATE ROLE playground_service LOGIN PASSWORD :'playground_password';
CREATE SCHEMA playground AUTHORIZATION playground_service;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
