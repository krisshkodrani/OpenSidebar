import type { UserSettings } from "../../types";
import { logger } from "../../utils";
import type { SettingsSlice, SliceCreator } from "./types";

export const DEFAULT_SETTINGS: UserSettings = {
  openRouterApiKey: "",
  groqApiKey: "",
  maxTurns: 500,
  contextWindowSize: 128000,
  workspaceEnabled: true,
  theme: "system",
  showSessionMetrics: true,
  showMessageDetailsByDefault: false,
  siteAccessMode: "allow_all",
  siteAccessBlocklist: [],
  disableNavigation: false,
  bypassApprovals: false,
  orchestratorMaxTotalTokens: 1_000_000,
  demosAutoInject: true,
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
      const result = await chrome.storage.sync.get("userSettings");
      if (result.userSettings) {
        set((state) => {
          state.settings = { ...DEFAULT_SETTINGS, ...result.userSettings };
        });
        logger.debug("ui", "Settings loaded from storage");
      }
    } catch (e) {
      logger.warn("ui", "Failed to load settings from storage", { error: e });
    }
  },
});
