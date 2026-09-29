CREATE TABLE IF NOT EXISTS control.run_analytics_consent (
  account_id text PRIMARY KEY REFERENCES control.accounts(account_id) ON DELETE CASCADE,
  enabled_at timestamptz
);

CREATE TABLE IF NOT EXISTS control.run_analytics (
  account_id text NOT NULL REFERENCES control.accounts(account_id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  device_id text NOT NULL REFERENCES control.devices(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  started_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY(account_id, run_id)
);
CREATE INDEX IF NOT EXISTS control_run_analytics_retention
  ON control.run_analytics(started_at);

INSERT INTO control.schema_migrations(version) VALUES (22) ON CONFLICT DO NOTHING;
