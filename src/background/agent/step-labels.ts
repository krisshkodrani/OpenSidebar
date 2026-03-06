import { ToolName, TaggedElement } from "../../types";

/** Resolve an element tag ID to a short human-readable label like `"Submit" button` */
export type ElementResolver = (id: number) => string | undefined;

/** Build a resolver from a snapshot's tagged elements */
export function buildElementResolver(
  elements: TaggedElement[],
): ElementResolver {
  const map = new Map<number, TaggedElement>();
  for (const el of elements) map.set(el.tag, el);
  return (id: number) => {
    const el = map.get(id);
    if (!el) return undefined;
    const text = el.text?.slice(0, 24);
    if (text) return `"${text}" ${el.tagName}`;
    return el.tagName;
  };
}

/**
 * Maps a tool invocation to a concise, human-readable label for the step timeline.
 * When `resolve` is provided, element IDs are replaced with descriptive names.
 */
export function formatStepLabel(
  toolName: ToolName,
  args: Record<string, unknown>,
  resolve?: ElementResolver,
): string {
  /** Resolve a tag ID to a label, falling back to `[id]` */
  const el = (id: unknown): string => {
    if (id == null) return "[?]";
    const num = Number(id);
    const label = resolve && !isNaN(num) ? resolve(num) : undefined;
    return label ?? `[${id}]`;
  };

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
      return `Click ${el(args.id)}`;
    case ToolName.TYPE_TEXT: {
      const text = args.text as string | undefined;
      const preview = text
        ? text.length > 24
          ? `"${text.slice(0, 24)}..."`
          : `"${text}"`
        : "";
      return `Type ${preview} into ${el(args.id)}`;
    }
    case ToolName.SELECT_OPTION:
      return `Select "${args.value ?? "?"}" in ${el(args.id)}`;
    case ToolName.SCROLL_PAGE:
      return `Scroll ${args.direction ?? "down"}`;
    case ToolName.READ_PAGE:
      return "Read page";
    case ToolName.HOVER_ELEMENT:
      return `Hover ${el(args.id)}`;
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
      return `Drag ${el(args.sourceId)} → ${el(args.targetId)}`;
    case ToolName.HIDE_ELEMENT:
      return `Hide ${el(args.id)}`;
    case ToolName.DONE:
      return "Done";
    case ToolName.ESCALATE: {
      const reason = args.reason as string | undefined;
      return reason
        ? `Escalate: "${reason.slice(0, 40)}"`
        : "Escalate to planner model";
    }
    case ToolName.READ_ELEMENT: {
      const attr = args.attribute as string | undefined;
      return attr
        ? `Read "${attr}" of ${el(args.id)}`
        : `Read text of ${el(args.id)}`;
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
      return `Upload file to ${el(args.id)}`;
    case ToolName.GO_BACK:
      return "Go back";
    case ToolName.LIST_TABS:
      return "List tabs";
    case ToolName.RIGHT_CLICK:
      return `Right-click ${el(args.id)}`;
    case ToolName.SET_CHECKBOX:
      return `Set checkbox ${el(args.id)} = ${args.checked ?? "?"}`;
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
    case ToolName.CLICK_COORDINATES: {
      const x = args.x as number | undefined;
      const y = args.y as number | undefined;
      return `Click at (${x ?? "?"}, ${y ?? "?"})`;
    }
    case ToolName.GET_COOKIES:
      return "Get cookies";
    case ToolName.SET_COOKIE: {
      const name = args.name as string | undefined;
      return name ? `Set cookie "${name}"` : "Set cookie";
    }
    case ToolName.DELETE_COOKIE: {
      const name = args.name as string | undefined;
      return name ? `Delete cookie "${name}"` : "Delete cookie";
    }
    case ToolName.SEARCH_HISTORY: {
      const query = args.query as string | undefined;
      return query
        ? `Search history: "${query.slice(0, 30)}"`
        : "Search history";
    }
    case ToolName.INSPECT_HIDDEN: {
      const pattern = args.pattern as string | undefined;
      return pattern
        ? `Inspect hidden: "${pattern.slice(0, 30)}"`
        : "Inspect hidden elements";
    }
    case ToolName.XRAY_PAGE:
      return "Toggle X-ray mode";
    default:
      return String(toolName);
  }
}
