import type { GenericSequentialToolState } from "./loop-tool-handlers";

export interface SequentialRuntimeState {
  prevElementCount: number;
  domModified: boolean;
  visuallyModified: boolean;
  lastDomAffectingToolName: string | null;
}

export function mergeGenericSequentialToolState(
  state: SequentialRuntimeState,
  genericToolState: GenericSequentialToolState,
): SequentialRuntimeState {
  return {
    ...state,
    prevElementCount: genericToolState.prevElementCount,
    domModified: genericToolState.domModified,
    visuallyModified: genericToolState.visuallyModified,
    lastDomAffectingToolName: genericToolState.lastDomAffectingToolName,
  };
}
