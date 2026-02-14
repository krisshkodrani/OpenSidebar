import { ToolName } from "../../types";

/**
 * Maps a tool invocation to a concise, human-readable label for the step timeline.
 */
export function formatStepLabel(
  toolName: ToolName,
  args: Record<string, unknown>,
): string {
  switch (toolName) {
    case ToolName.NAVIGATE: {
      const url = args.url as string | undefined;
      if (url) {
        try {
          return `Navigate to ${new URL(url).hostname}`;
        } catch {
          return `Navigate to ${url.slice(0, 40)}`;
        }
      }
      return "Navigate";
    }
    case ToolName.CLICK_ELEMENT:
      return `Click element [${args.id ?? "?"}]`;
    case ToolName.TYPE_TEXT: {
      const text = args.text as string | undefined;
      const preview = text
        ? text.length > 24
          ? `"${text.slice(0, 24)}..."`
          : `"${text}"`
        : "";
      return `Type ${preview} into [${args.id ?? "?"}]`;
    }
    case ToolName.SELECT_OPTION:
      return `Select "${args.value ?? "?"}" in [${args.id ?? "?"}]`;
    case ToolName.SCROLL_PAGE:
      return `Scroll ${args.direction ?? "down"}`;
    case ToolName.READ_PAGE:
      return "Read page content";
    case ToolName.TAKE_SCREENSHOT:
      return "Take screenshot";
    case ToolName.HOVER_ELEMENT:
      return `Hover element [${args.id ?? "?"}]`;
    case ToolName.FIND_ELEMENT: {
      const text = args.text as string | undefined;
      return text ? `Find "${text.slice(0, 30)}"` : "Find element";
    }
    case ToolName.CREATE_TAB: {
      const url = args.url as string | undefined;
      if (url) {
        try {
          return `Open new tab: ${new URL(url).hostname}`;
        } catch {
          return "Open new tab";
        }
      }
      return "Open new tab";
    }
    case ToolName.CLOSE_TAB:
      return "Close tab";
    case ToolName.SWITCH_TAB:
      return `Switch to tab ${args.tabId ?? "?"}`;
    case ToolName.MEMORY_SEARCH: {
      const q = args.query as string | undefined;
      return q ? `Search memory: "${q.slice(0, 30)}"` : "Search memory";
    }
    case ToolName.MEMORY_ADD:
      return "Save to memory";
    case ToolName.WAIT: {
      const secs = args.seconds ?? "?";
      const reason = args.reason as string | undefined;
      const reasonStr = reason
        ? `: "${reason.length > 30 ? reason.slice(0, 30) + "..." : reason}"`
        : "";
      return `Wait ${secs}s${reasonStr}`;
    }
    case ToolName.PRESS_KEY: {
      const key = args.key as string | undefined;
      const mods = args.modifiers as string[] | undefined;
      const modStr = mods?.length ? mods.join("+") + "+" : "";
      return `Press ${modStr}${key ?? "?"}`;
    }
    case ToolName.DRAG_AND_DROP:
      return `Drag [${args.sourceId ?? "?"}] → [${args.targetId ?? "?"}]`;
    case ToolName.DRAW_STROKE:
      return `Draw on canvas [${args.id ?? "?"}]`;
    case ToolName.HIDE_ELEMENT:
      return `Hide element [${args.id ?? "?"}]`;
    case ToolName.DONE:
      return "Task complete";
    case ToolName.ESCALATE: {
      const reason = args.reason as string | undefined;
      return reason ? `Escalate: "${reason.slice(0, 40)}"` : "Escalate to smarter model";
    }
    case ToolName.UPDATE_PLAN: {
      const subtasks = args.subtasks as string[] | undefined;
      const idx = args.currentIndex as number | undefined;
      if (subtasks && idx !== undefined) {
        return `Plan: step ${idx + 1} of ${subtasks.length}`;
      }
      return "Update plan";
    }
    case ToolName.READ_ELEMENT: {
      const attr = args.attribute as string | undefined;
      return attr
        ? `Read "${attr}" of [${args.id ?? "?"}]`
        : `Read text of [${args.id ?? "?"}]`;
    }
    case ToolName.EXECUTE_JS: {
      const code = args.code as string | undefined;
      const preview = code
        ? code.length > 30
          ? `${code.slice(0, 30)}...`
          : code
        : "?";
      return `Execute JS: ${preview}`;
    }
    case ToolName.UPLOAD_FILE:
      return `Upload file to [${args.id ?? "?"}]`;
    case ToolName.GO_BACK:
      return "Go back";
    case ToolName.GO_FORWARD:
      return "Go forward";
    case ToolName.LIST_TABS:
      return "List tabs";
    case ToolName.RIGHT_CLICK:
      return `Right-click [${args.id ?? "?"}]`;
    case ToolName.SET_CHECKBOX:
      return `Set checkbox [${args.id ?? "?"}] = ${args.checked ?? "?"}`;
    case ToolName.DOWNLOAD_FILE: {
      const url = args.url as string | undefined;
      if (url) {
        try {
          return `Download from ${new URL(url).hostname}`;
        } catch {
          return "Download file";
        }
      }
      return "Download file";
    }
    default:
      return String(toolName);
  }
}
