import type { SliceCreator, MemorySlice } from "./types";

export const createMemorySlice: SliceCreator<MemorySlice> = (set) => ({
  memoryEntries: [],
  memoryCategories: [],
  currentMemoryEntryId: null,
  memorySearchQuery: "",
  memoryCategoryFilter: "all",
  memoryLoading: false,

  setMemoryEntries: (entries) => set((s) => { s.memoryEntries = entries; }),
  setMemoryCategories: (categories) => set((s) => { s.memoryCategories = categories; }),
  setCurrentMemoryEntryId: (id) => set((s) => { s.currentMemoryEntryId = id; }),
  setMemorySearchQuery: (query) => set((s) => { s.memorySearchQuery = query; }),
  setMemoryCategoryFilter: (filter) => set((s) => { s.memoryCategoryFilter = filter; }),
  setMemoryLoading: (loading) => set((s) => { s.memoryLoading = loading; }),
  removeMemoryEntryLocal: (id) =>
    set((s) => {
      s.memoryEntries = s.memoryEntries.filter((e) => e.id !== id);
      if (s.currentMemoryEntryId === id) s.currentMemoryEntryId = null;
    }),
});
