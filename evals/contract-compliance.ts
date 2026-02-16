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
  type: "model_tier_mismatch" | "tool_outside_contract";
  message: string;
  turnNumber?: number;
  observedModel?: string;
  toolName?: string;
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

