import { AgentStatus } from "../../types";
import type { ToolCall } from "../../types";
import type { logger } from "../../utils";
import { validateToolCalls } from "../security";
import type { CompletionResponse } from "../llm/types";
import type { ContextManager } from "./context";
import { assessBlindToolCallReasoning } from "./blind-tool-call-policy";
import { assessParallelToolCalls } from "./parallel-tool-execution";
import type { TraceRecorder } from "./trace";

type ToolCallBranchSetupLogger = Pick<typeof logger, "warn">;
type ToolCallBranchSetupContext = Pick<ContextManager, "addMessage">;
type WorkflowRedirectMode = "parallel" | "sequential";

export type ToolCallBranchSetupDeps = {
  response: CompletionResponse;
  turnCount: number;
  cleanContent: string | null;
  toolsRecoveredFromText: boolean;
  hadThinking: boolean;
  consecutiveBlindToolTurns: number;
  context: ToolCallBranchSetupContext;
  traceRecorder: TraceRecorder | null;
  log: ToolCallBranchSetupLogger;
  statusHandler: (status: AgentStatus, message: string) => void;
  rewriteListDetailWorkflowToolCall: (
    toolCall: ToolCall,
    mode: WorkflowRedirectMode,
  ) => boolean;
};

export type ToolCallBranchSetupResult = {
  consecutiveBlindToolTurns: number;
  allCallsBlocked: boolean;
  canParallelize: boolean;
};

export function prepareToolCallBranch(
  deps: ToolCallBranchSetupDeps,
): ToolCallBranchSetupResult {
  const blindToolCallAssessment = assessBlindToolCallReasoning({
    cleanContent: deps.cleanContent,
    toolsRecoveredFromText: deps.toolsRecoveredFromText,
    hadThinking: deps.hadThinking,
    consecutiveBlindToolTurns: deps.consecutiveBlindToolTurns,
  });
  const consecutiveBlindToolTurns =
    blindToolCallAssessment.consecutiveBlindToolTurns;

  if (blindToolCallAssessment.nudge === "initial") {
    deps.log.warn(
      "agent",
      "Blind tool calls: 3 consecutive turns with no reasoning",
      {
        turn: deps.turnCount,
      },
    );
    deps.traceRecorder?.recordEvent("blind_tool_call_nudge", {
      turn: deps.turnCount,
      consecutive: consecutiveBlindToolTurns,
    });
    deps.context.addMessage({
      role: "user",
      content: blindToolCallAssessment.message,
    });
  } else if (blindToolCallAssessment.nudge === "repeat") {
    deps.log.warn("agent", "Blind tool calls: repeating nudge", {
      turn: deps.turnCount,
      consecutive: consecutiveBlindToolTurns,
    });
    deps.context.addMessage({
      role: "user",
      content: blindToolCallAssessment.message,
    });
  }

  const firstToolName = deps.response.tool_calls?.[0]?.function.name;
  if (firstToolName) {
    deps.statusHandler(AgentStatus.ACTING, `Executing ${firstToolName}...`);
  }

  const validated = validateToolCalls(deps.response.tool_calls ?? []);
  const blockedCalls = validated.filter((v) => v.blocked);
  const auditedCalls = validated.filter((v) => v.auditFlag);
  for (const a of auditedCalls) {
    deps.traceRecorder?.recordEvent("safety_gate_audit", {
      tool: a.original.function.name,
      flag: a.auditFlag ?? "unknown",
      phase: "output",
    });
  }

  deps.response.tool_calls = validated
    .filter((v) => !v.blocked)
    .map((v) => v.original);

  const originalCanParallelize = assessParallelToolCalls(
    deps.response.tool_calls,
  ).canParallelize;
  const workflowRedirectMode = originalCanParallelize
    ? "parallel"
    : "sequential";
  for (const toolCall of deps.response.tool_calls) {
    if (
      deps.rewriteListDetailWorkflowToolCall(toolCall, workflowRedirectMode)
    ) {
      deps.response.tool_calls = [toolCall];
      break;
    }
  }

  const finalToolCalls = [
    ...blockedCalls.map((b) => b.original),
    ...deps.response.tool_calls,
  ];
  deps.context.addMessage({
    role: "assistant",
    content: deps.response.content,
    tool_calls: finalToolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    })),
  });

  for (const b of blockedCalls) {
    deps.context.addMessage({
      role: "tool",
      tool_call_id: b.original.id,
      content: `Blocked: ${b.reason}`,
    });
    deps.traceRecorder?.recordEvent("safety_gate_blocked", {
      tool: b.original.function.name,
      reason: b.reason ?? "unknown",
      phase: "output",
    });
  }

  return {
    consecutiveBlindToolTurns,
    allCallsBlocked:
      deps.response.tool_calls.length === 0 && blockedCalls.length > 0,
    canParallelize: assessParallelToolCalls(deps.response.tool_calls)
      .canParallelize,
  };
}
