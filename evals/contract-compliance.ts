/**
 * Trace-based role contract compliance analyzer.
 * Validates model-tier and tool-envelope adherence from execution_contract events.
 */

import { ToolName } from "../src/types";
import { readTrace } from "./utils";

type ModelTier = "fast" | "smart";

export interface ContractViolation {
  sessionId: string;
  role: string;
  type: "model_tier_mismatch" | "tool_outside_contract" | "cross_lane_contamination" | "infinite_retry_loop" | "budget_overshoot";
  message: string;
  turnNumber?: number;
  observedModel?: string;
  toolName?: string;
  nodeId?: string;
}

export interface ContractComplianceSummary {
  sessionsAnalyzed: number;
  sessionsWithContract: number;
  violations: ContractViolation[];
}

interface ParsedContract {
  role: string;
  modelTier: ModelTier;
  allowedTools: Set<string>;
  initialModel?: string;
}

interface TraceTurn {
  turnNumber: number;
  llmRequest?: { model?: string };
  toolExecutions?: { toolName?: string }[];
  events?: { type?: string; data?: Record<string, unknown> }[];
}

const SMART_MODEL_HINTS = [
  "glm-4.7",
  "minimax",
  "grok-4",
  "gpt-5",
  "claude-3.7",
  "claude-4",
];

function inferModelTier(model: string | undefined): ModelTier | "unknown" {
  if (!model) return "unknown";
  const normalized = model.toLowerCase();
  if (SMART_MODEL_HINTS.some((hint) => normalized.includes(hint))) {
    return "smart";
  }
  return "fast";
}

function parseExecutionContract(turns: TraceTurn[]): ParsedContract | null {
  for (const turn of turns) {
    for (const event of turn.events || []) {
      if (event.type !== "execution_contract") continue;
      const data = event.data || {};
      const role = typeof data.role === "string" ? data.role : "unknown";
      const modelTier = data.modelTier === "smart" ? "smart" : "fast";
      const allowedToolsRaw = Array.isArray(data.allowedTools)
        ? data.allowedTools
        : [];
      const allowedTools = new Set<string>(
        allowedToolsRaw.filter(
          (tool): tool is string =>
            typeof tool === "string" &&
            (Object.values(ToolName) as string[]).includes(tool),
        ),
      );
      const initialModel =
        typeof data.initialModel === "string" ? data.initialModel : undefined;

      return { role, modelTier, allowedTools, initialModel };
    }
  }
  return null;
}

export function analyzeTraceContractCompliance(
  sessionId: string,
  turns: TraceTurn[],
): ContractViolation[] {
  const contract = parseExecutionContract(turns);
  if (!contract) return [];

  const violations: ContractViolation[] = [];
  const firstTurn = turns[0];
  const observedModel = firstTurn?.llmRequest?.model || contract.initialModel;
  const observedTier = inferModelTier(observedModel);
  if (observedTier !== "unknown" && observedTier !== contract.modelTier) {
    violations.push({
      sessionId,
      role: contract.role,
      type: "model_tier_mismatch",
      message: `Expected ${contract.modelTier} tier but observed ${observedTier} (${observedModel || "unknown model"}) on first turn.`,
      turnNumber: firstTurn?.turnNumber,
      observedModel,
    });
  }

  for (const turn of turns) {
    for (const exec of turn.toolExecutions || []) {
      const toolName = exec.toolName;
      if (!toolName || !contract.allowedTools.has(toolName)) {
        violations.push({
          sessionId,
          role: contract.role,
          type: "tool_outside_contract",
          message: `Tool ${toolName || "unknown"} executed outside allowed contract.`,
          turnNumber: turn.turnNumber,
          toolName,
        });
      }
    }
  }

  return violations;
}

interface RunTraceEvent {
  type: string;
  role?: string;
  data?: Record<string, unknown>;
  timestamp?: number;
}

/**
 * Analyze orchestrator run trace events for must-not regression violations.
 * Checks: cross-lane contamination, infinite retry loops, budget overshoot.
 */
