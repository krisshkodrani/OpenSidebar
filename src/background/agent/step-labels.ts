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
    case ToolName.ACTIVATE_SWARM:
      return "Deep research (Kimi Swarm)";
    case ToolName.MEMORY_SEARCH: {
      const q = args.query as string | undefined;
      return q ? `Search memory: "${q.slice(0, 30)}"` : "Search memory";
    }
    case ToolName.MEMORY_ADD:
      return "Save to memory";
    case ToolName.WAIT:
      return `Wait ${args.ms ?? "?"}ms`;
    case ToolName.DONE:
      return "Task complete";
    default:
      return String(toolName);
  }
}
