ALTER TABLE sessions.remote_missions
  DROP CONSTRAINT IF EXISTS remote_missions_state_check;
ALTER TABLE sessions.remote_missions
  ADD CONSTRAINT remote_missions_state_check CHECK(state IN (
    'queued','accepted','running','target_selection_required','approval_required',
    'succeeded','failed','cancelled','outcome_unknown'
  ));

INSERT INTO sessions.schema_migrations(version) VALUES (16) ON CONFLICT DO NOTHING;
