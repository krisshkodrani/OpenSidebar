-- Public operational state is separate from the internal modelbench schema.
CREATE TABLE IF NOT EXISTS playground.scenario_runs_v2 (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  scenario_id text NOT NULL,
  record jsonb NOT NULL,
  revision bigint NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS public_scenarios_owner_expiry
  ON playground.scenario_runs_v2(owner_id, expires_at);
CREATE TABLE IF NOT EXISTS playground.scenario_launches_v2 (
  token_hash text PRIMARY KEY,
  run_id text NOT NULL REFERENCES playground.scenario_runs_v2(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE TABLE IF NOT EXISTS playground.scenario_sessions_v2 (
  token_hash text PRIMARY KEY,
  run_id text NOT NULL REFERENCES playground.scenario_runs_v2(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
REVOKE ALL ON playground.scenario_runs_v2, playground.scenario_launches_v2,
  playground.scenario_sessions_v2 FROM PUBLIC;
