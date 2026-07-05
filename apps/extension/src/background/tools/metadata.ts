import { ToolName, RiskLevel } from "../../types";

export interface ToolMeta {
  risk: RiskLevel;
  domModifying: boolean;
  sequential: boolean;
  /** Cache type for tool result caching. Omit or set false for non-cacheable tools. */
  cacheable?: "dom" | "static" | false;
  /** True if repeating this tool after a restart could cause unintended duplicate side-effects. */
  mutationSensitive?: boolean;
}

export type ToolNodeConcurrencyScope =
  | "same_page"
  | "same_origin"
  | "separate_tab"
  | "never";

export type ToolNodeResourceAccess =
  | "read"
  | "write"
  | "navigate"
  | "approval"
  | "external";

export interface ToolNodeConcurrencyMeta {
  /** Broadest node-level context where this tool may coexist with sibling workers. */
  scope: ToolNodeConcurrencyScope;
  /** Resource access used by scheduler policy when deriving node locks. */
  access: ToolNodeResourceAccess;
}

const TOOL_METADATA: Record<ToolName, ToolMeta> = {
  [ToolName.CLICK_ELEMENT]: {
    risk: RiskLevel.MEDIUM,
    domModifying: true,
    sequential: false,
    mutationSensitive: true,
  },
  [ToolName.TYPE_TEXT]: {
    risk: RiskLevel.MEDIUM,
    domModifying: true,
    sequential: false,
    mutationSensitive: true,
  },
  [ToolName.SELECT_OPTION]: {
    risk: RiskLevel.MEDIUM,
    domModifying: true,
    sequential: false,
    mutationSensitive: true,
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
    mutationSensitive: true,
  },
  [ToolName.OPEN_SERVICENOW_MODULE]: {
    risk: RiskLevel.HIGH,
    domModifying: false,
    sequential: true,
    mutationSensitive: true,
  },
  [ToolName.SEARCH_KNOWLEDGE_BASE]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: false,
    cacheable: false,
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
    mutationSensitive: true,
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
    mutationSensitive: true,
  },
  [ToolName.CLOSE_TAB]: {
    risk: RiskLevel.HIGH,
    domModifying: false,
    sequential: true,
    mutationSensitive: true,
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
    mutationSensitive: true,
  },
  [ToolName.UPLOAD_FILE]: {
    risk: RiskLevel.MEDIUM,
    domModifying: true,
    sequential: true,
    mutationSensitive: true,
  },
  [ToolName.GO_BACK]: {
    risk: RiskLevel.HIGH,
    domModifying: false,
    sequential: true,
    mutationSensitive: true,
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
    mutationSensitive: true,
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
    risk: RiskLevel.HIGH,
    domModifying: false,
    sequential: false,
    cacheable: "static",
  },
  [ToolName.SET_COOKIE]: {
    risk: RiskLevel.HIGH,
    domModifying: false,
    sequential: false,
    mutationSensitive: true,
  },
  [ToolName.DELETE_COOKIE]: {
    risk: RiskLevel.HIGH,
    domModifying: false,
    sequential: false,
    mutationSensitive: true,
  },
  [ToolName.SEARCH_HISTORY]: {
    risk: RiskLevel.HIGH,
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
  [ToolName.INSPECT_CHART]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: false,
    cacheable: "dom",
  },
  [ToolName.INSPECT_TABLE]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: false,
    cacheable: "dom",
  },
  [ToolName.INSPECT_FILTER_STATE]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: false,
    cacheable: "dom",
  },
  [ToolName.APPLY_LIST_FILTER]: {
    risk: RiskLevel.MEDIUM,
    domModifying: true,
    sequential: true,
    mutationSensitive: true,
  },
  [ToolName.APPLY_LIST_SORT]: {
    risk: RiskLevel.MEDIUM,
    domModifying: true,
    sequential: true,
    mutationSensitive: true,
  },
  [ToolName.APPLY_LIST_ACTION]: {
    risk: RiskLevel.HIGH,
    domModifying: true,
    sequential: true,
    mutationSensitive: true,
  },
  [ToolName.INSPECT_CATALOG_ITEM]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: false,
    cacheable: "dom",
  },
  [ToolName.CONFIGURE_CATALOG_ITEM]: {
    risk: RiskLevel.MEDIUM,
    domModifying: true,
    sequential: true,
    mutationSensitive: true,
  },
  [ToolName.CONFIGURE_SERVICENOW_FORM]: {
    risk: RiskLevel.MEDIUM,
    domModifying: true,
    sequential: true,
    mutationSensitive: true,
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
    mutationSensitive: true,
  },

  // Plan update (intercepted in loop)
  [ToolName.UPDATE_PLAN]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: true,
  },

  // Writer handoff (intercepted in loop; composes prose then types it into a field)
  [ToolName.COMPOSE_TEXT]: {
    risk: RiskLevel.MEDIUM,
    domModifying: true,
    sequential: true,
    mutationSensitive: true,
  },

};

