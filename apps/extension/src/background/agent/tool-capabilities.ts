import { ToolName, type ToolDefinition } from "../../types";
import type { LLMMessage } from "../llm/types";

export const TOOL_CAPABILITY_VALUES = [
  "read_page_state",
  "find_elements",
  "inspect_hidden_structure",
  "interact_with_page",
  "click_elements",
  "fill_text_fields",
  "set_binary_controls",
  "select_options",
  "submit_forms",
  "navigate_pages",
  "manage_tabs",
  "execute_javascript",
  "handle_overlays",
  "upload_files",
  "drag_and_drop",
  "update_notes",
  "use_profile_data",
  "service_now_forms",
  "list_and_table_workflows",
] as const;

export type ToolCapability = (typeof TOOL_CAPABILITY_VALUES)[number];

const TOOL_CAPABILITIES: Partial<Record<ToolName, ToolCapability[]>> = {
  [ToolName.READ_PAGE]: ["read_page_state", "find_elements"],
  [ToolName.READ_ELEMENT]: ["read_page_state", "find_elements"],
  [ToolName.FIND_ELEMENT]: ["find_elements"],
  [ToolName.INSPECT_HIDDEN]: ["inspect_hidden_structure", "find_elements"],
  [ToolName.XRAY_PAGE]: ["inspect_hidden_structure", "find_elements"],
  [ToolName.INSPECT_CHART]: ["read_page_state"],
  [ToolName.INSPECT_REGION]: ["read_page_state"],
  [ToolName.INSPECT_TABLE]: ["read_page_state", "list_and_table_workflows"],
  [ToolName.INSPECT_FILTER_STATE]: [
    "read_page_state",
    "list_and_table_workflows",
  ],
  [ToolName.INSPECT_CATALOG_ITEM]: ["read_page_state"],

  [ToolName.CLICK_ELEMENT]: [
    "interact_with_page",
    "click_elements",
    "submit_forms",
  ],
  [ToolName.CLICK_COORDINATES]: ["interact_with_page", "click_elements"],
  [ToolName.TYPE_TEXT]: ["interact_with_page", "fill_text_fields"],
  [ToolName.PRESS_KEY]: [
    "interact_with_page",
    "fill_text_fields",
    "submit_forms",
  ],
  [ToolName.SET_CHECKBOX]: ["interact_with_page", "set_binary_controls"],
  [ToolName.SELECT_OPTION]: ["interact_with_page", "select_options"],
  [ToolName.HOVER_ELEMENT]: ["interact_with_page"],
  [ToolName.RIGHT_CLICK]: ["interact_with_page"],
  [ToolName.DISMISS_OVERLAYS]: ["handle_overlays", "interact_with_page"],
  [ToolName.HIDE_ELEMENT]: ["handle_overlays"],
  [ToolName.DRAG_AND_DROP]: ["drag_and_drop", "interact_with_page"],
  [ToolName.UPLOAD_FILE]: ["upload_files", "interact_with_page"],

  [ToolName.NAVIGATE]: ["navigate_pages"],
  [ToolName.OPEN_SERVICENOW_MODULE]: ["navigate_pages", "service_now_forms"],
  [ToolName.GO_BACK]: ["navigate_pages"],
  [ToolName.CREATE_TAB]: ["manage_tabs", "navigate_pages"],
  [ToolName.SWITCH_TAB]: ["manage_tabs"],
  [ToolName.CLOSE_TAB]: ["manage_tabs"],
  [ToolName.LIST_TABS]: ["manage_tabs"],
  [ToolName.CREATE_WINDOW]: ["manage_tabs"],

  [ToolName.EXECUTE_JS]: ["execute_javascript", "inspect_hidden_structure"],
  [ToolName.UPDATE_NOTES]: ["update_notes"],
  [ToolName.GET_PROFILE_FIELDS]: ["use_profile_data"],

  [ToolName.CONFIGURE_SERVICENOW_FORM]: [
    "service_now_forms",
    "fill_text_fields",
    "select_options",
    "set_binary_controls",
    "submit_forms",
  ],
  [ToolName.CONFIGURE_CATALOG_ITEM]: [
    "service_now_forms",
    "fill_text_fields",
    "submit_forms",
  ],
  [ToolName.APPLY_LIST_FILTER]: ["list_and_table_workflows"],
  [ToolName.APPLY_LIST_SORT]: ["list_and_table_workflows"],
  [ToolName.APPLY_LIST_ACTION]: [
    "list_and_table_workflows",
    "interact_with_page",
  ],
};

