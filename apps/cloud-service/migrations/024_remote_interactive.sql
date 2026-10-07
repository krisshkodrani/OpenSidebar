ALTER TABLE control.devices ADD COLUMN IF NOT EXISTS remote_interactive_ready boolean NOT NULL DEFAULT false;
