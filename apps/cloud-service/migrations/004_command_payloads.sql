ALTER TABLE sessions.device_commands
  ADD COLUMN IF NOT EXISTS payload_object_key text,
  ADD COLUMN IF NOT EXISTS payload_ciphertext_size_bytes integer,
  ADD COLUMN IF NOT EXISTS payload_ciphertext_sha256 text;

ALTER TABLE sessions.device_commands
  DROP CONSTRAINT IF EXISTS device_commands_payload_metadata_check;
ALTER TABLE sessions.device_commands
  ADD CONSTRAINT device_commands_payload_metadata_check CHECK (
    (payload_object_key IS NULL AND payload_ciphertext_size_bytes IS NULL AND payload_ciphertext_sha256 IS NULL)
    OR
    (length(payload_object_key) BETWEEN 1 AND 700
      AND payload_ciphertext_size_bytes BETWEEN 1 AND 131072
      AND payload_ciphertext_sha256 ~ '^[a-f0-9]{64}$')
  );

INSERT INTO sessions.schema_migrations(version) VALUES (4) ON CONFLICT DO NOTHING;