const TOOL_NODE_CONCURRENCY: Record<ToolName, ToolNodeConcurrencyMeta> = {
  [ToolName.CLICK_ELEMENT]: { scope: "separate_tab", access: "write" },
  [ToolName.TYPE_TEXT]: { scope: "separate_tab", access: "write" },
  [ToolName.SELECT_OPTION]: { scope: "separate_tab", access: "write" },
  [ToolName.HOVER_ELEMENT]: { scope: "same_page", access: "read" },
  [ToolName.DRAG_AND_DROP]: { scope: "separate_tab", access: "write" },
  [ToolName.HIDE_ELEMENT]: { scope: "separate_tab", access: "write" },
  [ToolName.NAVIGATE]: { scope: "separate_tab", access: "navigate" },
  [ToolName.OPEN_SERVICENOW_MODULE]: {
    scope: "separate_tab",
    access: "navigate",
  },
  [ToolName.SEARCH_KNOWLEDGE_BASE]: { scope: "same_origin", access: "read" },
  [ToolName.DONE]: { scope: "same_page", access: "read" },
  [ToolName.READ_PAGE]: { scope: "same_page", access: "read" },
  [ToolName.SCROLL_PAGE]: { scope: "separate_tab", access: "read" },
  [ToolName.FIND_ELEMENT]: { scope: "same_page", access: "read" },
  [ToolName.PRESS_KEY]: { scope: "separate_tab", access: "write" },
  [ToolName.WAIT]: { scope: "same_page", access: "read" },
  [ToolName.CREATE_TAB]: { scope: "separate_tab", access: "navigate" },
  [ToolName.CLOSE_TAB]: { scope: "separate_tab", access: "navigate" },
  [ToolName.SWITCH_TAB]: { scope: "separate_tab", access: "navigate" },
  [ToolName.ESCALATE]: { scope: "never", access: "approval" },
  [ToolName.READ_ELEMENT]: { scope: "same_page", access: "read" },
  [ToolName.EXECUTE_JS]: { scope: "never", access: "write" },
  [ToolName.UPLOAD_FILE]: { scope: "never", access: "write" },
  [ToolName.GO_BACK]: { scope: "separate_tab", access: "navigate" },
  [ToolName.LIST_TABS]: { scope: "same_page", access: "read" },
  [ToolName.RIGHT_CLICK]: { scope: "separate_tab", access: "write" },
  [ToolName.SET_CHECKBOX]: { scope: "separate_tab", access: "write" },
  [ToolName.CLICK_COORDINATES]: { scope: "separate_tab", access: "write" },
  [ToolName.DOWNLOAD_FILE]: { scope: "separate_tab", access: "read" },
  [ToolName.GET_COOKIES]: { scope: "same_origin", access: "read" },
  [ToolName.SET_COOKIE]: { scope: "same_origin", access: "write" },
  [ToolName.DELETE_COOKIE]: { scope: "same_origin", access: "write" },
  [ToolName.SEARCH_HISTORY]: { scope: "same_page", access: "read" },
  [ToolName.INSPECT_HIDDEN]: { scope: "same_page", access: "read" },
  [ToolName.INSPECT_CHART]: { scope: "same_page", access: "read" },
  [ToolName.INSPECT_TABLE]: { scope: "same_page", access: "read" },
  [ToolName.INSPECT_FILTER_STATE]: { scope: "same_page", access: "read" },
  [ToolName.APPLY_LIST_FILTER]: { scope: "separate_tab", access: "write" },
  [ToolName.APPLY_LIST_SORT]: { scope: "separate_tab", access: "write" },
  [ToolName.APPLY_LIST_ACTION]: { scope: "separate_tab", access: "write" },
  [ToolName.INSPECT_CATALOG_ITEM]: { scope: "same_page", access: "read" },
  [ToolName.CONFIGURE_CATALOG_ITEM]: { scope: "separate_tab", access: "write" },
  [ToolName.CONFIGURE_SERVICENOW_FORM]: {
    scope: "separate_tab",
    access: "write",
  },
  [ToolName.XRAY_PAGE]: { scope: "separate_tab", access: "read" },
  [ToolName.DISMISS_OVERLAYS]: { scope: "separate_tab", access: "write" },
  [ToolName.CLARIFY]: { scope: "never", access: "approval" },
  [ToolName.UPDATE_NOTES]: { scope: "never", access: "external" },
  [ToolName.GET_PROFILE_FIELDS]: { scope: "same_page", access: "read" },
  [ToolName.CREATE_WINDOW]: { scope: "never", access: "navigate" },
  [ToolName.UPDATE_PLAN]: { scope: "never", access: "external" },
  [ToolName.COMPOSE_TEXT]: { scope: "separate_tab", access: "write" },
};

