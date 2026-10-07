DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM control.schema_migrations WHERE version=22) THEN
UPDATE control.preferences SET payload = payload - ARRAY['groqApiKey','voiceMode','enableVoiceInput','enableVoiceOutput','ttsProvider','ttsVoice','ttsStylePreset','autoVoiceResponse','audioEnabled','speechEnabled'], revision=revision+1, updated_at=now()
WHERE payload ?| ARRAY['groqApiKey','voiceMode','enableVoiceInput','enableVoiceOutput','ttsProvider','ttsVoice','ttsStylePreset','autoVoiceResponse','audioEnabled','speechEnabled'];
UPDATE control.preferences SET payload=jsonb_set(payload,'{revision}',to_jsonb(revision)) WHERE (payload->>'revision')::bigint IS DISTINCT FROM revision;
INSERT INTO control.schema_migrations(version) VALUES(22);
END IF; END $$;