export function analyzeRunTraceCompliance(
  runId: string,
  events: RunTraceEvent[],
): ContractViolation[] {
  const violations: ContractViolation[] = [];

  // --- Cross-lane contamination ---
  // Group node_started/node_completed intervals by nodeId.
  // Flag verifier-role events that appear interleaved with a different node's executor timeline.
  const nodeTimelines = new Map<string, { start?: number; end?: number }>();
  for (const event of events) {
    const nodeId = event.data?.nodeId as string | undefined;
    if (!nodeId) continue;
    if (event.type === "node_started") {
      nodeTimelines.set(nodeId, { start: event.timestamp, end: undefined });
    }
    if (event.type === "node_completed") {
      const existing = nodeTimelines.get(nodeId);
      if (existing) existing.end = event.timestamp;
    }
  }

  for (const event of events) {
    if (event.role !== "verifier") continue;
    const eventNodeId = event.data?.nodeId as string | undefined;
    if (!eventNodeId || !event.timestamp) continue;

    for (const [nodeId, timeline] of nodeTimelines) {
      if (nodeId === eventNodeId) continue;
      if (
        timeline.start &&
        event.timestamp >= timeline.start &&
        (!timeline.end || event.timestamp <= timeline.end)
      ) {
        violations.push({
          sessionId: runId,
          role: "verifier",
          type: "cross_lane_contamination",
          message: `Verifier event for node ${eventNodeId} interleaved within executor timeline of node ${nodeId}.`,
          nodeId: eventNodeId,
        });
        break;
      }
    }
  }

  // --- Infinite retry loop detection ---
  // Group reflexion_recorded events by nodeId.
  // Flag if >3 entries exist with identical (verifierDecision, failureType).
  const reflexionsByNode = new Map<string, { decision: string; failureType: string }[]>();
  for (const event of events) {
    if (event.type !== "reflexion_recorded") continue;
    const nodeId = event.data?.nodeId as string | undefined;
    if (!nodeId) continue;
    if (!reflexionsByNode.has(nodeId)) reflexionsByNode.set(nodeId, []);
    reflexionsByNode.get(nodeId)!.push({
      decision: String(event.data?.verifierDecision ?? ""),
      failureType: String(event.data?.failureType ?? ""),
    });
  }

  for (const [nodeId, entries] of reflexionsByNode) {
    if (entries.length <= 3) continue;
    const signatureCounts = new Map<string, number>();
    for (const entry of entries) {
      const key = `${entry.decision}:${entry.failureType}`;
      signatureCounts.set(key, (signatureCounts.get(key) || 0) + 1);
    }
    for (const [sig, count] of signatureCounts) {
      if (count > 3) {
        violations.push({
          sessionId: runId,
          role: "verifier",
          type: "infinite_retry_loop",
          message: `Node ${nodeId} has ${count} reflexion entries with identical signature (${sig}), indicating reflexion is not evolving.`,
          nodeId,
        });
      }
    }
  }

  // --- Budget overshoot ---
  // After a budget_warning event, check if task_completed shows tokens exceeding budget by >20%.
  const budgetWarnings = events.filter((e) => e.type === "budget_warning");
  const completions = events.filter((e) => e.type === "task_completed");

  if (budgetWarnings.length > 0 && completions.length > 0) {
    for (const warning of budgetWarnings) {
      const metric = warning.data?.metric as string | undefined;
      const ratio = warning.data?.ratio as number | undefined;
      if (!metric || typeof ratio !== "number") continue;

      for (const completion of completions) {
        const completionTokens = completion.data?.totalTokens as number | undefined;
        const completionCost = completion.data?.totalCost as number | undefined;
        const budgetTokens = completion.data?.budgetTokens as number | undefined;
        const budgetCost = completion.data?.budgetCost as number | undefined;

        if (
          metric === "tokens" &&
          typeof completionTokens === "number" &&
          typeof budgetTokens === "number" &&
          budgetTokens > 0 &&
          completionTokens / budgetTokens > 1.2
        ) {
          violations.push({
            sessionId: runId,
            role: "system",
            type: "budget_overshoot",
            message: `Token budget exceeded by ${((completionTokens / budgetTokens - 1) * 100).toFixed(1)}% after warning (${completionTokens} / ${budgetTokens}).`,
          });
        }

        if (
          metric === "cost" &&
          typeof completionCost === "number" &&
          typeof budgetCost === "number" &&
          budgetCost > 0 &&
          completionCost / budgetCost > 1.2
        ) {
          violations.push({
            sessionId: runId,
            role: "system",
            type: "budget_overshoot",
            message: `Cost budget exceeded by ${((completionCost / budgetCost - 1) * 100).toFixed(1)}% after warning ($${completionCost.toFixed(4)} / $${budgetCost.toFixed(4)}).`,
          });
        }
      }
    }
  }

  return violations;
}

export function analyzeSessionsContractCompliance(
  sessionIds: string[],
): ContractComplianceSummary {
  const unique = Array.from(new Set(sessionIds.filter(Boolean)));
  const violations: ContractViolation[] = [];
  let sessionsWithContract = 0;

  for (const sessionId of unique) {
    let turns: TraceTurn[] = [];
    try {
      turns = readTrace(sessionId) as TraceTurn[];
    } catch {
      continue;
    }
    if (parseExecutionContract(turns)) {
      sessionsWithContract++;
    }
    violations.push(...analyzeTraceContractCompliance(sessionId, turns));
  }

  return {
    sessionsAnalyzed: unique.length,
    sessionsWithContract,
    violations,
  };
}

