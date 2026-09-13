CREATE SCHEMA IF NOT EXISTS playground;
REVOKE ALL ON SCHEMA playground FROM PUBLIC;

CREATE TABLE IF NOT EXISTS playground.web_sessions (
  session_hash text PRIMARY KEY,
  account_id text NOT NULL,
  email text NOT NULL,
  csrf_hash text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS playground.auth_flows (
  state_hash text PRIMARY KEY,
  code_verifier text NOT NULL,
  return_path text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE TABLE IF NOT EXISTS playground.email_challenges (
  challenge_hash text PRIMARY KEY,
  email_hash text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('signup', 'signin')),
  provider_session text,
  account_id text,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
ALTER TABLE playground.email_challenges ADD COLUMN IF NOT EXISTS account_id text;

CREATE TABLE IF NOT EXISTS playground.auth_rate_limits (
  subject_hash text NOT NULL,
  window_seconds integer NOT NULL,
  bucket bigint NOT NULL,
  used integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (subject_hash, window_seconds, bucket)
);

CREATE TABLE IF NOT EXISTS playground.runs (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  scenario_id text NOT NULL,
  scenario_version integer NOT NULL,
  lifecycle text NOT NULL,
  revision bigint NOT NULL,
  state jsonb NOT NULL,
  result text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS playground_runs_owner_updated
  ON playground.runs (account_id, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS playground.daily_quotas (
  subject_hash text NOT NULL,
  quota_day date NOT NULL,
  used integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (subject_hash, quota_day)
);

CREATE TABLE IF NOT EXISTS playground.launch_capabilities (
  token_hash text PRIMARY KEY,
  run_id text NOT NULL REFERENCES playground.runs(id) ON DELETE CASCADE,
  account_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE TABLE IF NOT EXISTS playground.target_sessions (
  session_hash text PRIMARY KEY,
  run_id text NOT NULL REFERENCES playground.runs(id) ON DELETE CASCADE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS playground.idempotency_keys (
  account_id text NOT NULL,
  operation text NOT NULL,
  key_hash text NOT NULL,
  response_status integer NOT NULL,
  response_body jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, operation, key_hash)
);
