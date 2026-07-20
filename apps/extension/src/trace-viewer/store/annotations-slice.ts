import type { SliceCreator, AnnotationsSlice } from "./types";
import { annotationKeyFor } from "./types";
import * as api from "../api";

// Human-adjudication state: the latest verdict per run/session, plus the
// actions to load the fleet-wide set and submit a new verdict. Kept in its own
// slice so the Attention inbox (P5) and the fleet badges read one source.

export const createAnnotationsSlice: SliceCreator<AnnotationsSlice> = (set) => ({
  annotations: {},
  annotationsLoading: false,
  annotationsError: null,

  loadAnnotations: async () => {
    set((s) => {
      s.annotationsLoading = true;
      s.annotationsError = null;
    });
    try {
      const records = await api.fetchAnnotations();
      set((s) => {
        const next: AnnotationsSlice["annotations"] = {};
        for (const rec of records) next[annotationKeyFor(rec)] = rec;
        s.annotations = next;
        s.annotationsLoading = false;
      });
    } catch (err) {
      set((s) => {
        s.annotationsLoading = false;
        s.annotationsError = err instanceof Error ? err.message : String(err);
      });
    }
  },

  submitAnnotation: async (input) => {
    try {
      const record = await api.postAnnotation(input);
      set((s) => {
        s.annotations[annotationKeyFor(record)] = record;
      });
      return record;
    } catch (err) {
      set((s) => {
        s.annotationsError = err instanceof Error ? err.message : String(err);
      });
      return null;
    }
  },

  markAnnotationExported: (key, exported) =>
    set((s) => {
      const existing = s.annotations[key];
      if (existing) existing.exported = { ...existing.exported, ...exported };
    }),
});
