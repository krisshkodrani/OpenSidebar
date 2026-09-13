ALTER TABLE sessions.remote_missions
  ALTER COLUMN device_id TYPE text USING device_id::text;

INSERT INTO sessions.schema_migrations(version) VALUES (11) ON CONFLICT DO NOTHING;
