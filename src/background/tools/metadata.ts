import { ToolName, RiskLevel } from "../../types";

export interface ToolMeta {
  risk: RiskLevel;
  domModifying: boolean;
  sequential: boolean;
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
  },
  [ToolName.TAKE_SCREENSHOT]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: true,
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
  [ToolName.UPDATE_PLAN]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: true,
  },
  [ToolName.READ_ELEMENT]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: false,
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
  [ToolName.BATCH_EXECUTE]: {
    risk: RiskLevel.MEDIUM,
    domModifying: true,
    sequential: true,
  },

  // React toolkit (on-demand)
  [ToolName.INSPECT_REACT]: {
    risk: RiskLevel.LOW,
    domModifying: false,
    sequential: false,
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
