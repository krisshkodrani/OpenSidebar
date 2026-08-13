ALTER TABLE control.devices
  ADD COLUMN IF NOT EXISTS display_name_revision bigint NOT NULL DEFAULT 1;

INSERT INTO control.schema_migrations(version) VALUES (3) ON CONFLICT DO NOTHING;