export function getToolMeta(name: ToolName): ToolMeta {
  return TOOL_METADATA[name];
}

export function getToolNodeConcurrencyMeta(
  name: ToolName,
): ToolNodeConcurrencyMeta {
  return TOOL_NODE_CONCURRENCY[name];
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
export const CACHEABLE_TOOLS: Map<ToolName, "dom" | "static"> =
  new Map(
    (Object.entries(TOOL_METADATA) as [ToolName, ToolMeta][])
      .filter(([, m]) => !!m.cacheable)
      .map(([name, m]) => [name, m.cacheable as "dom" | "static"]),
  );

/** Tools whose side-effects are unsafe to repeat after a service worker restart. */
export const MUTATION_SENSITIVE_TOOLS: Set<ToolName> = new Set(
  (Object.entries(TOOL_METADATA) as [ToolName, ToolMeta][])
    .filter(([, m]) => !!m.mutationSensitive)
    .map(([name]) => name),
);

export type ToolProfile =
  | "full"
  | "read_only"
  | "form_fill"
  | "edit_surface"
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
    ToolName.SEARCH_KNOWLEDGE_BASE,
    ToolName.READ_ELEMENT,
    ToolName.FIND_ELEMENT,
    ToolName.INSPECT_HIDDEN,
    ToolName.INSPECT_CHART,
    ToolName.INSPECT_TABLE,
    ToolName.INSPECT_FILTER_STATE,
    ToolName.INSPECT_CATALOG_ITEM,
    ToolName.XRAY_PAGE,
    ToolName.SCROLL_PAGE,
    ToolName.LIST_TABS,
    ToolName.GET_PROFILE_FIELDS,
    // System (always)
    ToolName.DONE,
    ToolName.ESCALATE,
    ToolName.CLARIFY,
    ToolName.WAIT,
  ],
  form_fill: [
    // Observe
    ToolName.READ_PAGE,
    ToolName.SEARCH_KNOWLEDGE_BASE,
    ToolName.READ_ELEMENT,
    ToolName.FIND_ELEMENT,
    ToolName.INSPECT_HIDDEN,
    ToolName.INSPECT_TABLE,
    ToolName.INSPECT_FILTER_STATE,
    ToolName.APPLY_LIST_FILTER,
    ToolName.APPLY_LIST_SORT,
    ToolName.APPLY_LIST_ACTION,
    ToolName.INSPECT_CATALOG_ITEM,
    ToolName.CONFIGURE_SERVICENOW_FORM,
    ToolName.XRAY_PAGE,
    ToolName.SCROLL_PAGE,
    // Interact (form-relevant)
    ToolName.CLICK_ELEMENT,
    ToolName.TYPE_TEXT,
    ToolName.COMPOSE_TEXT,
    ToolName.SELECT_OPTION,
    ToolName.SET_CHECKBOX,
    ToolName.UPLOAD_FILE,
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
  edit_surface: [
    ToolName.READ_PAGE,
    ToolName.READ_ELEMENT,
    ToolName.FIND_ELEMENT,
    ToolName.SCROLL_PAGE,
    ToolName.CLICK_ELEMENT,
    ToolName.RIGHT_CLICK,
    ToolName.TYPE_TEXT,
    ToolName.PRESS_KEY,
    ToolName.DONE,
    ToolName.ESCALATE,
    ToolName.CLARIFY,
    ToolName.WAIT,
  ],
  navigate: [
    // Observe
    ToolName.READ_PAGE,
    ToolName.SEARCH_KNOWLEDGE_BASE,
    ToolName.READ_ELEMENT,
    ToolName.FIND_ELEMENT,
    ToolName.SCROLL_PAGE,
    // Navigate
    ToolName.OPEN_SERVICENOW_MODULE,
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
    ToolName.CONFIGURE_SERVICENOW_FORM,
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
    ToolName.UPLOAD_FILE,
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
    ToolName.INSPECT_CHART,
    ToolName.INSPECT_TABLE,
    ToolName.INSPECT_FILTER_STATE,
    ToolName.APPLY_LIST_ACTION,
    ToolName.INSPECT_CATALOG_ITEM,
    ToolName.CONFIGURE_SERVICENOW_FORM,
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
    ToolName.INSPECT_CHART,
    ToolName.INSPECT_TABLE,
    ToolName.INSPECT_FILTER_STATE,
    ToolName.INSPECT_CATALOG_ITEM,
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
    ToolName.OPEN_SERVICENOW_MODULE,
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

const PROFILE_CONTROL_TOOLS = new Set<ToolName>([
  ToolName.DONE,
  ToolName.ESCALATE,
  ToolName.CLARIFY,
  ToolName.WAIT,
  ToolName.UPDATE_NOTES,
  ToolName.UPDATE_PLAN,
]);

const TOOL_NODE_ACCESS_PRIORITY: Record<ToolNodeResourceAccess, number> = {
  read: 0,
  navigate: 1,
  write: 2,
  external: 3,
  approval: 4,
};

const TOOL_NODE_SCOPE_PRIORITY: Record<ToolNodeConcurrencyScope, number> = {
  same_page: 0,
  same_origin: 1,
  separate_tab: 2,
  never: 3,
};

export function summarizeToolNodeConcurrency(
  tools: Iterable<ToolName>,
  options: { ignoreControlTools?: boolean } = {},
): ToolNodeConcurrencyMeta {
  let summary: ToolNodeConcurrencyMeta = {
    scope: "same_page",
    access: "read",
  };

  for (const tool of tools) {
    if (options.ignoreControlTools && PROFILE_CONTROL_TOOLS.has(tool)) {
      continue;
    }
    const meta = getToolNodeConcurrencyMeta(tool);
    if (
      TOOL_NODE_SCOPE_PRIORITY[meta.scope] >
      TOOL_NODE_SCOPE_PRIORITY[summary.scope]
    ) {
      summary = { ...summary, scope: meta.scope };
    }
    if (
      TOOL_NODE_ACCESS_PRIORITY[meta.access] >
      TOOL_NODE_ACCESS_PRIORITY[summary.access]
    ) {
      summary = { ...summary, access: meta.access };
    }
  }

  return summary;
}

export function getToolProfileNodeConcurrency(
  profile: ToolProfile | undefined,
): ToolNodeConcurrencyMeta | null {
  if (!profile) return null;
  if (profile === "full") {
    return { scope: "never", access: "write" };
  }
  const tools = TOOL_PROFILES[profile];
  if (!tools) return null;
  const summary = summarizeToolNodeConcurrency(tools, {
    ignoreControlTools: true,
  });
  if (profile === "navigate" || profile === "navigation_only") {
    return { ...summary, access: "navigate" };
  }
  return summary;
}

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
    ToolName.SEARCH_KNOWLEDGE_BASE,
    ToolName.READ_ELEMENT,
    ToolName.FIND_ELEMENT,
    ToolName.SCROLL_PAGE,
    // Interact
    ToolName.CLICK_ELEMENT,
    ToolName.TYPE_TEXT,
    ToolName.COMPOSE_TEXT,
    ToolName.PRESS_KEY,
    ToolName.SELECT_OPTION,
    ToolName.SET_CHECKBOX,
    ToolName.HOVER_ELEMENT,
    ToolName.DISMISS_OVERLAYS,
    ToolName.WAIT,
    // Navigate — always available; agent may need go_back from any page
    ToolName.NAVIGATE,
    ToolName.OPEN_SERVICENOW_MODULE,
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
    ToolName.CONFIGURE_SERVICENOW_FORM,
    // Inspection — low-risk, help recovery
    ToolName.INSPECT_HIDDEN,
    ToolName.INSPECT_CHART,
    ToolName.INSPECT_TABLE,
    ToolName.INSPECT_FILTER_STATE,
    ToolName.INSPECT_CATALOG_ITEM,
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
