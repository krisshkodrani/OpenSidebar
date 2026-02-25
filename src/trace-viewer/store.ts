import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Store } from "./store/types";
import { createTracesSlice } from "./store/traces-slice";
import { createSkillsSlice } from "./store/skills-slice";
import { createMemorySlice } from "./store/memory-slice";
import { createUiSlice } from "./store/ui-slice";

export const useStore = create<Store>()(
  immer((...a) => ({
    ...createTracesSlice(...a),
    ...createSkillsSlice(...a),
    ...createMemorySlice(...a),
    ...createUiSlice(...a),
  })),
);
