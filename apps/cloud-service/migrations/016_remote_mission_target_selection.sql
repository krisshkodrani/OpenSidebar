DO $$
BEGIN
  -- Startup replays these files. Later migrations allow additional states;
  -- never narrow their constraint when this migration has already run.
  IF NOT EXISTS (SELECT 1 FROM sessions.schema_migrations WHERE version >= 16) THEN
    ALTER TABLE sessions.remote_missions DROP CONSTRAINT IF EXISTS remote_missions_state_check;
    ALTER TABLE sessions.remote_missions ADD CONSTRAINT remote_missions_state_check CHECK(state IN (
      'queued','accepted','running','target_selection_required','approval_required',
      'succeeded','failed','cancelled','outcome_unknown'
    ));
    INSERT INTO sessions.schema_migrations(version) VALUES (16) ON CONFLICT DO NOTHING;
  END IF;
END $$;
