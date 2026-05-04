import { ToolDefinition, ToolName } from "../../types";
import {
  buildDomAwareProfile,
  resolveToolProfile,
  type ToolProfile,
} from "../tools/metadata";
import {
  getSkillToolPolicy,
  getSkillToolSuppressionPolicy,
  resolveSkillToolProfile,
  type SkillToolPolicy,
} from "../orchestrator/skills";
import { inferToolProfileForStep } from "./planner";
import { isToolProfileName } from "./tool-profile-policy";
import { requiresBroadListDetailReview } from "./list-detail-policy";

export interface AgentLoopSkillToolsHost {
  context: {
    getPlanStatusRaw(): {
      subtasks: Array<{
        status: string;
        description: string;
        toolProfile?: string;
      }>;
    } | null;
    getSnapshot(): {
      elements?: unknown[];
    } | null;
  };
  limits: {
    stepWarnTurns: number;
  };
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
  turnsOnCurrentStep: number;
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

export function applySkillToolSuppression(
  loop: AgentLoopSkillToolsHost,
  tools: ToolDefinition[],
): ToolDefinition[] {
  const policy = getSkillToolSuppressionPolicy(
    loop.selectedSkillId ?? undefined,
    { enabledSkillPackIds: loop.enabledSkillPackIds },
  );
  if (!policy) return tools;

  const suppressed = new Set<ToolName>(
    policy.temporarilySuppressedTools.filter(
      (tool) => !policy.exemptTools.includes(tool),
    ),
  );
  if (suppressed.size === 0) return tools;

  const filtered = tools.filter(
    (tool) => !suppressed.has(tool.function.name as ToolName),
  );
  if (filtered.length !== tools.length) {
    loop.log.info("agent", "Skill tool suppression applied", {
      turn: loop.turnCount,
      skillId: loop.selectedSkillId,
      suppressedTools: Array.from(suppressed),
      originalToolCount: tools.length,
      filteredToolCount: filtered.length,
    });
    loop.traceRecorder?.recordEvent("skill_tool_suppression_applied", {
      turn: loop.turnCount,
      skillId: loop.selectedSkillId ?? "unknown",
      suppressedTools: Array.from(suppressed),
      originalToolCount: tools.length,
      filteredToolCount: filtered.length,
    });
  }

  return filtered;
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

export function applyToolProfile(
  loop: AgentLoopSkillToolsHost,
  tools: ToolDefinition[],
): ToolDefinition[] {
  const planStatus = loop.context.getPlanStatusRaw();
  const currentSubtaskIndex =
    planStatus?.subtasks.findIndex((s) => s.status === "running") ?? -1;
  const currentSubtask =
    currentSubtaskIndex >= 0
      ? planStatus?.subtasks[currentSubtaskIndex]
      : undefined;

  const explicitProfile = isToolProfileName(currentSubtask?.toolProfile)
    ? currentSubtask.toolProfile
    : undefined;
  const inferredProfile =
    !explicitProfile && currentSubtask
      ? inferToolProfileForStep(
          currentSubtask.description,
          loop.planSteps[currentSubtaskIndex]?.successCriteria || "",
        )
      : undefined;
  const activeProfile = resolveSkillToolProfile(
    loop.selectedSkillId,
    currentSubtask?.description ?? loop.originalQuery,
    loop.planSteps[currentSubtaskIndex]?.successCriteria || "",
    explicitProfile ?? inferredProfile,
    { enabledSkillPackIds: loop.enabledSkillPackIds },
  );
  if (activeProfile) {
    if (loop.turnsOnCurrentStep >= loop.limits.stepWarnTurns) {
      loop.log.info("agent", "Tool profile widened due to step stagnation", {
        turn: loop.turnCount,
        profile: activeProfile,
        turnsOnCurrentStep: loop.turnsOnCurrentStep,
        stepWarnTurns: loop.limits.stepWarnTurns,
      });
      loop.traceRecorder?.recordEvent("tool_profile_widened", {
        turn: loop.turnCount,
        profile: activeProfile,
        reason: "step_stagnation",
        turnsOnCurrentStep: loop.turnsOnCurrentStep,
      });
      return tools;
    }

    const allowedNames = resolveToolProfile(activeProfile as ToolProfile);
    if (!allowedNames) return tools;

    const allowedSet = new Set<string>(allowedNames);
    allowedSet.add(ToolName.DONE);
    allowedSet.add(ToolName.ESCALATE);
    allowedSet.add(ToolName.CLARIFY);
    allowedSet.add(ToolName.UPDATE_NOTES);

    const filtered = tools.filter((t) => allowedSet.has(t.function.name));
    loop.log.info("agent", "Tool profile applied", {
      turn: loop.turnCount,
      profile: activeProfile,
      subtask: currentSubtask?.description,
      source: explicitProfile ? "plan_status" : "step_inference",
      originalToolCount: tools.length,
      filteredToolCount: filtered.length,
    });
    loop.traceRecorder?.recordEvent("tool_profile_applied", {
      turn: loop.turnCount,
      profile: activeProfile,
      source: explicitProfile ? "plan_status" : "step_inference",
      originalToolCount: tools.length,
      filteredToolCount: filtered.length,
    });
    return filtered;
  }

  const snapshot = loop.context.getSnapshot();
  if (snapshot?.elements) {
    const allowedSet = buildDomAwareProfile(snapshot.elements as any);
    const filtered = tools.filter((t) =>
      allowedSet.has(t.function.name as ToolName),
    );
    loop.log.info("agent", "Tool profile applied", {
      turn: loop.turnCount,
      profile: "dom_aware",
      subtask: currentSubtask?.description ?? loop.originalQuery,
      source: "dom_snapshot",
      originalToolCount: tools.length,
      filteredToolCount: filtered.length,
    });
    loop.traceRecorder?.recordEvent("tool_profile_applied", {
      turn: loop.turnCount,
      profile: "dom_aware",
      source: "dom_snapshot",
      originalToolCount: tools.length,
      filteredToolCount: filtered.length,
    });
    return filtered;
  }

  return tools;
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

export function isSkillOwnedProcurementLoop(
  loop: AgentLoopSkillToolsHost,
): boolean {
  return loop.selectedSkillId === "multi-tab-procurement-loop";
}