const TOOL_NAME_VALUES = new Set<string>(Object.values(ToolName));
const CAPABILITY_VALUES = new Set<string>(TOOL_CAPABILITY_VALUES);

const MISSING_TOOL_CLAIM =
  /\b(?:missing|not available|unavailable|do(?:es)? not have|don't have|cannot use|can't use|without|need a|need an|no)\b[\s\S]{0,120}\b(?:tool|capability|function|api|action)\b/i;

const CAPABILITY_PHRASES: Array<{
  pattern: RegExp;
  capability: ToolCapability;
}> = [
  {
    pattern: /\b(?:read|see|observe|inspect)\s+(?:the\s+)?page\b/i,
    capability: "read_page_state",
  },
  {
    pattern:
      /\b(?:find|locate|identify)\s+(?:the\s+)?(?:element|field|button|input)\b/i,
    capability: "find_elements",
  },
  {
    pattern: /\b(?:hidden|dom|x-ray|xray|structure)\b/i,
    capability: "inspect_hidden_structure",
  },
  {
    pattern: /\b(?:interact|interaction|act on|operate)\b/i,
    capability: "interact_with_page",
  },
  {
    pattern:
      /\b(?:click|press)\s+(?:the\s+)?(?:button|control|element|link)\b/i,
    capability: "click_elements",
  },
  {
    pattern:
      /\b(?:type|fill|enter|input)\s+(?:text|value|email|password|field|code)\b/i,
    capability: "fill_text_fields",
  },
  {
    pattern: /\b(?:checkbox|check box|toggle|radio|remember me)\b/i,
    capability: "set_binary_controls",
  },
  {
    pattern: /\b(?:select|dropdown|option|combobox)\b/i,
    capability: "select_options",
  },
  {
    pattern: /\b(?:submit|log in|login|sign in|send form|finish form)\b/i,
    capability: "submit_forms",
  },
  {
    pattern: /\b(?:navigate|go back|open url|visit page)\b/i,
    capability: "navigate_pages",
  },
  {
    pattern: /\b(?:tab|window)\b/i,
    capability: "manage_tabs",
  },
  {
    pattern: /\b(?:javascript|execute js|execute_js|script)\b/i,
    capability: "execute_javascript",
  },
  {
    pattern: /\b(?:overlay|modal|popup|banner)\b/i,
    capability: "handle_overlays",
  },
];

export type EscalationCapabilityAssessment =
  | {
      decision: "allow";
      reason: "not_missing_tool_claim" | "capability_unavailable";
      requiredCapability?: ToolCapability;
      matchedToolNames: ToolName[];
    }
  | {
      decision: "reject";
      reason: "capability_available";
      requiredCapability?: ToolCapability;
      matchedToolNames: ToolName[];
      correction: string;
    };

function normalizeToolName(value: string): ToolName | null {
  if (TOOL_NAME_VALUES.has(value)) return value as ToolName;
  return null;
}

function normalizeCapability(value: unknown): ToolCapability | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return CAPABILITY_VALUES.has(normalized)
    ? (normalized as ToolCapability)
    : undefined;
}

function extractNamedTools(text: string): ToolName[] {
  const lower = text.toLowerCase();
  const matches = new Set<ToolName>();
  for (const toolName of Object.values(ToolName)) {
    if (
      lower.includes(toolName) ||
      lower.includes(toolName.replace(/_/g, " "))
    ) {
      matches.add(toolName);
    }
  }
  return [...matches];
}

function inferMissingCapability(text: string): ToolCapability | undefined {
  for (const item of CAPABILITY_PHRASES) {
    if (item.pattern.test(text)) return item.capability;
  }
  return undefined;
}

export function getToolCapabilities(
  toolNames: Iterable<ToolName | string>,
): Set<ToolCapability> {
  const capabilities = new Set<ToolCapability>();
  for (const name of toolNames) {
    const toolName =
      typeof name === "string" ? normalizeToolName(name) : (name as ToolName);
    if (!toolName) continue;
    for (const capability of TOOL_CAPABILITIES[toolName] ?? []) {
      capabilities.add(capability);
    }
  }
  return capabilities;
}

