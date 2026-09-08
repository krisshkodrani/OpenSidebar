CREATE SCHEMA IF NOT EXISTS traces;
REVOKE ALL ON SCHEMA traces FROM PUBLIC;

CREATE TABLE IF NOT EXISTS traces.schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS traces.cloud_traces (
  account_id text NOT NULL REFERENCES control.accounts(account_id) ON DELETE CASCADE,
  trace_id uuid NOT NULL,
  title text NOT NULL CHECK(octet_length(title) BETWEEN 1 AND 240),
  bundle_schema_version text NOT NULL CHECK(length(bundle_schema_version) BETWEEN 1 AND 80),
  key_fingerprint text NOT NULL CHECK(key_fingerprint ~ '^[A-Za-z0-9_-]{16,64}$'),
  entry_count integer NOT NULL CHECK(entry_count >= 0),
  screenshot_count integer NOT NULL CHECK(screenshot_count >= 0),
  ciphertext_size_bytes bigint NOT NULL CHECK(ciphertext_size_bytes BETWEEN 1 AND 67108864),
  ciphertext_sha256 text CHECK(ciphertext_sha256 IS NULL OR ciphertext_sha256 ~ '^[a-f0-9]{64}$'),
  object_key text NOT NULL,
  state text NOT NULL CHECK(state IN ('upload_pending','available','deleting','failed')),
  trace_created_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  uploaded_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  PRIMARY KEY(account_id, trace_id)
);
CREATE INDEX IF NOT EXISTS cloud_traces_account_created
  ON traces.cloud_traces(account_id, trace_created_at DESC, trace_id);
CREATE INDEX IF NOT EXISTS cloud_traces_expiry
  ON traces.cloud_traces(expires_at) WHERE state <> 'deleting';

INSERT INTO traces.schema_migrations(version) VALUES (8) ON CONFLICT DO NOTHING;
REVOKE ALL ON traces.cloud_traces FROM PUBLIC;
