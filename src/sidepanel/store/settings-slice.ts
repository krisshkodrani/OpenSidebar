import type { UserSettings } from "../../types";
import { logger } from "../../utils";
import type { SettingsSlice, SliceCreator } from "./types";

export const DEFAULT_SETTINGS: UserSettings = {
  openRouterApiKey: __OPENROUTER_API_KEY__,
  groqApiKey: __GROQ_API_KEY__,
  cerebrasApiKey: __CEREBRAS_API_KEY__,
  maxTurns: 500,
  contextWindowSize: 128000,
  memoryEnabled: true,
  workspaceEnabled: true,
  theme: "system",
  showElementTags: false,
  visionModel: "qwen/qwen3-vl-235b-a22b-instruct",
  showSessionMetrics: true,
  showMessageDetailsByDefault: false,
  siteAccessMode: "allow_all",
  siteAccessBlocklist: [],
  disableScreenshot: false,
  disableNavigation: false,
  bypassApprovals: false,
  speechProvider: "browser",
  orchestratorMaxTotalTokens: 1_000_000,
  teachModeEnabled: true,
  autoSkillReplayEnabled: true,
  skillReplayPinnedOnly: false,
  skillReplayDryRun: false,
  demoEnabled: true,
  demosAutoInject: true,
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
