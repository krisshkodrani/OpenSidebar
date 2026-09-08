ALTER TABLE control.devices
  ADD COLUMN IF NOT EXISTS remote_mission_ready_at timestamptz;

CREATE INDEX IF NOT EXISTS control_devices_remote_mission_ready
  ON control.devices(account_id, remote_mission_ready_at)
  WHERE revoked_at IS NULL AND remote_mission_ready_at IS NOT NULL;
