-- A device cursor can outlive deleted mission rows and a database restore.
-- Bootstrap the global sequence above any realistically persisted local cursor,
-- even when the rows that originally issued that cursor no longer exist.
SELECT setval(
  'sessions.remote_mission_delivery_sequence',
  GREATEST(
    COALESCE((SELECT MAX(sequence) FROM sessions.remote_missions), 0),
    floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
  ),
  true
);

INSERT INTO sessions.schema_migrations(version) VALUES (13) ON CONFLICT DO NOTHING;
