interface ImportMetaEnv {
  readonly MODE: string;
  readonly VITE_OPENSIDEBAR_COGNITO_DOMAIN?: string;
  readonly VITE_OPENSIDEBAR_COGNITO_EXTENSION_CLIENT_ID?: string;
  readonly VITE_CLOUD_SESSIONS_ENABLED?: string;
  readonly VITE_CHECKPOINT_RESTORE_ENABLED?: string;
  readonly VITE_DEVICE_COMMANDS_ENABLED?: string;
  readonly VITE_DEVICE_TAKEOVER_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
