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
    cacheable: "dom",
  },
  [ToolName.SCROLL_PAGE]: {
    risk: RiskLevel.LOW,
    domModifying: true,
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
  [ToolName.WAIT]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: true,
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
  [ToolName.SEARCH_HISTORY]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: false,
    cacheable: "static",
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
  [ToolName.DISMISS_OVERLAYS]: {
    risk: RiskLevel.MEDIUM,
    domModifying: true,
    sequential: false,
  },

  // Clarification (intercepted in loop)
  [ToolName.CLARIFY]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: true,
  },

  // Working notes (intercepted in loop)
  [ToolName.UPDATE_NOTES]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: true,
  },

  [ToolName.GET_PROFILE_FIELDS]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: false,
  },

  // Window management
  [ToolName.CREATE_WINDOW]: {
    risk: RiskLevel.HIGH,
    domModifying: false,
    sequential: true,
  },

  // Plan update (intercepted in loop)
  [ToolName.UPDATE_PLAN]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: true,
  },

  // Task scheduling (intercepted in loop, POSTs to backend)
  [ToolName.SCHEDULE_TASK]: {
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
export const CACHEABLE_TOOLS: Map<ToolName, "dom" | "memory" | "static"> =
  new Map(
    (Object.entries(TOOL_METADATA) as [ToolName, ToolMeta][])
      .filter(([, m]) => !!m.cacheable)
      .map(([name, m]) => [name, m.cacheable as "dom" | "memory" | "static"]),
  );

export type ToolProfile =
  | "full"
  | "read_only"
  | "form_fill"
  | "navigate"
  | "enter_code"
  | "submit_form"
  | "inspect_hidden_state"
  | "recover_from_stuck"
  | "navigation_only";

export const TOOL_PROFILES: Record<ToolProfile, ToolName[]> = {
  full: [], // empty = no filtering, use all tools as-is
  read_only: [
    // Observe
    ToolName.READ_PAGE,
    ToolName.READ_ELEMENT,
    ToolName.FIND_ELEMENT,
    ToolName.INSPECT_HIDDEN,
    ToolName.XRAY_PAGE,
    ToolName.SCROLL_PAGE,
    ToolName.LIST_TABS,
    // System (always)
    ToolName.DONE,
    ToolName.ESCALATE,
    ToolName.CLARIFY,
    ToolName.WAIT,
  ],
  form_fill: [
    // Observe
    ToolName.READ_PAGE,
    ToolName.READ_ELEMENT,
    ToolName.FIND_ELEMENT,
    ToolName.INSPECT_HIDDEN,
    ToolName.XRAY_PAGE,
    ToolName.SCROLL_PAGE,
    // Interact (form-relevant)
    ToolName.CLICK_ELEMENT,
    ToolName.TYPE_TEXT,
    ToolName.SELECT_OPTION,
    ToolName.SET_CHECKBOX,
    ToolName.PRESS_KEY,
    ToolName.HOVER_ELEMENT,
    ToolName.DISMISS_OVERLAYS,
    ToolName.CLICK_COORDINATES,
    ToolName.GET_PROFILE_FIELDS,
    // System
    ToolName.DONE,
    ToolName.ESCALATE,
    ToolName.CLARIFY,
    ToolName.WAIT,
  ],
  navigate: [
    // Observe
    ToolName.READ_PAGE,
    ToolName.READ_ELEMENT,
    ToolName.FIND_ELEMENT,
    ToolName.SCROLL_PAGE,
    // Navigate
    ToolName.NAVIGATE,
    ToolName.GO_BACK,
    ToolName.CREATE_TAB,
    ToolName.SWITCH_TAB,
    ToolName.CLOSE_TAB,
    ToolName.LIST_TABS,
    ToolName.CLICK_ELEMENT,
    // System
    ToolName.DONE,
    ToolName.ESCALATE,
    ToolName.CLARIFY,
    ToolName.WAIT,
  ],
  enter_code: [
    ToolName.READ_PAGE,
    ToolName.READ_ELEMENT,
    ToolName.FIND_ELEMENT,
    ToolName.CLICK_ELEMENT,
    ToolName.TYPE_TEXT,
    ToolName.PRESS_KEY,
    ToolName.SCROLL_PAGE,
    ToolName.DONE,
    ToolName.ESCALATE,
    ToolName.CLARIFY,
    ToolName.WAIT,
  ],
  submit_form: [
    ToolName.READ_PAGE,
    ToolName.READ_ELEMENT,
    ToolName.CLICK_ELEMENT,
    ToolName.TYPE_TEXT,
    ToolName.PRESS_KEY,
    ToolName.SCROLL_PAGE,
    ToolName.DONE,
    ToolName.ESCALATE,
    ToolName.CLARIFY,
    ToolName.WAIT,
  ],
  inspect_hidden_state: [
    ToolName.READ_PAGE,
    ToolName.READ_ELEMENT,
    ToolName.FIND_ELEMENT,
    ToolName.INSPECT_HIDDEN,
    ToolName.XRAY_PAGE,
    ToolName.EXECUTE_JS,
    ToolName.SCROLL_PAGE,
    ToolName.DONE,
    ToolName.ESCALATE,
    ToolName.CLARIFY,
    ToolName.WAIT,
  ],
  recover_from_stuck: [
    ToolName.READ_PAGE,
    ToolName.READ_ELEMENT,
    ToolName.CLICK_ELEMENT,
    ToolName.INSPECT_HIDDEN,
    ToolName.XRAY_PAGE,
    ToolName.EXECUTE_JS,
    ToolName.CLICK_COORDINATES,
    ToolName.DISMISS_OVERLAYS,
    ToolName.SCROLL_PAGE,
    ToolName.GO_BACK,
    ToolName.ESCALATE,
    ToolName.DONE,
    ToolName.CLARIFY,
    ToolName.WAIT,
  ],
  navigation_only: [
    ToolName.READ_PAGE,
    ToolName.SCROLL_PAGE,
    ToolName.CLICK_ELEMENT,
    ToolName.NAVIGATE,
    ToolName.GO_BACK,
    ToolName.CREATE_TAB,
    ToolName.SWITCH_TAB,
    ToolName.CLOSE_TAB,
    ToolName.LIST_TABS,
    ToolName.DONE,
    ToolName.ESCALATE,
    ToolName.CLARIFY,
    ToolName.WAIT,
  ],
};

/** Resolve a profile name to an allowedTools array. "full" returns null (no filtering). */
export function resolveToolProfile(
  profile: ToolProfile | undefined,
): ToolName[] | null {
  if (!profile || profile === "full") return null;
  return TOOL_PROFILES[profile] ?? null;
}

/**
 * Build a tool set based on what elements actually exist in the DOM snapshot.
 * Starts with a base set of common interaction tools, then adds extras
 * based on detected element types (draggable, file inputs, canvas, links).
 */
export function buildDomAwareProfile(
  elements: { tagName: string; attributes?: Record<string, string> }[],
): Set<ToolName> {
  // Base set — always available for any interactive page
  const tools = new Set<ToolName>([
    // Observe
    ToolName.READ_PAGE,
    ToolName.READ_ELEMENT,
    ToolName.FIND_ELEMENT,
    ToolName.SCROLL_PAGE,
    // Interact
    ToolName.CLICK_ELEMENT,
    ToolName.TYPE_TEXT,
    ToolName.PRESS_KEY,
    ToolName.SELECT_OPTION,
    ToolName.SET_CHECKBOX,
    ToolName.HOVER_ELEMENT,
    ToolName.DISMISS_OVERLAYS,
    ToolName.WAIT,
    // Navigate — always available; agent may need go_back from any page
    ToolName.NAVIGATE,
    ToolName.GO_BACK,
    ToolName.CREATE_TAB,
    ToolName.SWITCH_TAB,
    ToolName.CLOSE_TAB,
    ToolName.LIST_TABS,
    // System
    ToolName.DONE,
    ToolName.ESCALATE,
    ToolName.CLARIFY,
    ToolName.UPDATE_NOTES,
    ToolName.GET_PROFILE_FIELDS,
    // Inspection — low-risk, help recovery
    ToolName.INSPECT_HIDDEN,
    ToolName.XRAY_PAGE,
    ToolName.EXECUTE_JS,
    ToolName.RIGHT_CLICK,
    ToolName.CLICK_COORDINATES,
    ToolName.HIDE_ELEMENT,
  ]);

  let hasDraggable = false;
  let hasFileInput = false;
  let hasCanvas = false;

  for (const el of elements) {
    if (el.attributes?.draggable === "true") hasDraggable = true;
    if (el.tagName === "input" && el.attributes?.type === "file")
      hasFileInput = true;
    if (el.tagName === "canvas") hasCanvas = true;
  }

  if (hasDraggable) tools.add(ToolName.DRAG_AND_DROP);
  if (hasFileInput) tools.add(ToolName.UPLOAD_FILE);
  if (hasCanvas) tools.add(ToolName.CLICK_COORDINATES);

  return tools;
}
