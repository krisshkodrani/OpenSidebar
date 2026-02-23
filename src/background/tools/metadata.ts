import { ToolName, RiskLevel } from "../../types";

export interface ToolMeta {
  risk: RiskLevel;
  domModifying: boolean;
  sequential: boolean;
  /** Cache type for tool result caching. Omit or set false for non-cacheable tools. */
  cacheable?: "dom" | "memory" | "static" | false;
}

const TOOL_METADATA: Record<ToolName, ToolMeta> = {
  [ToolName.CLICK_ELEMENT]: {
    risk: RiskLevel.MEDIUM,
    domModifying: true,
    sequential: false,
  },
  [ToolName.TYPE_TEXT]: {
    risk: RiskLevel.MEDIUM,
    domModifying: true,
    sequential: false,
  },
  [ToolName.SELECT_OPTION]: {
    risk: RiskLevel.MEDIUM,
    domModifying: true,
    sequential: false,
  },
  [ToolName.HOVER_ELEMENT]: {
    risk: RiskLevel.LOW,
    domModifying: true,
    sequential: false,
  },
  [ToolName.DRAG_AND_DROP]: {
    risk: RiskLevel.MEDIUM,
    domModifying: true,
    sequential: false,
  },
  [ToolName.HIDE_ELEMENT]: {
    risk: RiskLevel.MEDIUM,
    domModifying: true,
    sequential: false,
  },
  [ToolName.NAVIGATE]: {
    risk: RiskLevel.HIGH,
    domModifying: false,
    sequential: true,
  },
  [ToolName.DONE]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: true,
  },
  [ToolName.READ_PAGE]: {
    risk: RiskLevel.LOW,
    domModifying: true,
    sequential: false,
  },
  [ToolName.SCROLL_PAGE]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: false,
  },
  [ToolName.FIND_ELEMENT]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: false,
    cacheable: "dom",
  },
  [ToolName.PRESS_KEY]: {
    risk: RiskLevel.MEDIUM,
    domModifying: false,
    sequential: false,
  },
  [ToolName.DRAW_STROKE]: {
    risk: RiskLevel.MEDIUM,
    domModifying: false,
    sequential: false,
  },
  [ToolName.WAIT]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: true,
  },
  [ToolName.MEMORY_ADD]: {
    risk: RiskLevel.MEDIUM,
    domModifying: false,
    sequential: false,
  },
  [ToolName.MEMORY_SEARCH]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: false,
    cacheable: "memory",
  },
  [ToolName.MEMORY_UPDATE]: {
    risk: RiskLevel.MEDIUM,
    domModifying: false,
    sequential: false,
  },
  [ToolName.MEMORY_DELETE]: {
    risk: RiskLevel.MEDIUM,
    domModifying: false,
    sequential: false,
  },
  [ToolName.MEMORY_LIST_CATEGORIES]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: false,
    cacheable: "memory",
  },
  [ToolName.CREATE_TAB]: {
    risk: RiskLevel.HIGH,
    domModifying: false,
    sequential: true,
  },
  [ToolName.CLOSE_TAB]: {
    risk: RiskLevel.HIGH,
    domModifying: false,
    sequential: true,
  },
  [ToolName.SWITCH_TAB]: {
    risk: RiskLevel.MEDIUM,
    domModifying: false,
    sequential: true,
  },
  [ToolName.ESCALATE]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: true,
  },
  [ToolName.READ_ELEMENT]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: false,
    cacheable: "dom",
  },
  [ToolName.EXECUTE_JS]: {
    risk: RiskLevel.HIGH,
    domModifying: true,
    sequential: true,
  },
  [ToolName.UPLOAD_FILE]: {
    risk: RiskLevel.MEDIUM,
    domModifying: true,
    sequential: true,
  },
  [ToolName.GO_BACK]: {
    risk: RiskLevel.HIGH,
    domModifying: false,
    sequential: true,
  },
  [ToolName.GO_FORWARD]: {
    risk: RiskLevel.HIGH,
    domModifying: false,
    sequential: true,
  },
  [ToolName.LIST_TABS]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: true,
    cacheable: "static",
  },
  [ToolName.RIGHT_CLICK]: {
    risk: RiskLevel.MEDIUM,
    domModifying: true,
    sequential: false,
  },
  [ToolName.SET_CHECKBOX]: {
    risk: RiskLevel.MEDIUM,
    domModifying: true,
    sequential: false,
  },
  [ToolName.CLICK_COORDINATES]: {
    risk: RiskLevel.MEDIUM,
    domModifying: true,
    sequential: false,
  },
  [ToolName.DOWNLOAD_FILE]: {
    risk: RiskLevel.MEDIUM,
    domModifying: false,
    sequential: false,
  },
  [ToolName.TRANSCRIBE_AUDIO]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: true,
  },
  [ToolName.GROUP_TABS]: {
    risk: RiskLevel.MEDIUM,
    domModifying: false,
    sequential: true,
  },
  [ToolName.UNGROUP_TABS]: {
    risk: RiskLevel.MEDIUM,
    domModifying: false,
    sequential: true,
  },
  [ToolName.GET_COOKIES]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: false,
    cacheable: "static",
  },
  [ToolName.SET_COOKIE]: {
    risk: RiskLevel.HIGH,
    domModifying: false,
    sequential: false,
  },
  [ToolName.DELETE_COOKIE]: {
    risk: RiskLevel.HIGH,
    domModifying: false,
    sequential: false,
  },
  [ToolName.COPY_TO_CLIPBOARD]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: false,
  },
  [ToolName.READ_PDF]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: true,
  },
  [ToolName.SEARCH_HISTORY]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: false,
    cacheable: "static",
  },
  [ToolName.CREATE_BOOKMARK]: {
    risk: RiskLevel.MEDIUM,
    domModifying: false,
    sequential: false,
  },
  [ToolName.GET_BOOKMARKS]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: false,
    cacheable: "static",
  },
  [ToolName.CREATE_WINDOW]: {
    risk: RiskLevel.HIGH,
    domModifying: false,
    sequential: true,
  },
  [ToolName.SEND_NOTIFICATION]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: false,
  },
  [ToolName.INSPECT_HIDDEN]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: false,
    cacheable: "dom",
  },
  [ToolName.XRAY_PAGE]: {
    risk: RiskLevel.LOW,
    domModifying: true,
    sequential: false,
  },
  [ToolName.FAST_FORWARD]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: false,
  },
  [ToolName.DISMISS_OVERLAYS]: {
    risk: RiskLevel.MEDIUM,
    domModifying: true,
    sequential: false,
  },
  [ToolName.CLOSE_POPUPS]: {
    risk: RiskLevel.MEDIUM,
    domModifying: true,
    sequential: false,
  },
  [ToolName.BATCH_EXECUTE]: {
    risk: RiskLevel.MEDIUM,
    domModifying: true,
    sequential: true,
  },

  // Demo recall
  [ToolName.RECALL_DEMO]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: false,
    cacheable: "memory",
  },

  // React toolkit (on-demand)
  [ToolName.INSPECT_REACT]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: false,
    cacheable: "dom",
  },
  [ToolName.REACT_SET_INPUT]: {
    risk: RiskLevel.MEDIUM,
    domModifying: true,
    sequential: false,
  },
  [ToolName.INSPECT_REACT_TREE]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: false,
    cacheable: "dom",
  },
  [ToolName.WAIT_FOR_REACT]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: true,
  },
};

