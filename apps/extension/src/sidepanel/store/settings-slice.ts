import type { UserSettings } from "../../types";
import { logger } from "../../utils";
import { loadSettings } from "../../utils/settings-storage";
import type { SettingsSlice, SliceCreator } from "./types";

export const DEFAULT_SETTINGS: UserSettings = {
  openRouterApiKey: "",
  providerMode: "fireworks",
  perceptionMode: "auto",
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
  ttsStylePreset: "neutral",
};

export const createSettingsSlice: SliceCreator<SettingsSlice> = (set) => ({
  settings: DEFAULT_SETTINGS,

  updateSettings: (updates) =>
    set((state) => {
      Object.assign(state.settings, updates);
    }),

  loadSettingsFromStorage: async () => {
    try {
      const loaded = await loadSettings();
      if (loaded) {
        set((state) => {
          state.settings = { ...DEFAULT_SETTINGS, ...loaded };
        });
        logger.debug("ui", "Settings loaded from storage");
      }
    } catch (e) {
      logger.warn("ui", "Failed to load settings from storage", { error: e });
    }
  },
});
