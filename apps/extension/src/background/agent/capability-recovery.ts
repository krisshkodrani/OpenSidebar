import { ToolName, type ToolDefinition } from "../../types";
import { assessMissingToolEscalation, getToolCapabilities } from "./tool-capabilities";

/** Restore requested capabilities hidden by advisory profiles, within the role ceiling. */
export function requestedRecoveryTools(
  args: Record<string, unknown>,
  activeTools: ToolName[],
  permittedTools: ToolName[],
): ToolName[] {
  const assessment = assessMissingToolEscalation({ args, availableToolNames: activeTools });
  if (assessment.reason === "not_missing_tool_claim") return [];
  const active = new Set(activeTools);
  const named = new Set(assessment.matchedToolNames);
  return permittedTools.filter((name) => !active.has(name) && (
    named.has(name) || (assessment.requiredCapability != null &&
      getToolCapabilities([name]).has(assessment.requiredCapability))
  ));
}

export function restoreRecoveryTools(
  selected: ToolDefinition[],
  permitted: ToolDefinition[],
  requested: Set<ToolName>,
): ToolDefinition[] {
  const present = new Set(selected.map((tool) => tool.function.name));
  return [...selected, ...permitted.filter((tool) =>
    requested.has(tool.function.name as ToolName) && !present.has(tool.function.name),
  )];
}
