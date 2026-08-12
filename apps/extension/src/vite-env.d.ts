interface ImportMetaEnv {
  readonly MODE: string;
  readonly VITE_CLOUD_SESSIONS_ENABLED?: string;
  readonly VITE_CHECKPOINT_RESTORE_ENABLED?: string;
  readonly VITE_DEVICE_COMMANDS_ENABLED?: string;
  readonly VITE_DEVICE_TAKEOVER_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
