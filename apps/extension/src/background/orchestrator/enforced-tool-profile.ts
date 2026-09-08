import type { ToolName } from "../../types";
import { resolveToolProfile, type ToolProfile } from "../tools/metadata";
import type { TaskNode } from "./types";

export function enforceToolProfile(
  nodes: TaskNode[],
  profile: ToolProfile | undefined,
): TaskNode[] {
  const profileTools = resolveToolProfile(profile);
  if (!profileTools) return nodes;
  const allowed = new Set<ToolName>(profileTools);
  return nodes.map((node) => ({
    ...node,
    toolProfile: profile,
    allowedTools: node.allowedTools.filter((tool) => allowed.has(tool)),
    selectedSkillId: undefined,
    selectedSkillReason: undefined,
  }));
}
