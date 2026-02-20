import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createChatSlice } from "./store/chat-slice";
import { createAgentSlice } from "./store/agent-slice";
import { createSettingsSlice } from "./store/settings-slice";
import { createSavedPromptsSlice } from "./store/saved-prompts-slice";
import { createUiSlice } from "./store/ui-slice";
import type { Store } from "./store/types";

export type { Store } from "./store/types";

export const useStore = create<Store>()(
  immer((...a) => ({
    ...createChatSlice(...a),
    ...createAgentSlice(...a),
    ...createSettingsSlice(...a),
    ...createSavedPromptsSlice(...a),
    ...createUiSlice(...a),
  })),
);
