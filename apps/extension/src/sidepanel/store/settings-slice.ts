import {
  DEFAULT_ENABLED_SKILL_PACK_IDS,
  DEFAULT_MAX_IMAGE_PROMPT_TOKEN_ESTIMATE,
  type UserSettings,
} from "../../types";
import { logger } from "../../utils";
import { loadSettings } from "../../utils/settings-storage";
import { DEFAULT_PROVIDER_MODE } from "../../utils/executor-model-policy";
import { uiRuntime } from "../runtime";
import {
  cloudPreferences,
  cloudPreferencesLinked,
  cloudSession,
} from "../cloud-client";
import type { SettingsSlice, SliceCreator } from "./types";

export const DEFAULT_SETTINGS: UserSettings = {
  inferenceMode: "local",
  traceSyncEnabled: false,
  openRouterApiKey: "",
  providerMode: DEFAULT_PROVIDER_MODE,
  perceptionMode: "auto",
  maxImagePromptTokenEstimate: DEFAULT_MAX_IMAGE_PROMPT_TOKEN_ESTIMATE,
  enabledSkillPackIds: [...DEFAULT_ENABLED_SKILL_PACK_IDS],
  laneTopologyMode: "full",
  maxTurns: 100,
  theme: "system",
  showSessionMetrics: true,
  showMessageDetailsByDefault: false,
  showDebugScreenshots: false,
  enableBrowserNotifications: false,
  siteAccessMode: "allow_all",
  siteAccessBlocklist: [],
  requireApprovals: true,
  allowNavigation: true,
  requirePlanConfirmation: true,
};

export const createSettingsSlice: SliceCreator<SettingsSlice> = (set) => ({
  settings: DEFAULT_SETTINGS,

  updateSettings: (updates) =>
    set((state) => {
      Object.assign(state.settings, updates);
    }),

  loadSettingsFromStorage: async () => {
    try {
      const loaded = await loadSettings(uiRuntime.storage);
      if (loaded) {
        const cloud = await Promise.all([
          cloudSession(),
          cloudPreferencesLinked(),
        ])
          .then(([session, linked]) =>
            session && linked ? cloudPreferences() : null,
          )
          .catch(() => null);
        const cloudValues = cloud
          ? Object.fromEntries(
              Object.entries(cloud).filter(
                ([key]) => key !== "schemaVersion" && key !== "revision",
              ),
            )
          : {};
        set((state) => {
          state.settings = { ...DEFAULT_SETTINGS, ...loaded, ...cloudValues };
        });
        logger.debug("ui", "Settings loaded from storage");
      }
    } catch (e) {
      logger.warn("ui", "Failed to load settings from storage", { error: e });
    }
  },
});
