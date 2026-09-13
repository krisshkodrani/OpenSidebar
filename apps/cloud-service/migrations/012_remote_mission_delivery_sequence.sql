CREATE SEQUENCE IF NOT EXISTS sessions.remote_mission_delivery_sequence AS bigint;

SELECT setval(
  'sessions.remote_mission_delivery_sequence',
  GREATEST(
    COALESCE((SELECT MAX(sequence) FROM sessions.remote_missions), 0),
    1
  ),
  true
);

INSERT INTO sessions.schema_migrations(version) VALUES (12) ON CONFLICT DO NOTHING;
