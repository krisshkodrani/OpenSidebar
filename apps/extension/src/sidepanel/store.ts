import { create, type StoreApi, type UseBoundStore } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createChatSlice } from "./store/chat-slice";
import { createAgentSlice } from "./store/agent-slice";
import { createSettingsSlice } from "./store/settings-slice";
import { createSavedPromptsSlice } from "./store/saved-prompts-slice";
import { createWebsiteSkillsSlice } from "./store/website-skills-slice";
import { createPersonalProfileSlice } from "./store/personal-profile-slice";
import { createUiSlice } from "./store/ui-slice";
import { createPassiveMonitorSlice } from "./store/passive-monitor-slice";
import type { Store } from "./store/types";

export type { Store } from "./store/types";

export const useStore: UseBoundStore<StoreApi<Store>> = create<Store>()(
  immer((...a) => ({
    ...createChatSlice(...a),
    ...createAgentSlice(...a),
    ...createSettingsSlice(...a),
    ...createSavedPromptsSlice(...a),
    ...createWebsiteSkillsSlice(...a),
    ...createPersonalProfileSlice(...a),
    ...createUiSlice(...a),
    ...createPassiveMonitorSlice(...a),
  })),
);
