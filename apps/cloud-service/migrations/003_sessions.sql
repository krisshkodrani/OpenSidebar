CREATE SCHEMA IF NOT EXISTS sessions;
REVOKE ALL ON SCHEMA sessions FROM PUBLIC;

CREATE TABLE IF NOT EXISTS sessions.schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO sessions.schema_migrations(version) VALUES (3) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS sessions.cloud_sessions (
  account_id text NOT NULL REFERENCES control.accounts(account_id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  title text NOT NULL CHECK(octet_length(title) BETWEEN 1 AND 160),
  mode text NOT NULL CHECK(mode IN ('cloud_checkpointed','cloud_archived')),
  status text NOT NULL CHECK(status IN ('created','active','waiting_for_user','paused','completed','failed','cancelled','deleting')),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision > 0),
  latest_checkpoint_id uuid,
  latest_checkpoint_revision bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  pinned boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  runtime_version text NOT NULL CHECK(length(runtime_version) BETWEEN 1 AND 80),
  checkpoint_schema_version integer,
  size_bytes bigint NOT NULL DEFAULT 0 CHECK(size_bytes >= 0),
  PRIMARY KEY(account_id, session_id),
  CHECK((latest_checkpoint_id IS NULL) = (latest_checkpoint_revision IS NULL))
);
CREATE INDEX IF NOT EXISTS cloud_sessions_account_updated
  ON sessions.cloud_sessions(account_id, updated_at DESC, session_id);
CREATE INDEX IF NOT EXISTS cloud_sessions_expiry
  ON sessions.cloud_sessions(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS sessions.cloud_checkpoints (
  account_id text NOT NULL,
  session_id uuid NOT NULL,
  checkpoint_id uuid NOT NULL,
  parent_checkpoint_id uuid,
  revision bigint NOT NULL CHECK(revision > 0),
  session_revision bigint NOT NULL CHECK(session_revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  runtime_version text NOT NULL CHECK(length(runtime_version) BETWEEN 1 AND 80),
  checkpoint_schema_version integer NOT NULL CHECK(checkpoint_schema_version > 0),
  object_key text NOT NULL,
  object_version text,
  state text NOT NULL CHECK(state IN ('upload_pending','committed','superseded','deleting','corrupt')),
  ciphertext_size_bytes bigint NOT NULL CHECK(ciphertext_size_bytes BETWEEN 1 AND 10485760),
  plaintext_size_bucket text NOT NULL CHECK(plaintext_size_bucket IN ('under_256k','under_1m','under_4m','under_8m','under_10m')),
  ciphertext_sha256 text NOT NULL CHECK(ciphertext_sha256 ~ '^[a-f0-9]{64}$'),
  committed_at timestamptz,
  PRIMARY KEY(account_id, checkpoint_id),
  UNIQUE(account_id, session_id, revision),
  FOREIGN KEY(account_id, session_id)
    REFERENCES sessions.cloud_sessions(account_id, session_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS cloud_checkpoints_session_created
  ON sessions.cloud_checkpoints(account_id, session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cloud_checkpoints_pending
  ON sessions.cloud_checkpoints(created_at) WHERE state='upload_pending';

CREATE UNIQUE INDEX IF NOT EXISTS control_devices_account_id
  ON control.devices(account_id, id);

CREATE TABLE IF NOT EXISTS sessions.device_connections (
  account_id text NOT NULL,
  device_id text NOT NULL,
  connection_id uuid NOT NULL,
  transport text NOT NULL CHECK(transport IN ('sse','long_poll')),
  last_acknowledged_sequence bigint NOT NULL DEFAULT 0 CHECK(last_acknowledged_sequence >= 0),
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY(account_id, connection_id),
  FOREIGN KEY(account_id, device_id)
    REFERENCES control.devices(account_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions.session_leases (
  account_id text NOT NULL,
  session_id uuid NOT NULL,
  lease_id uuid NOT NULL,
  device_id text NOT NULL,
  connection_id uuid,
  generation bigint NOT NULL CHECK(generation > 0),
  checkpoint_revision bigint NOT NULL DEFAULT 0 CHECK(checkpoint_revision >= 0),
  state text NOT NULL CHECK(state IN ('active','grace','revoked','expired')),
  acquired_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  grace_expires_at timestamptz NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK(revision > 0),
  PRIMARY KEY(account_id, lease_id),
  UNIQUE(account_id, session_id, lease_id),
  FOREIGN KEY(account_id, session_id)
    REFERENCES sessions.cloud_sessions(account_id, session_id) ON DELETE CASCADE,
  FOREIGN KEY(account_id, device_id)
    REFERENCES control.devices(account_id, id) ON DELETE CASCADE,
  FOREIGN KEY(account_id, connection_id)
    REFERENCES sessions.device_connections(account_id, connection_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS session_leases_one_live
  ON sessions.session_leases(account_id, session_id)
  WHERE state IN ('active','grace');
CREATE INDEX IF NOT EXISTS session_leases_session_generation
  ON sessions.session_leases(account_id, session_id, generation DESC);

CREATE TABLE IF NOT EXISTS sessions.device_commands (
  account_id text NOT NULL,
  session_id uuid NOT NULL,
  command_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK(sequence > 0),
  lease_id uuid NOT NULL,
  lease_generation bigint NOT NULL CHECK(lease_generation > 0),
  checkpoint_revision bigint NOT NULL CHECK(checkpoint_revision >= 0),
  command_kind text NOT NULL CHECK(length(command_kind) BETWEEN 1 AND 80),
  risk text NOT NULL CHECK(risk IN ('read','reversible_write','sensitive_write')),
  action_digest text NOT NULL CHECK(action_digest ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK(state IN ('pending','leased','delivered','accepted','started','succeeded','failed','outcome_unknown','expired','cancelled')),
  outcome_code text CHECK(outcome_code IS NULL OR outcome_code IN ('verified','not_achieved','unknown_after_interruption')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id, command_id),
  UNIQUE(account_id, session_id, sequence),
  FOREIGN KEY(account_id, session_id)
    REFERENCES sessions.cloud_sessions(account_id, session_id) ON DELETE CASCADE,
  FOREIGN KEY(account_id, session_id, lease_id)
    REFERENCES sessions.session_leases(account_id, session_id, lease_id),
  CHECK((state IN ('succeeded','failed','outcome_unknown')) = (outcome_code IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS sessions.command_attempts (
  account_id text NOT NULL,
  session_id uuid NOT NULL,
  command_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  lease_generation bigint NOT NULL CHECK(lease_generation > 0),
  checkpoint_revision bigint NOT NULL CHECK(checkpoint_revision >= 0),
  prior_state text NOT NULL,
  state text NOT NULL CHECK(state IN ('accepted','started','succeeded','failed','outcome_unknown')),
  outcome_code text,
  checkpoint_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id, attempt_id),
  UNIQUE(account_id, command_id, attempt_id),
  FOREIGN KEY(account_id, command_id)
    REFERENCES sessions.device_commands(account_id, command_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions.idempotency_records (
  account_id text NOT NULL,
  operation text NOT NULL CHECK(length(operation) BETWEEN 1 AND 160),
  key_hash text NOT NULL CHECK(key_hash ~ '^[A-Za-z0-9_-]{43}$'),
  resource_id text NOT NULL,
  response_revision bigint,
  response_digest text NOT NULL CHECK(length(response_digest)=64),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id, operation, key_hash)
);
CREATE INDEX IF NOT EXISTS session_idempotency_expiry
  ON sessions.idempotency_records(expires_at);

REVOKE ALL ON ALL TABLES IN SCHEMA sessions FROM PUBLIC;
