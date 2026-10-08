import { ToolDefinition, ToolName } from "../../types";
import {
  resolveToolProfile,
  type ToolProfile,
} from "../tools/metadata";
import {
  getSkillToolPolicy,
  resolveSkillToolProfile,
  type SkillToolPolicy,
} from "../orchestrator/skills";
import { inferToolProfileForStep } from "./planner";
import { requiresBroadListDetailReview } from "./list-detail-policy";

export interface AgentLoopSkillToolsHost {
  log: {
    info(category: string, message: string, data?: unknown): void;
  };
  originalQuery: string;
  planSteps: Array<{
    successCriteria?: string;
  }>;
  planSubtasks: Array<{
    description: string;
    toolProfile?: string;
  }>;
  selectedSkillId: string | null;
  enabledSkillPackIds?: string[];
  traceRecorder?: {
    recordEvent(name: string, data?: unknown): void;
  };
  turnCount: number;
}

export function getActiveSkillToolPolicy(
  loop: AgentLoopSkillToolsHost,
): SkillToolPolicy | null {
  return getSkillToolPolicy(loop.selectedSkillId ?? undefined, {
    enabledSkillPackIds: loop.enabledSkillPackIds,
  });
}

export function classifySkillToolPreference(
  loop: AgentLoopSkillToolsHost,
  toolName: ToolName,
): "preferred" | "discouraged" | "neutral" | null {
  const policy = getActiveSkillToolPolicy(loop);
  if (!policy) return null;
  if (policy.preferredTools.includes(toolName)) return "preferred";
  if (policy.discouragedTools.includes(toolName)) return "discouraged";
  return "neutral";
}

export function applySkillToolRanking(
  loop: AgentLoopSkillToolsHost,
  tools: ToolDefinition[],
): ToolDefinition[] {
  const policy = getActiveSkillToolPolicy(loop);
  if (!policy) return tools;

  const preferredIndex = new Map<ToolName, number>(
    policy.preferredTools.map((toolName, index) => [toolName, index]),
  );
  const discouragedIndex = new Map<ToolName, number>(
    policy.discouragedTools.map((toolName, index) => [toolName, index]),
  );

  const ranked = [...tools]
    .map((tool, originalIndex) => {
      const toolName = tool.function.name as ToolName;
      if (preferredIndex.has(toolName)) {
        return {
          tool,
          bucket: 0,
          policyIndex: preferredIndex.get(toolName) ?? 0,
          originalIndex,
        };
      }
      if (discouragedIndex.has(toolName)) {
        return {
          tool,
          bucket: 2,
          policyIndex: discouragedIndex.get(toolName) ?? 0,
          originalIndex,
        };
      }
      return {
        tool,
        bucket: 1,
        policyIndex: Number.MAX_SAFE_INTEGER,
        originalIndex,
      };
    })
    .sort((a, b) => {
      if (a.bucket !== b.bucket) return a.bucket - b.bucket;
      if (a.policyIndex !== b.policyIndex)
        return a.policyIndex - b.policyIndex;
      return a.originalIndex - b.originalIndex;
    })
    .map((entry) => entry.tool);

  const originalOrder = tools.map((tool) => tool.function.name).join(",");
  const rankedOrder = ranked.map((tool) => tool.function.name).join(",");
  if (originalOrder !== rankedOrder) {
    loop.log.info("agent", "Skill tool ranking applied", {
      turn: loop.turnCount,
      skillId: loop.selectedSkillId,
      preferredTools: policy.preferredTools,
      discouragedTools: policy.discouragedTools,
      originalToolCount: tools.length,
      rankedToolCount: ranked.length,
    });
    loop.traceRecorder?.recordEvent("skill_tool_ranking_applied", {
      turn: loop.turnCount,
      skillId: loop.selectedSkillId ?? "unknown",
      preferredTools: policy.preferredTools,
      discouragedTools: policy.discouragedTools,
      originalOrder: tools.map((tool) => tool.function.name),
      rankedOrder: ranked.map((tool) => tool.function.name),
    });
  }

  return ranked;
}

export function recordSkillToolSelection(
  loop: AgentLoopSkillToolsHost,
  toolName: ToolName,
  mode: "parallel" | "sequential",
): void {
  const preference = classifySkillToolPreference(loop, toolName);
  if (!loop.selectedSkillId || !preference) return;
  loop.traceRecorder?.recordEvent("skill_tool_selected", {
    turn: loop.turnCount,
    skillId: loop.selectedSkillId,
    toolName,
    preference,
    mode,
  });
}

export function getActiveToolProfileForStep(
  loop: AgentLoopSkillToolsHost,
  stepIndex: number,
): ToolProfile | undefined {
  const subtask = loop.planSubtasks[stepIndex];
  if (!subtask) return undefined;
  const explicitProfile = subtask.toolProfile;
  if (explicitProfile && resolveToolProfile(explicitProfile as ToolProfile)) {
    return resolveSkillToolProfile(
      loop.selectedSkillId,
      subtask.description,
      loop.planSteps[stepIndex]?.successCriteria || "",
      explicitProfile as ToolProfile,
      { enabledSkillPackIds: loop.enabledSkillPackIds },
    );
  }
  const inferredProfile = inferToolProfileForStep(
    subtask.description,
    loop.planSteps[stepIndex]?.successCriteria || "",
  );
  return resolveSkillToolProfile(
    loop.selectedSkillId,
    subtask.description,
    loop.planSteps[stepIndex]?.successCriteria || "",
    inferredProfile,
    { enabledSkillPackIds: loop.enabledSkillPackIds },
  );
}

export function isSkillOwnedListDetailReview(
  loop: AgentLoopSkillToolsHost,
): boolean {
  return (
    loop.selectedSkillId === "list-detail-review-loop" &&
    requiresBroadListDetailReview(loop.originalQuery)
  );
}

export function isSkillOwnedMultiTabChecklistLoop(
  loop: AgentLoopSkillToolsHost,
): boolean {
  return loop.selectedSkillId === "multi-tab-checklist-workflow";
}
