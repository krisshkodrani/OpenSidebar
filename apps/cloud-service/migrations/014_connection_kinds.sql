ALTER TABLE control.devices
  ADD COLUMN IF NOT EXISTS connection_kind text NOT NULL DEFAULT 'browser_extension';

UPDATE control.devices
SET connection_kind='test_client'
WHERE extension_version='acceptance-1';

ALTER TABLE control.devices
  DROP CONSTRAINT IF EXISTS control_devices_connection_kind_check;
ALTER TABLE control.devices
  ADD CONSTRAINT control_devices_connection_kind_check
  CHECK(connection_kind IN ('browser_extension','codex_integration','test_client'));

INSERT INTO control.schema_migrations(version) VALUES (14) ON CONFLICT DO NOTHING;
