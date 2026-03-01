/**
 * Golden Builder — action ↔ tool call mapping utilities.
 *
 * Pure functions: no side effects, no chrome APIs.
 */

import type { GoldenAction, ToolName, DomSnapshot } from "../../types";

// --- Action → Tool Call Mapping ---

interface ExpectedToolCall {
  toolName: ToolName;
  args: Record<string, unknown>;
}

/**
 * Map a DemoAction + tagId to the tool call the agent would make.
 */
export function actionToToolCall(
  action: GoldenAction["action"],
  tagId: number | null,
): ExpectedToolCall | null {
  switch (action.type) {
    case "click":
      if (tagId == null) return null;
      return { toolName: "click_element" as ToolName, args: { id: tagId } };

    case "type":
      if (tagId == null || !action.value) return null;
      return {
        toolName: "type_text" as ToolName,
        args: { id: tagId, text: action.value },
      };

    case "scroll":
      return {
        toolName: "scroll_page" as ToolName,
        args: {
          direction: (action.scrollDelta ?? 0) > 0 ? "down" : "up",
          amount: Math.abs(action.scrollDelta ?? 500),
        },
      };

    case "select":
      if (tagId == null || !action.value) return null;
      return {
        toolName: "select_option" as ToolName,
        args: { id: tagId, value: action.value },
      };

    case "press_key": {
      if (!action.key) return null;
      const modifiers: string[] = [];
      if (action.value) {
        for (const mod of action.value.split("+")) {
          if (mod) modifiers.push(mod);
        }
      }
      const args: Record<string, unknown> = { key: action.key };
      if (modifiers.length > 0) args.modifiers = modifiers;
      return { toolName: "press_key" as ToolName, args };
    }

    case "navigate":
      return {
        toolName: "navigate" as ToolName,
        args: { url: action.url },
      };

    case "annotate":
      return null;

    default:
      return null;
  }
}

/**
 * Reverse mapping: convert a tool call + snapshot into a GoldenAction.
 * Used by ManualModeHandler to inject manual commands into golden recording.
 */
export function toolCallToGoldenAction(
  toolName: ToolName,
  args: Record<string, unknown>,
  snapshot: DomSnapshot,
): GoldenAction {
  const typeMap: Record<string, string> = {
    click_element: "click",
    type_text: "type",
    scroll_page: "scroll",
    select_option: "select",
    press_key: "press_key",
    navigate: "navigate",
    hover_element: "hover",
  };
  const actionType = typeMap[toolName] ?? "click";
  const tagId = typeof args.id === "number" ? args.id : null;

  return {
    action: {
      type: actionType,
      timestamp: Date.now(),
      url: snapshot.url,
      value:
        typeof args.text === "string"
          ? args.text
          : typeof args.value === "string"
            ? args.value
            : undefined,
      key: typeof args.key === "string" ? args.key : undefined,
      scrollDelta:
        actionType === "scroll"
          ? args.direction === "down"
            ? ((args.amount as number) ?? 500)
            : -((args.amount as number) ?? 500)
          : undefined,
    },
    tagId,
    snapshot,
  };
}
