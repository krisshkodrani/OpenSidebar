#!/bin/sh
set -eu

: "${PLAYGROUND_POSTGRES_CONTAINER:?set PLAYGROUND_POSTGRES_CONTAINER}"
: "${PLAYGROUND_DB_PASSWORD:?set PLAYGROUND_DB_PASSWORD}"
: "${CONTROL_DB_PASSWORD:?set CONTROL_DB_PASSWORD}"

docker exec -i -u postgres -e PLAYGROUND_DB_PASSWORD="$PLAYGROUND_DB_PASSWORD" -e CONTROL_DB_PASSWORD="$CONTROL_DB_PASSWORD" \
  "$PLAYGROUND_POSTGRES_CONTAINER" psql --dbname postgres --set=ON_ERROR_STOP=1 <<'SQL'
\getenv playground_password PLAYGROUND_DB_PASSWORD
\getenv control_password CONTROL_DB_PASSWORD
SELECT format('CREATE ROLE playground_service LOGIN PASSWORD %L', :'playground_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='playground_service')
\gexec
ALTER ROLE playground_service PASSWORD :'playground_password';
SELECT format('CREATE ROLE opensidebar_service LOGIN PASSWORD %L', :'control_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='opensidebar_service')
\gexec
ALTER ROLE opensidebar_service PASSWORD :'control_password';
SELECT 'CREATE DATABASE opensidebar OWNER playground_service'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='opensidebar')
\gexec
ALTER DATABASE opensidebar OWNER TO postgres;
REVOKE CREATE ON DATABASE opensidebar FROM PUBLIC;
REVOKE CONNECT ON DATABASE opensidebar FROM PUBLIC;
GRANT CONNECT, CREATE ON DATABASE opensidebar TO playground_service;
GRANT CONNECT, CREATE ON DATABASE opensidebar TO opensidebar_service;
SQL

docker exec -i -u postgres "$PLAYGROUND_POSTGRES_CONTAINER" \
  psql --dbname opensidebar --set=ON_ERROR_STOP=1 <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO playground_service;
SQL
