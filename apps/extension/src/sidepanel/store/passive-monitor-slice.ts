import type { PassiveInputSource } from "../../types";
import type { PassiveMonitorSlice, SliceCreator } from "./types";

function normalizeInputSources(
  sources: PassiveInputSource[],
): PassiveInputSource[] {
  const out = sources.filter(
    (source, index) =>
      (source === "page" || source === "screenshot" || source === "tabAudio") &&
      sources.indexOf(source) === index,
  );
  return out.length > 0 ? out : ["page"];
}

export const createPassiveMonitorSlice: SliceCreator<PassiveMonitorSlice> = (
  set,
) => ({
  passiveStatus: null,
  passiveStatusDetail: null,
  passiveInstructions: "",
  passiveInputSources: ["page"],
  passiveLastObservationAt: null,
  passiveSessionId: null,

  setPassiveMonitorStatus: (
    status,
    detail = null,
    observedAt = null,
    sessionId = null,
  ) =>
    set((state) => {
      state.passiveStatus = status;
      state.passiveStatusDetail = detail;
      if (observedAt != null) state.passiveLastObservationAt = observedAt;
      if (sessionId !== null) state.passiveSessionId = sessionId;
      if (status === "stopped" || status === null) {
        state.passiveSessionId = null;
      }
    }),

  setPassiveInstructions: (instructions) =>
    set((state) => {
      state.passiveInstructions = instructions;
    }),

  setPassiveInputSources: (sources) =>
    set((state) => {
      state.passiveInputSources = normalizeInputSources(sources);
    }),

  clearPassiveMonitor: () =>
    set((state) => {
      state.passiveStatus = null;
      state.passiveStatusDetail = null;
      state.passiveLastObservationAt = null;
      state.passiveSessionId = null;
    }),
});
