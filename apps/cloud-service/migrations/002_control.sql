CREATE SCHEMA IF NOT EXISTS control;
REVOKE ALL ON SCHEMA control FROM PUBLIC;

CREATE TABLE IF NOT EXISTS control.schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO control.schema_migrations(version) VALUES (2) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS control.accounts (
  account_id text PRIMARY KEY,
  email text NOT NULL,
  session_epoch bigint NOT NULL DEFAULT 0,
  cloud_access boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS control.devices (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES control.accounts(account_id) ON DELETE CASCADE,
  installation_id text NOT NULL,
  display_name text NOT NULL,
  extension_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE(account_id, installation_id)
);

CREATE TABLE IF NOT EXISTS control.device_sessions (
  id text PRIMARY KEY,
  device_id text NOT NULL REFERENCES control.devices(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES control.accounts(account_id) ON DELETE CASCADE,
  session_epoch bigint NOT NULL,
  access_hash text NOT NULL UNIQUE,
  access_expires_at timestamptz NOT NULL,
  refresh_hash text NOT NULL UNIQUE,
  refresh_family text NOT NULL,
  refresh_expires_at timestamptz NOT NULL,
  rotated_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS control_device_sessions_device ON control.device_sessions(device_id);
CREATE INDEX IF NOT EXISTS control_device_sessions_family ON control.device_sessions(refresh_family);

CREATE TABLE IF NOT EXISTS control.device_link_codes (
  code_hash text PRIMARY KEY,
  account_id text NOT NULL REFERENCES control.accounts(account_id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS control.preferences (
  account_id text PRIMARY KEY REFERENCES control.accounts(account_id) ON DELETE CASCADE,
  schema_version integer NOT NULL,
  revision bigint NOT NULL,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS control.encrypted_credentials (
  account_id text NOT NULL REFERENCES control.accounts(account_id) ON DELETE CASCADE,
  provider text NOT NULL CHECK(provider IN ('openrouter','fireworks')),
  ciphertext text NOT NULL,
  encrypted_data_key text NOT NULL,
  fingerprint text NOT NULL,
  verification text NOT NULL CHECK(verification IN ('valid','unavailable')),
  last_verified_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY(account_id, provider)
);

CREATE TABLE IF NOT EXISTS control.relay_usage (
  account_id text NOT NULL REFERENCES control.accounts(account_id) ON DELETE CASCADE,
  period_start date NOT NULL,
  requests bigint NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id, period_start)
);

CREATE TABLE IF NOT EXISTS control.relay_request_records (
  account_id text NOT NULL REFERENCES control.accounts(account_id) ON DELETE CASCADE,
  request_id text NOT NULL,
  provider text NOT NULL CHECK(provider IN ('openrouter','fireworks')),
  model_id text NOT NULL,
  status text NOT NULL CHECK(status IN ('active','completed','failed','cancelled')),
  status_class integer,
  input_tokens bigint,
  output_tokens bigint,
  latency_bucket text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id, request_id)
);

CREATE INDEX IF NOT EXISTS control_relay_request_expiry ON control.relay_request_records(expires_at);
