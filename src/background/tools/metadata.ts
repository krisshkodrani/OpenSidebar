import { ToolName, RiskLevel } from "../../types";

export interface ToolMeta {
  risk: RiskLevel;
  domModifying: boolean;
  sequential: boolean;
}

const TOOL_METADATA: Record<ToolName, ToolMeta> = {
  [ToolName.CLICK_ELEMENT]:  { risk: RiskLevel.MEDIUM, domModifying: true,  sequential: false },
  [ToolName.TYPE_TEXT]:       { risk: RiskLevel.MEDIUM, domModifying: true,  sequential: false },
  [ToolName.SELECT_OPTION]:  { risk: RiskLevel.MEDIUM, domModifying: true,  sequential: false },
  [ToolName.HOVER_ELEMENT]:  { risk: RiskLevel.LOW,    domModifying: true,  sequential: false },
  [ToolName.DRAG_AND_DROP]:  { risk: RiskLevel.MEDIUM, domModifying: true,  sequential: false },
  [ToolName.HIDE_ELEMENT]:   { risk: RiskLevel.MEDIUM, domModifying: true,  sequential: false },
  [ToolName.NAVIGATE]:       { risk: RiskLevel.HIGH,   domModifying: false, sequential: true  },
  [ToolName.DONE]:           { risk: RiskLevel.LOW,    domModifying: false, sequential: true  },
  [ToolName.READ_PAGE]:      { risk: RiskLevel.LOW,    domModifying: true,  sequential: false },
  [ToolName.SCROLL_PAGE]:    { risk: RiskLevel.LOW,    domModifying: false, sequential: false },
  [ToolName.FIND_ELEMENT]:   { risk: RiskLevel.LOW,    domModifying: false, sequential: false },
  [ToolName.TAKE_SCREENSHOT]:{ risk: RiskLevel.LOW,    domModifying: false, sequential: true  },
  [ToolName.PRESS_KEY]:      { risk: RiskLevel.MEDIUM, domModifying: false, sequential: false },
  [ToolName.DRAW_STROKE]:    { risk: RiskLevel.MEDIUM, domModifying: false, sequential: false },
  [ToolName.WAIT]:           { risk: RiskLevel.LOW,    domModifying: false, sequential: true  },
  [ToolName.MEMORY_ADD]:     { risk: RiskLevel.MEDIUM, domModifying: false, sequential: false },
  [ToolName.MEMORY_SEARCH]:  { risk: RiskLevel.LOW,    domModifying: false, sequential: false },
  [ToolName.CREATE_TAB]:     { risk: RiskLevel.HIGH,   domModifying: false, sequential: false },
  [ToolName.CLOSE_TAB]:      { risk: RiskLevel.HIGH,   domModifying: false, sequential: false },
  [ToolName.SWITCH_TAB]:     { risk: RiskLevel.MEDIUM, domModifying: false, sequential: false },
  [ToolName.ESCALATE]:       { risk: RiskLevel.LOW,    domModifying: false, sequential: true  },
  [ToolName.UPDATE_PLAN]:    { risk: RiskLevel.LOW,    domModifying: false, sequential: true  },
  [ToolName.READ_ELEMENT]:   { risk: RiskLevel.LOW,    domModifying: false, sequential: false },
  [ToolName.EXECUTE_JS]:     { risk: RiskLevel.HIGH,   domModifying: true,  sequential: true  },
  [ToolName.UPLOAD_FILE]:    { risk: RiskLevel.MEDIUM, domModifying: true,  sequential: true  },
  [ToolName.GO_BACK]:        { risk: RiskLevel.HIGH,   domModifying: false, sequential: true  },
  [ToolName.GO_FORWARD]:     { risk: RiskLevel.HIGH,   domModifying: false, sequential: true  },
  [ToolName.LIST_TABS]:      { risk: RiskLevel.LOW,    domModifying: false, sequential: false },
  [ToolName.RIGHT_CLICK]:    { risk: RiskLevel.MEDIUM, domModifying: true,  sequential: false },
  [ToolName.SET_CHECKBOX]:   { risk: RiskLevel.MEDIUM, domModifying: true,  sequential: false },
  [ToolName.DOWNLOAD_FILE]:  { risk: RiskLevel.MEDIUM, domModifying: false, sequential: false },
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
