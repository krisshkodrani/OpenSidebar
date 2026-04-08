import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Store } from "./store/types";
import { createTracesSlice } from "./store/traces-slice";

export const useStore = create<Store>()(
  immer((...a) => ({
    ...createTracesSlice(...a),
  })),
);
