CREATE TABLE IF NOT EXISTS control.remote_work_settings (
  account_id text PRIMARY KEY REFERENCES control.accounts(account_id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1 CHECK(revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO control.schema_migrations(version) VALUES (15) ON CONFLICT DO NOTHING;
