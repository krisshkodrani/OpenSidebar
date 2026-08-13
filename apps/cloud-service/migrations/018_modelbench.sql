CREATE SCHEMA IF NOT EXISTS modelbench;
REVOKE ALL ON SCHEMA modelbench FROM PUBLIC;

CREATE TABLE IF NOT EXISTS modelbench.scenario_runs (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  case_id text NOT NULL,
  scenario_id text NOT NULL,
  scenario_version integer NOT NULL,
  lifecycle text NOT NULL CHECK (lifecycle IN ('ready', 'active', 'finished', 'expired')),
  revision bigint NOT NULL,
  state jsonb NOT NULL,
  result text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS modelbench_scenario_runs_owner_updated
  ON modelbench.scenario_runs(owner_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS modelbench_scenario_runs_expiry
  ON modelbench.scenario_runs(expires_at);

CREATE TABLE IF NOT EXISTS modelbench.attempts (
  attempt_id text PRIMARY KEY,
  case_id text NOT NULL,
  case_version integer NOT NULL,
  case_content_hash text NOT NULL,
  build_revision text NOT NULL,
  classification text NOT NULL CHECK (classification IN (
    'valid_pass',
    'valid_model_failure',
    'harness_failure',
    'provider_failure',
    'validator_disagreement',
    'indeterminate'
  )),
  score_eligible boolean NOT NULL,
  started_at timestamptz NOT NULL,
  duration_ms bigint NOT NULL CHECK (duration_ms >= 0),
  requested_seats jsonb NOT NULL,
  resolved_seats jsonb NOT NULL,
  usage_by_role jsonb NOT NULL,
  validation jsonb,
  retry_of_attempt_id text REFERENCES modelbench.attempts(attempt_id),
  artifact_refs jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS modelbench_attempts_case_started
  ON modelbench.attempts(case_id, started_at DESC);
CREATE INDEX IF NOT EXISTS modelbench_attempts_expiry
  ON modelbench.attempts(expires_at);

REVOKE ALL ON modelbench.scenario_runs FROM PUBLIC;
REVOKE ALL ON modelbench.attempts FROM PUBLIC;
