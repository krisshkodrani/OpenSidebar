import type { UserSettings } from "../../../types";

export type SettingsTab = "general" | "models";

export type SettingsChangeHandler = <K extends keyof UserSettings>(
  key: K,
  value: UserSettings[K],
) => void;
