import { ToolName, RiskLevel } from "../../types";

export interface ToolMeta {
  risk: RiskLevel;
  domModifying: boolean;
  sequential: boolean;
  excludeInSpeedMode: boolean;
}

const TOOL_METADATA: Record<ToolName, ToolMeta> = {
  [ToolName.CLICK_ELEMENT]:  { risk: RiskLevel.MEDIUM, domModifying: true,  sequential: false, excludeInSpeedMode: false },
  [ToolName.TYPE_TEXT]:       { risk: RiskLevel.MEDIUM, domModifying: true,  sequential: false, excludeInSpeedMode: false },
  [ToolName.SELECT_OPTION]:  { risk: RiskLevel.MEDIUM, domModifying: true,  sequential: false, excludeInSpeedMode: false },
  [ToolName.HOVER_ELEMENT]:  { risk: RiskLevel.LOW,    domModifying: true,  sequential: false, excludeInSpeedMode: false },
  [ToolName.DRAG_AND_DROP]:  { risk: RiskLevel.MEDIUM, domModifying: true,  sequential: false, excludeInSpeedMode: false },
  [ToolName.HIDE_ELEMENT]:   { risk: RiskLevel.MEDIUM, domModifying: true,  sequential: false, excludeInSpeedMode: false },
  [ToolName.NAVIGATE]:       { risk: RiskLevel.HIGH,   domModifying: false, sequential: true,  excludeInSpeedMode: false },
  [ToolName.DONE]:           { risk: RiskLevel.LOW,    domModifying: false, sequential: true,  excludeInSpeedMode: false },
  [ToolName.READ_PAGE]:      { risk: RiskLevel.LOW,    domModifying: false, sequential: false, excludeInSpeedMode: false },
  [ToolName.SCROLL_PAGE]:    { risk: RiskLevel.LOW,    domModifying: false, sequential: false, excludeInSpeedMode: false },
  [ToolName.FIND_ELEMENT]:   { risk: RiskLevel.LOW,    domModifying: false, sequential: false, excludeInSpeedMode: false },
  [ToolName.TAKE_SCREENSHOT]:{ risk: RiskLevel.LOW,    domModifying: false, sequential: false, excludeInSpeedMode: false },
  [ToolName.PRESS_KEY]:      { risk: RiskLevel.MEDIUM, domModifying: false, sequential: false, excludeInSpeedMode: false },
  [ToolName.DRAW_STROKE]:    { risk: RiskLevel.MEDIUM, domModifying: false, sequential: false, excludeInSpeedMode: false },
  [ToolName.WAIT]:           { risk: RiskLevel.LOW,    domModifying: false, sequential: false, excludeInSpeedMode: true  },
  [ToolName.MEMORY_ADD]:     { risk: RiskLevel.MEDIUM, domModifying: false, sequential: false, excludeInSpeedMode: true  },
  [ToolName.MEMORY_SEARCH]:  { risk: RiskLevel.LOW,    domModifying: false, sequential: false, excludeInSpeedMode: true  },
  [ToolName.CREATE_TAB]:     { risk: RiskLevel.HIGH,   domModifying: false, sequential: false, excludeInSpeedMode: true  },
  [ToolName.CLOSE_TAB]:      { risk: RiskLevel.HIGH,   domModifying: false, sequential: false, excludeInSpeedMode: true  },
  [ToolName.SWITCH_TAB]:     { risk: RiskLevel.MEDIUM, domModifying: false, sequential: false, excludeInSpeedMode: true  },
  [ToolName.ACTIVATE_SWARM]: { risk: RiskLevel.HIGH,   domModifying: false, sequential: false, excludeInSpeedMode: true  },
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

export const SPEED_MODE_EXCLUDED_TOOLS: Set<ToolName> = new Set(
  (Object.entries(TOOL_METADATA) as [ToolName, ToolMeta][])
    .filter(([, m]) => m.excludeInSpeedMode)
    .map(([name]) => name),
);
