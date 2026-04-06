import type { SliceCreator, UiSlice } from "./types";

export const createUiSlice: SliceCreator<UiSlice> = (set) => ({
  activeTab: "sessions",
  tabInitialized: { sessions: false, trace: false },

  setActiveTab: (tab) =>
    set((s) => {
      s.activeTab = tab;
    }),
  markTabInitialized: (tab) =>
    set((s) => {
      s.tabInitialized[tab] = true;
    }),
});
