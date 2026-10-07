-- MCP authorization is separate from browser/extension credentials.
CREATE TABLE IF NOT EXISTS control.mcp_oauth_grants (
  token_hash text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('code','access','refresh')),
  family_id text NOT NULL,
  account_id text NOT NULL REFERENCES control.accounts(account_id) ON DELETE CASCADE,
  device_id text NOT NULL REFERENCES control.devices(id) ON DELETE CASCADE,
  session_epoch bigint NOT NULL,
  client_id text NOT NULL,
  resource text NOT NULL,
  scopes text[] NOT NULL,
  redirect_uri text,
  challenge text,
  expires_at timestamptz NOT NULL,
  family_expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS mcp_oauth_family ON control.mcp_oauth_grants(family_id);
CREATE INDEX IF NOT EXISTS mcp_oauth_expiry ON control.mcp_oauth_grants(expires_at);
