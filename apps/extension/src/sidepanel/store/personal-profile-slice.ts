import {
  analyzePersonalProfileNotes as analyzeStoredPersonalProfileNotes,
  clearProfileDigest as clearStoredProfileDigest,
  deleteProfileDigestItem as deleteStoredProfileDigestItem,
  deletePersonalProfile as deleteStoredPersonalProfile,
  EMPTY_PERSONALIZATION_STATE,
  loadPersonalizationState,
  savePersonalizationState,
  saveProfileAnalysisResult,
  updateProfileDigestItem as updateStoredProfileDigestItem,
  type ProfileDigestItemPatch,
  type ProfileAnalysisResult,
} from "../../utils/personal-profile";
import { logger } from "../../utils";
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
    const startedAt = Date.now();
    logger.info("ui", "Profile notes analysis started", {
      notesLength: current.notesMarkdown.length,
      hasFireworksApiKey: Boolean(settings.fireworksApiKey?.trim()),
    });

    let result: ProfileAnalysisResult;
    try {
      result = await analyzeStoredPersonalProfileNotes({
        notesMarkdown: current.notesMarkdown,
        settings,
      });
    } catch (error) {
      logger.error("ui", "Profile notes analysis failed", {
        error,
        durationMs: Date.now() - startedAt,
        notesLength: current.notesMarkdown.length,
      });
      throw error;
    }

    const state = await saveProfileAnalysisResult(result, uiRuntime.storage);
    if (!state) {
      logger.warn("ui", "Profile notes analysis discarded", {
        durationMs: Date.now() - startedAt,
        itemCount: result.digest.items.length,
        analyzerVersion: result.digest.analyzerVersion,
      });
      const latest = await loadPersonalizationState(uiRuntime.storage);
      set((draft) => {
        draft.personalProfileState = latest;
      });
      throw new Error(
        "Profile notes changed while analysis was running. Review and analyze again.",
      );
    }

    logger.info("ui", "Profile notes analysis succeeded", {
      durationMs: Date.now() - startedAt,
      itemCount: result.digest.items.length,
      provider: result.analyzer.provider,
      model: result.analyzer.model,
      analyzerVersion: result.analyzer.analyzerVersion,
    });
    set((draft) => {
      draft.personalProfileState = state;
    });
  },

  updatePersonalProfileDigestItem: async (
    itemId: string,
    patch: ProfileDigestItemPatch,
  ) => {
    const state = await updateStoredProfileDigestItem(
      itemId,
      patch,
      uiRuntime.storage,
    );
    set((draft) => {
      draft.personalProfileState = state;
    });
    return state;
  },

  deletePersonalProfileDigestItem: async (itemId: string) => {
    const state = await deleteStoredProfileDigestItem(itemId, uiRuntime.storage);
    set((draft) => {
      draft.personalProfileState = state;
    });
    return state;
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