export function getCapabilityTools(
  toolNames: Iterable<ToolName | string>,
): Map<ToolCapability, ToolName[]> {
  const result = new Map<ToolCapability, ToolName[]>();
  for (const name of toolNames) {
    const toolName =
      typeof name === "string" ? normalizeToolName(name) : (name as ToolName);
    if (!toolName) continue;
    for (const capability of TOOL_CAPABILITIES[toolName] ?? []) {
      const tools = result.get(capability) ?? [];
      tools.push(toolName);
      result.set(capability, tools);
    }
  }
  return result;
}

export function buildToolCapabilityCatalog(
  toolsOrNames: Iterable<ToolDefinition | ToolName | string>,
): string {
  const toolNames = [...toolsOrNames]
    .map((item) => {
      if (typeof item === "string") return normalizeToolName(item);
      if ("function" in item) return item.function.name;
      return item;
    })
    .filter((name): name is ToolName => Boolean(name));
  const capabilityTools = getCapabilityTools(toolNames);
  const lines = [...capabilityTools.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([capability, names]) => {
      const uniqueNames = [...new Set(names)].sort();
      return `- ${capability}: ${uniqueNames.join(", ")}`;
    });

  return [
    "## Available Tool Capabilities",
    "The function tools available on this turn provide these capabilities. Before calling escalate() for a missing tool, compare the requested action against this catalog and use the matching tool directly.",
    ...lines,
    "",
    'If escalation is truly about an absent capability, call escalate() with reasonCode="missing_tool" and requiredCapability set to the absent capability. Otherwise use reasonCode="stuck", "complex_reasoning", "blocked", or "other".',
  ].join("\n");
}

export function withToolCapabilityCatalog(
  messages: LLMMessage[],
  tools: ToolDefinition[],
): LLMMessage[] {
  if (tools.length === 0) return messages;
  const catalog = buildToolCapabilityCatalog(tools);
  const [first, ...rest] = messages;
  if (first?.role === "system" && typeof first.content === "string") {
    return [{ ...first, content: `${first.content}\n\n${catalog}` }, ...rest];
  }
  return [{ role: "system", content: catalog }, ...messages];
}

export function assessMissingToolEscalation(params: {
  args: Record<string, unknown>;
  availableToolNames: Iterable<ToolName | string>;
}): EscalationCapabilityAssessment {
  const reason =
    typeof params.args.reason === "string" ? params.args.reason : "";
  const reasonCode =
    typeof params.args.reasonCode === "string"
      ? params.args.reasonCode.trim().toLowerCase()
      : "";
  const requiredCapability =
    normalizeCapability(params.args.requiredCapability) ??
    inferMissingCapability(reason);
  const matchedToolNames = extractNamedTools(reason);
  const availableToolNames = new Set(
    [...params.availableToolNames]
      .map((name) =>
        typeof name === "string" ? normalizeToolName(name) : (name as ToolName),
      )
      .filter((name): name is ToolName => Boolean(name)),
  );
  const availableCapabilities = getToolCapabilities(availableToolNames);
  const isMissingToolClaim =
    reasonCode === "missing_tool" ||
    MISSING_TOOL_CLAIM.test(reason) ||
    matchedToolNames.some((name) => availableToolNames.has(name));

  if (!isMissingToolClaim) {
    return {
      decision: "allow",
      reason: "not_missing_tool_claim",
      requiredCapability,
      matchedToolNames,
    };
  }

  const namedAvailableTools = matchedToolNames.filter((name) =>
    availableToolNames.has(name),
  );
  const capabilityIsAvailable =
    requiredCapability != null && availableCapabilities.has(requiredCapability);

  if (!capabilityIsAvailable && namedAvailableTools.length === 0) {
    return {
      decision: "allow",
      reason: "capability_unavailable",
      requiredCapability,
      matchedToolNames,
    };
  }

  const availableLine = buildToolCapabilityCatalog(availableToolNames);
  const target =
    requiredCapability ??
    (namedAvailableTools.length > 0
      ? namedAvailableTools.join(", ")
      : "the requested action");
  return {
    decision: "reject",
    reason: "capability_available",
    requiredCapability,
    matchedToolNames,
    correction:
      `Escalation rejected: ${target} is available in the current tool set.\n\n` +
      `${availableLine}\n\n` +
      "Continue by using the relevant action tool directly. If the page state is stale, call read_page once, then act.",
  };
}
