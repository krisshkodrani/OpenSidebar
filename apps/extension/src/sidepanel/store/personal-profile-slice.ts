import {
  deletePersonalProfile as deleteStoredPersonalProfile,
  EMPTY_PERSONALIZATION_STATE,
  loadPersonalizationState,
  savePersonalizationState,
  type PersonalProfile,
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

  savePersonalProfile: async (profile: PersonalProfile, enabled?: boolean) => {
    const current = get().personalProfileState;
    const state = await savePersonalizationState(
      {
        profile,
        enabled: enabled ?? current.enabled,
      },
      uiRuntime.storage,
    );
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
    const current = get().personalProfileState;
    const state = await savePersonalizationState(
      {
        profile: current.profile,
        enabled,
      },
      uiRuntime.storage,
    );
    set((draft) => {
      draft.personalProfileState = state;
    });
  },
});
