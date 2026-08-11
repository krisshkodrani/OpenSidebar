CREATE TABLE IF NOT EXISTS sessions.session_jobs (
  job_id uuid PRIMARY KEY,
  account_id text NOT NULL,
  session_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('export','delete')),
  state text NOT NULL CHECK(state IN ('pending','running','completed','failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  run_after timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  artifact_key text,
  artifact_sha256 text CHECK(artifact_sha256 IS NULL OR artifact_sha256 ~ '^[a-f0-9]{64}$'),
  artifact_expires_at timestamptz,
  error_code text CHECK(error_code IS NULL OR error_code ~ '^[a-z0-9_]{1,80}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, session_id, kind, job_id)
);
CREATE INDEX IF NOT EXISTS session_jobs_claim
  ON sessions.session_jobs(run_after, created_at)
  WHERE state IN ('pending','running');
CREATE INDEX IF NOT EXISTS session_jobs_artifact_expiry
  ON sessions.session_jobs(artifact_expires_at)
  WHERE artifact_key IS NOT NULL;

INSERT INTO sessions.schema_migrations(version) VALUES (7) ON CONFLICT DO NOTHING;
REVOKE ALL ON sessions.session_jobs FROM PUBLIC;
