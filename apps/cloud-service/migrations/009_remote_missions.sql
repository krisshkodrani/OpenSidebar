CREATE TABLE IF NOT EXISTS sessions.remote_missions (
  account_id text NOT NULL,
  mission_id uuid NOT NULL,
  device_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK(sequence > 0),
  state text NOT NULL CHECK(state IN (
    'queued','accepted','running','approval_required',
    'succeeded','failed','cancelled','outcome_unknown'
  )),
  result_code text CHECK(result_code IS NULL OR result_code IN (
    'completed','not_achieved','cancelled','unknown'
  )),
  idempotency_hash text NOT NULL,
  payload_object_key text NOT NULL,
  payload_ciphertext_size_bytes bigint NOT NULL CHECK(payload_ciphertext_size_bytes > 0),
  payload_ciphertext_sha256 text NOT NULL CHECK(payload_ciphertext_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(account_id, mission_id),
  UNIQUE(account_id, idempotency_hash),
  UNIQUE(account_id, device_id, sequence)
);
CREATE INDEX IF NOT EXISTS remote_missions_delivery
  ON sessions.remote_missions(account_id, device_id, sequence)
  WHERE state IN ('queued','accepted','running','approval_required');
CREATE INDEX IF NOT EXISTS remote_missions_expiry
  ON sessions.remote_missions(expires_at)
  WHERE state IN ('queued','accepted','approval_required');

INSERT INTO sessions.schema_migrations(version) VALUES (9) ON CONFLICT DO NOTHING;
REVOKE ALL ON sessions.remote_missions FROM PUBLIC;
