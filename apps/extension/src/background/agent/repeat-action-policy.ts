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

export interface RecentToolCall {
  tool: ToolName;
  argsKey: string;
}

export type RepeatActionDecision =
  | { action: "skip_tracking" }
  | { action: "allow" }
  | { action: "allow_final_click_bypass" }
  | { action: "block"; repeatCount: number; message: string };

export function assessRepeatAction(params: {
  toolName: ToolName;
  argsKey: string;
  recentToolCalls: RecentToolCall[];
  isExempt: boolean;
  allowFinalClickBypass: () => boolean;
}): RepeatActionDecision {
  const { toolName, argsKey, recentToolCalls, isExempt, allowFinalClickBypass } =
    params;
  if (!shouldTrackRepeatAction(toolName) || isExempt) {
    return { action: "skip_tracking" };
  }

  const priorRepeatCount = recentToolCalls.filter(
    (entry) => entry.tool === toolName && entry.argsKey === argsKey,
  ).length;
  if (priorRepeatCount < 2) {
    return { action: "allow" };
  }

  if (allowFinalClickBypass()) {
    return { action: "allow_final_click_bypass" };
  }

  const repeatCount = priorRepeatCount + 1;
  return {
    action: "block",
    repeatCount,
    message:
      `BLOCKED: You already called ${toolName} with the same arguments ${repeatCount} times in recent turns. ` +
      `This is cycling. Try a fundamentally different action or call escalate({"reason": "Repeated ${toolName} without progress"})`,
  };
}

export function rememberRepeatAction(
  recentToolCalls: RecentToolCall[],
  toolName: ToolName,
  argsKey: string,
  repeatActionWindow: number,
): void {
  recentToolCalls.push({ tool: toolName, argsKey });
  if (recentToolCalls.length > repeatActionWindow) {
    recentToolCalls.shift();
  }
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
