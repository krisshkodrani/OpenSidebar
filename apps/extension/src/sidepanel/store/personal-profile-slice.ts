import {
  analyzePersonalProfileNotes as analyzeStoredPersonalProfileNotes,
  clearProfileDigest as clearStoredProfileDigest,
  deletePersonalProfile as deleteStoredPersonalProfile,
  EMPTY_PERSONALIZATION_STATE,
  loadPersonalizationState,
  savePersonalizationState,
  saveProfileAnalysisResult,
  type ProfileAnalysisResult,
} from "../../utils/personal-profile";
import { uiRuntime } from "../runtime";
import type { PersonalProfileSlice, SliceCreator } from "./types";

export const createPersonalProfileSlice: SliceCreator<PersonalProfileSlice> = (
  set,
  get,
) => ({
  personalProfileState: EMPTY_PERSONALIZATION_STATE,

  loadPersonalProfile: async () => {
    const state = await loadPersonalizationState(uiRuntime.storage);
    set((draft) => {
      draft.personalProfileState = state;
    });
  },

  savePersonalProfileNotes: async (
    notesMarkdown: string,
    enabled?: boolean,
  ) => {
    const current = get().personalProfileState;
    const state = await savePersonalizationState(
      {
        notesMarkdown,
        enabled: enabled ?? current.enabled,
      },
      uiRuntime.storage,
    );
    set((draft) => {
      draft.personalProfileState = state;
    });
  },

  savePersonalProfileAnalysis: async (result: ProfileAnalysisResult) => {
    const state = await saveProfileAnalysisResult(result, uiRuntime.storage);
    if (!state) return false;
    set((draft) => {
      draft.personalProfileState = state;
    });
    return true;
  },

  analyzePersonalProfileNotes: async () => {
    const current = get().personalProfileState;
    const settings = get().settings;
    const result = await analyzeStoredPersonalProfileNotes({
      notesMarkdown: current.notesMarkdown,
      settings,
    });
    const state = await saveProfileAnalysisResult(result, uiRuntime.storage);
    if (!state) {
      const latest = await loadPersonalizationState(uiRuntime.storage);
      set((draft) => {
        draft.personalProfileState = latest;
      });
      throw new Error(
        "Profile notes changed while analysis was running. Review and analyze again.",
      );
    }
    set((draft) => {
      draft.personalProfileState = state;
    });
  },

  clearPersonalProfileDigest: async () => {
    const state = await clearStoredProfileDigest(uiRuntime.storage);
    set((draft) => {
      draft.personalProfileState = state;
    });
  },

  deletePersonalProfile: async () => {
    const state = await deleteStoredPersonalProfile(uiRuntime.storage);
    set((draft) => {
      draft.personalProfileState = state;
    });
  },

  setPersonalProfileEnabled: async (enabled: boolean) => {
    const state = await savePersonalizationState(
      {
        enabled,
      },
      uiRuntime.storage,
    );
    set((draft) => {
      draft.personalProfileState = state;
    });
  },
});
