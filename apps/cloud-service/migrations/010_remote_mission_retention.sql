ALTER TABLE sessions.remote_missions
  ADD COLUMN IF NOT EXISTS delete_after timestamptz NOT NULL DEFAULT now() + interval '30 days';

CREATE INDEX IF NOT EXISTS remote_missions_retention
  ON sessions.remote_missions(delete_after);

INSERT INTO sessions.schema_migrations(version) VALUES (10) ON CONFLICT DO NOTHING;
