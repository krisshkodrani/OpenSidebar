import {
  DEFAULT_ENABLED_SKILL_PACK_IDS,
  DEFAULT_JOBAGENT_MCP_URL,
  DEFAULT_MAX_IMAGE_PROMPT_TOKEN_ESTIMATE,
  type UserSettings,
} from "../../types";
import { logger } from "../../utils";
import { loadSettings } from "../../utils/settings-storage";
import { uiRuntime } from "../runtime";
import type { SettingsSlice, SliceCreator } from "./types";

export const DEFAULT_SETTINGS: UserSettings = {
  openRouterApiKey: "",
  providerMode: "fireworks",
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
  voiceMode: "off",
  jobAgentMcpEnabled: false,
  jobAgentMcpUrl: DEFAULT_JOBAGENT_MCP_URL,
  jobAgentMcpToken: "",
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
