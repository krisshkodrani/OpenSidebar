DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM control.schema_migrations WHERE version = 21) THEN
-- Retire active provider credentials and preferences; historical usage remains immutable.
DELETE FROM control.encrypted_credentials WHERE provider <> 'openrouter';
ALTER TABLE control.encrypted_credentials DROP CONSTRAINT encrypted_credentials_provider_check;
ALTER TABLE control.encrypted_credentials ADD CONSTRAINT encrypted_credentials_provider_check CHECK (provider = 'openrouter');
UPDATE control.preferences
SET payload = (payload - ARRAY['executorModel','plannerModel','writerModel','judgeModel','executorProviderPin','plannerProviderPin','judgeProviderPin']) || '{"providerMode":"openrouter"}'::jsonb,
    revision = revision + 1, updated_at = now()
WHERE payload->>'providerMode' IS DISTINCT FROM 'openrouter';
UPDATE control.preferences SET payload = jsonb_set(payload, '{revision}', to_jsonb(revision)) WHERE (payload->>'revision')::bigint IS DISTINCT FROM revision;
INSERT INTO control.schema_migrations(version) VALUES (21) ON CONFLICT DO NOTHING;
END IF;
END $$;
