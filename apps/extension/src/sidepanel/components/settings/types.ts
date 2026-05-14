import type { UserSettings } from "../../../types";

export type SettingsTab = "general" | "models" | "voice";

export type SettingsChangeHandler = <K extends keyof UserSettings>(
  key: K,
  value: UserSettings[K],
) => void;

export type DataControlAction =
  | "clear_logs"
  | "clear_chat_history"
  | "clear_local_data";
