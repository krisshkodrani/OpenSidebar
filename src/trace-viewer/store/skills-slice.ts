import type { SliceCreator, SkillsSlice } from "./types";

export const createSkillsSlice: SliceCreator<SkillsSlice> = (set) => ({
  skills: [],
  currentSkillId: null,
  skillSearchQuery: "",
  skillStatusFilter: "all",
  skillsLoading: false,

  setSkills: (skills) => set((s) => { s.skills = skills; }),
  setCurrentSkillId: (id) => set((s) => { s.currentSkillId = id; }),
  setSkillSearchQuery: (query) => set((s) => { s.skillSearchQuery = query; }),
  setSkillStatusFilter: (filter) => set((s) => { s.skillStatusFilter = filter; }),
  setSkillsLoading: (loading) => set((s) => { s.skillsLoading = loading; }),
  updateSkillLocal: (id, updates) =>
    set((s) => {
      const idx = s.skills.findIndex((sk) => sk.id === id);
      if (idx !== -1) Object.assign(s.skills[idx], updates);
    }),
  removeSkillLocal: (id) =>
    set((s) => {
      s.skills = s.skills.filter((sk) => sk.id !== id);
      if (s.currentSkillId === id) s.currentSkillId = null;
    }),
});
