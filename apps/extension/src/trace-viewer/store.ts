import { create, type StoreApi, type UseBoundStore } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { Store } from "./store/types";
import { createTracesSlice } from "./store/traces-slice";
import { createAnnotationsSlice } from "./store/annotations-slice";

export const useStore: UseBoundStore<StoreApi<Store>> = create<Store>()(
  immer((...a) => ({
    ...createTracesSlice(...a),
    ...createAnnotationsSlice(...a),
  })),
);
