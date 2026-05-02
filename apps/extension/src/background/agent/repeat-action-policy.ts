import { DomSnapshot, ToolName } from "../../types";
import { getSnapshotFingerprint } from "./loop-helpers";

const REPEAT_ACTION_EXEMPT_TOOLS = new Set<ToolName>([
  ToolName.DISMISS_OVERLAYS,
  ToolName.DONE,
  ToolName.ESCALATE,
  ToolName.READ_PAGE,
  ToolName.SCROLL_PAGE,
]);

export function shouldTrackRepeatAction(toolName: ToolName): boolean {
  return !REPEAT_ACTION_EXEMPT_TOOLS.has(toolName);
}

export function actionMemoryKey(
  toolName: ToolName,
  args: Record<string, unknown>,
  rawArgsKey: string,
  snapshot: DomSnapshot | null | undefined,
): string {
  const hasElementId =
    Object.prototype.hasOwnProperty.call(args, "id") ||
    Object.prototype.hasOwnProperty.call(args, "sourceId") ||
    Object.prototype.hasOwnProperty.call(args, "targetId");
  if (!hasElementId) return rawArgsKey;
  if (
    toolName !== ToolName.CLICK_ELEMENT &&
    toolName !== ToolName.READ_ELEMENT &&
    toolName !== ToolName.HOVER_ELEMENT &&
    toolName !== ToolName.RIGHT_CLICK &&
    toolName !== ToolName.SELECT_OPTION &&
    toolName !== ToolName.DRAG_AND_DROP
  ) {
    return rawArgsKey;
  }
  return `${rawArgsKey}@${getSnapshotFingerprint(snapshot ?? null)}`;
}
