import { AgentRole, ToolName, UserSettings } from "../../types";
import { getSkillToolPolicy, getSkillToolSuppressionPolicy } from "./skills";
import { TaskNode } from "./types";
import { resolveToolProfile, type ToolProfile } from "../tools/metadata";

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
  if (!settings.allowNavigation) {
    allowed.delete(ToolName.NAVIGATE);
  }
}

function applySkillToolSuppression(
  node: TaskNode,
  allowed: Set<ToolName>,
): void {
  const policy = getSkillToolSuppressionPolicy(node.selectedSkillId);
  if (!policy) return;

  const exemptTools = new Set<ToolName>(policy.exemptTools);
  for (const tool of policy.temporarilySuppressedTools) {
    if (exemptTools.has(tool)) continue;
    allowed.delete(tool);
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
  enforcedProfile?: ToolProfile,
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
  const skillToolPolicy = getSkillToolPolicy(node.selectedSkillId);
  for (const tool of skillToolPolicy?.preferredTools ?? []) {
    allowed.add(tool);
  }
  // Executor must always be able to finalize a subtask.
  allowed.add(ToolName.DONE);
  applySkillToolSuppression(node, allowed);
  applyGlobalToolFlags(settings, allowed);
  const ceiling = resolveToolProfile(enforcedProfile);
  if (ceiling) {
    const ceilingSet = new Set(ceiling);
    for (const tool of allowed) if (!ceilingSet.has(tool)) allowed.delete(tool);
  }

  return {
    role: "executor",
    modelTier: "executor",
    allowedTools: Array.from(allowed),
    disabledTools: buildDisabledFromAllowed(allowed),
    disableInternalPlanning: true,
  };
}
