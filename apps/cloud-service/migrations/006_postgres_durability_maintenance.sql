CREATE INDEX IF NOT EXISTS device_connections_expiry
  ON sessions.device_connections(expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS device_commands_expiry
  ON sessions.device_commands(expires_at)
  WHERE state IN ('pending','leased','delivered');