export function getToolMeta(name: ToolName): ToolMeta {
  return TOOL_METADATA[name];
}

// Pre-computed sets for fast lookup
export const DOM_MODIFYING_TOOLS: Set<ToolName> = new Set(
  (Object.entries(TOOL_METADATA) as [ToolName, ToolMeta][])
    .filter(([, m]) => m.domModifying)
    .map(([name]) => name),
);

export const SEQUENTIAL_TOOLS: Set<ToolName> = new Set(
  (Object.entries(TOOL_METADATA) as [ToolName, ToolMeta][])
    .filter(([, m]) => m.sequential)
    .map(([name]) => name),
);

/** Pre-computed map: cacheable tool name → cache type. Only tools with a truthy `cacheable` value. */
export const CACHEABLE_TOOLS: Map<ToolName, "dom" | "memory" | "static"> = new Map(
  (Object.entries(TOOL_METADATA) as [ToolName, ToolMeta][])
    .filter(([, m]) => !!m.cacheable)
    .map(([name, m]) => [name, m.cacheable as "dom" | "memory" | "static"]),
);

export type ToolProfile = "full" | "read_only" | "form_fill" | "navigate";

export const TOOL_PROFILES: Record<ToolProfile, ToolName[]> = {
  full: [], // empty = no filtering, use all tools as-is
  read_only: [
    // Observe
    ToolName.READ_PAGE, ToolName.READ_ELEMENT, ToolName.FIND_ELEMENT,
    ToolName.INSPECT_HIDDEN, ToolName.XRAY_PAGE, ToolName.SCROLL_PAGE,
    ToolName.FAST_FORWARD, ToolName.LIST_TABS,
    // Memory
    ToolName.MEMORY_SEARCH, ToolName.MEMORY_LIST_CATEGORIES,
    ToolName.MEMORY_ADD, ToolName.MEMORY_UPDATE,
    // System (always)
    ToolName.DONE, ToolName.ESCALATE, ToolName.WAIT,
  ],
  form_fill: [
    // Observe
    ToolName.READ_PAGE, ToolName.READ_ELEMENT, ToolName.FIND_ELEMENT,
    ToolName.INSPECT_HIDDEN, ToolName.XRAY_PAGE, ToolName.SCROLL_PAGE,
    ToolName.FAST_FORWARD,
    // Interact (form-relevant)
    ToolName.CLICK_ELEMENT, ToolName.TYPE_TEXT, ToolName.SELECT_OPTION,
    ToolName.SET_CHECKBOX, ToolName.PRESS_KEY, ToolName.HOVER_ELEMENT,
    ToolName.DISMISS_OVERLAYS, ToolName.CLOSE_POPUPS, ToolName.CLICK_COORDINATES,
    // Memory
    ToolName.MEMORY_SEARCH, ToolName.MEMORY_ADD,
    // System
    ToolName.DONE, ToolName.ESCALATE, ToolName.WAIT,
  ],
  navigate: [
    // Observe
    ToolName.READ_PAGE, ToolName.READ_ELEMENT, ToolName.FIND_ELEMENT,
    ToolName.SCROLL_PAGE, ToolName.FAST_FORWARD,
    // Navigate
    ToolName.NAVIGATE, ToolName.GO_BACK, ToolName.GO_FORWARD,
    ToolName.CREATE_TAB, ToolName.SWITCH_TAB, ToolName.CLOSE_TAB,
    ToolName.LIST_TABS, ToolName.CLICK_ELEMENT,
    // System
    ToolName.DONE, ToolName.ESCALATE, ToolName.WAIT,
  ],
};

/** Resolve a profile name to an allowedTools array. "full" returns null (no filtering). */
export function resolveToolProfile(profile: ToolProfile | undefined): ToolName[] | null {
  if (!profile || profile === "full") return null;
  return TOOL_PROFILES[profile] ?? null;
}
