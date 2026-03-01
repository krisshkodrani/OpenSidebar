import { AgentRole, ToolName, UserSettings } from "../../types";
import { TaskNode } from "./types";

export type ModelTier = "executor" | "planner";

export interface RoleExecutionContract {
  role: AgentRole;
  modelTier: ModelTier;
  allowedTools: ToolName[];
  disabledTools: Set<ToolName>;
  disableInternalPlanning: boolean;
}

const ALL_TOOLS = Object.values(ToolName);

function applyGlobalToolFlags(
  settings: UserSettings,
  allowed: Set<ToolName>,
): void {
  if (settings.disableNavigation) {
    allowed.delete(ToolName.NAVIGATE);
  }
}

function buildDisabledFromAllowed(allowed: Set<ToolName>): Set<ToolName> {
  const disabled = new Set<ToolName>();
  for (const tool of ALL_TOOLS) {
    if (!allowed.has(tool)) {
      disabled.add(tool);
    }
  }
  return disabled;
}

export function buildRoleExecutionContract(
  role: AgentRole,
  settings: UserSettings,
  node?: TaskNode,
): RoleExecutionContract {
  if (role === "planner" || role === "verifier") {
    return {
      role,
      modelTier: "planner",
      allowedTools: [],
      disabledTools: new Set<ToolName>(ALL_TOOLS),
      disableInternalPlanning: true,
    };
  }

  if (!node) {
    throw new Error("Executor role contract requires a task node.");
  }

  const allowed = new Set<ToolName>(node.allowedTools);
  // Executor must always be able to finalize a subtask.
  allowed.add(ToolName.DONE);
  applyGlobalToolFlags(settings, allowed);

  return {
    role: "executor",
    modelTier: "executor",
    allowedTools: Array.from(allowed),
    disabledTools: buildDisabledFromAllowed(allowed),
    disableInternalPlanning: true,
  };
}
