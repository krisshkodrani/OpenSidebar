import type { UserSettings } from "../../../types";

export type SettingsTab = "account" | "agent" | "browser" | "advanced";

export type SettingsChangeHandler = <K extends keyof UserSettings>(
  key: K,
  value: UserSettings[K],
) => void;
