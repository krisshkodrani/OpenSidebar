import { logger } from "../../utils";
import {
  RECORD_SKILL_INTRO_DISMISSED_KEY,
  updateUserWebsiteSkill,
} from "../../utils/website-skills";
import { UserWebsiteSkillDraft } from "../../types";
import { uiRuntime } from "../runtime";
import type { SliceCreator, WebsiteSkillsSlice } from "./types";

function message<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
  return uiRuntime.sendMessage({
    type,
    requestId: crypto.randomUUID(),
    source: uiRuntime.source,
    payload,
  });
}

export const createWebsiteSkillsSlice: SliceCreator<WebsiteSkillsSlice> = (
  set,
) => ({
  userWebsiteSkills: [],
  recordSkillIntroDismissed: false,
  skillRecordingStatus: "idle",
  skillRecordingTimeline: [],
  skillRecordingDraft: null,
  activeUserWebsiteSkill: null,

  loadUserWebsiteSkills: async () => {
    try {
      const [intro, response] = await Promise.all([
        uiRuntime.storage.local.get(RECORD_SKILL_INTRO_DISMISSED_KEY),
        message<{ ok: boolean; skills?: WebsiteSkillsSlice["userWebsiteSkills"] }>(
          "USER_SKILL_LIST",
        ),
      ]);
      set((state) => {
        state.recordSkillIntroDismissed =
          intro[RECORD_SKILL_INTRO_DISMISSED_KEY] === true;
        state.userWebsiteSkills = response.skills ?? [];
      });
    } catch (e) {
      logger.warn("ui", "Failed to load website skills", { error: e });
    }
  },

  startSkillRecording: async (tabId) => {
    try {
      const response = await message<{ ok: boolean; detail?: string }>(
        "SKILL_RECORDING_START",
        { tabId },
      );
      if (!response.ok) {
        set((state) => {
          state.skillRecordingStatus = "paused";
          state.skillRecordingTimeline = [];
        });
      }
    } catch (e) {
      logger.warn("ui", "Failed to start skill recording", { error: e });
    }
  },

  stopSkillRecording: async (tabId) => {
    try {
      const response = await message<{
        ok: boolean;
        draft?: UserWebsiteSkillDraft;
      }>("SKILL_RECORDING_STOP", tabId != null ? { tabId } : {});
      if (response.ok && response.draft) {
        set((state) => {
          state.skillRecordingStatus = "review";
          state.skillRecordingDraft = response.draft!;
        });
      }
    } catch (e) {
      logger.warn("ui", "Failed to stop skill recording", { error: e });
    }
  },

  cancelSkillRecording: async (tabId) => {
    try {
      await message("SKILL_RECORDING_CANCEL", tabId != null ? { tabId } : {});
      set((state) => {
        state.skillRecordingStatus = "idle";
        state.skillRecordingTimeline = [];
        state.skillRecordingDraft = null;
      });
    } catch (e) {
      logger.warn("ui", "Failed to cancel skill recording", { error: e });
    }
  },

  saveUserWebsiteSkill: async (draft) => {
    try {
      const response = await message<{
        ok: boolean;
        skills?: WebsiteSkillsSlice["userWebsiteSkills"];
      }>("USER_SKILL_SAVE", { draft, enabled: true });
      set((state) => {
        state.userWebsiteSkills = response.skills ?? state.userWebsiteSkills;
        state.skillRecordingStatus = "idle";
        state.skillRecordingTimeline = [];
        state.skillRecordingDraft = null;
      });
    } catch (e) {
      logger.warn("ui", "Failed to save website skill", { error: e });
    }
  },

  updateUserWebsiteSkillLocal: async (id, updates) => {
    try {
      const skills = await updateUserWebsiteSkill(
        id,
        updates,
        uiRuntime.storage.local,
      );
      set((state) => {
        state.userWebsiteSkills = skills;
      });
    } catch (e) {
      logger.warn("ui", "Failed to update website skill", { error: e });
    }
  },

  deleteUserWebsiteSkill: async (id) => {
    try {
      const response = await message<{
        ok: boolean;
        skills?: WebsiteSkillsSlice["userWebsiteSkills"];
      }>("USER_SKILL_DELETE", { id });
      set((state) => {
        state.userWebsiteSkills = response.skills ?? state.userWebsiteSkills;
      });
    } catch (e) {
      logger.warn("ui", "Failed to delete website skill", { error: e });
    }
  },

  setRecordSkillIntroDismissed: async (dismissed) => {
    await uiRuntime.storage.local.set({
      [RECORD_SKILL_INTRO_DISMISSED_KEY]: dismissed,
    });
    set((state) => {
      state.recordSkillIntroDismissed = dismissed;
    });
  },

  setSkillRecordingStatus: (payload) => {
    set((state) => {
      state.skillRecordingStatus = payload.status;
      state.skillRecordingTimeline = payload.timeline;
      if (payload.draft) state.skillRecordingDraft = payload.draft;
    });
  },

  clearSkillRecordingDraft: () => {
    set((state) => {
      state.skillRecordingStatus = "idle";
      state.skillRecordingTimeline = [];
      state.skillRecordingDraft = null;
    });
  },

  setActiveUserWebsiteSkill: (skill) => {
    set((state) => {
      state.activeUserWebsiteSkill = skill;
    });
  },
});
