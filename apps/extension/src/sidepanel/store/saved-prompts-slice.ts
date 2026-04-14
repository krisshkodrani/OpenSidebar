import { logger } from "../../utils";
import {
  loadSavedPrompts as loadFromStorage,
  addSavedPrompt as addToStorage,
  updateSavedPrompt as updateInStorage,
  deleteSavedPrompt as deleteFromStorage,
} from "../saved-prompts";
import type { SavedPromptsSlice, SliceCreator } from "./types";

export const createSavedPromptsSlice: SliceCreator<SavedPromptsSlice> = (
  set,
) => ({
  savedPrompts: [],

  loadSavedPrompts: async () => {
    try {
      const prompts = await loadFromStorage();
      set((state) => {
        state.savedPrompts = prompts;
      });
    } catch (e) {
      logger.warn("ui", "Failed to load saved prompts", { error: e });
    }
  },

  addSavedPrompt: async (title, content, category) => {
    try {
      await addToStorage(title, content, category);
      const prompts = await loadFromStorage();
      set((state) => {
        state.savedPrompts = prompts;
      });
    } catch (e) {
      logger.warn("ui", "Failed to add saved prompt", { error: e });
    }
  },

  updateSavedPrompt: async (id, updates) => {
    try {
      const prompts = await updateInStorage(id, updates);
      set((state) => {
        state.savedPrompts = prompts;
      });
    } catch (e) {
      logger.warn("ui", "Failed to update saved prompt", { error: e });
    }
  },

  deleteSavedPrompt: async (id) => {
    try {
      const prompts = await deleteFromStorage(id);
      set((state) => {
        state.savedPrompts = prompts;
      });
    } catch (e) {
      logger.warn("ui", "Failed to delete saved prompt", { error: e });
    }
  },
});
