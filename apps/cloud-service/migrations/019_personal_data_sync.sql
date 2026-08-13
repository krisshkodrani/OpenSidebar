CREATE TABLE IF NOT EXISTS control.personal_data_accounts (
  account_id text PRIMARY KEY REFERENCES control.accounts(account_id) ON DELETE CASCADE,
  key_epoch bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS control.personal_data_device_keys (
  account_id text NOT NULL REFERENCES control.accounts(account_id) ON DELETE CASCADE,
  device_id text NOT NULL REFERENCES control.devices(id) ON DELETE CASCADE,
  public_key_jwk jsonb NOT NULL,
  key_epoch bigint NOT NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id, device_id)
);

CREATE TABLE IF NOT EXISTS control.personal_data_key_requests (
  id uuid PRIMARY KEY,
  account_id text NOT NULL REFERENCES control.accounts(account_id) ON DELETE CASCADE,
  requesting_device_id text NOT NULL REFERENCES control.devices(id) ON DELETE CASCADE,
  public_key_jwk jsonb NOT NULL,
  state text NOT NULL CHECK(state IN ('pending','approved','denied')),
  wrapped_key jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz
);
CREATE INDEX IF NOT EXISTS control_personal_data_key_requests_account
  ON control.personal_data_key_requests(account_id, state, expires_at);

CREATE TABLE IF NOT EXISTS control.personal_data_documents (
  account_id text NOT NULL REFERENCES control.accounts(account_id) ON DELETE CASCADE,
  category text NOT NULL CHECK(category IN ('saved_prompts','website_skills','profile')),
  revision bigint NOT NULL,
  key_epoch bigint NOT NULL,
  object_key text NOT NULL,
  ciphertext_size_bytes bigint NOT NULL,
  ciphertext_sha256 text NOT NULL,
  updated_by_device_id text NOT NULL REFERENCES control.devices(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id, category)
);

CREATE TABLE IF NOT EXISTS control.personal_data_object_deletions (
  account_id text NOT NULL REFERENCES control.accounts(account_id) ON DELETE CASCADE,
  object_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  PRIMARY KEY(account_id, object_key)
);

INSERT INTO control.schema_migrations(version) VALUES (19) ON CONFLICT DO NOTHING;
