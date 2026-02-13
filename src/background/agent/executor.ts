/**
 * Tool Executor - Handles parallel and sequential tool execution
 *
 * This module is responsible for:
 * - Determining execution strategy (parallel vs sequential)
 * - Executing tools with proper logging and step tracking
 * - Handling tool results and errors
 */

import { ToolCall, ToolName, AgentStep } from "../../types";
import { toolRegistry } from "../tools";
import { DOM_MODIFYING_TOOLS, SEQUENTIAL_TOOLS } from "../tools/metadata";
import { classifyRisk } from "../security";
import { formatStepLabel } from "./step-labels";
import { STRING_LIMITS } from "./constants";
import { logger } from "../../utils";

/** Result of a single tool execution */
export interface ToolResult {
  toolCall: ToolCall;
  result: string | null;
  error: string | null;
  durationMs: number;
  domModified: boolean;
}

/**
 * Determines if tools can be executed in parallel
 * Tools are parallelizable if:
 * - More than one tool call
 * - No sequential tools present (e.g., type_text must follow click)
 */
export function canParallelize(toolCalls: ToolCall[]): boolean {
  if (toolCalls.length <= 1) return false;
  const hasSequentialTool = toolCalls.some((tc) =>
    SEQUENTIAL_TOOLS.has(tc.function.name as ToolName),
  );
  return !hasSequentialTool;
}

/**
 * Executes a single tool and returns the result
 */
export async function executeSingleTool(
  toolCall: ToolCall,
  tabId: number,
  signal: AbortSignal,
  turnCount: number,
  llmIntention: string | null,
  stepHandler: (step: AgentStep, update: boolean) => void,
): Promise<ToolResult> {
  const toolName = toolCall.function.name as ToolName;
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch {
    // Registry will handle parse error on execute
  }

  const riskLevel = classifyRisk(toolName, args);

  const toolStep: AgentStep = {
    id: crypto.randomUUID(),
    type: "tool",
    label: formatStepLabel(toolName, args),
    detail: JSON.stringify(args),
    toolName,
    status: "running",
    timestamp: Date.now(),
  };
  stepHandler(toolStep, false);

  const startTime = Date.now();
  let error: string | null = null;
  let domModified = false;

  try {
    const execResult = await toolRegistry.execute(toolCall, tabId, signal);
    const toolMs = Date.now() - startTime;

    stepHandler(
      {
        ...toolStep,
        status: "done",
        durationMs: toolMs,
      },
      true,
    );

    logger.info("tools", `${toolName} OK`, {
      turn: turnCount,
      tool: toolName,
      risk: riskLevel,
      mode: "sequential",
      args: JSON.stringify(args).slice(0, STRING_LIMITS.ARGS_LOG),
      result: execResult.slice(0, STRING_LIMITS.RESULT_LOG),
      durationMs: toolMs,
      intention: llmIntention,
    });

    if (
      DOM_MODIFYING_TOOLS.has(toolName) &&
      !execResult.includes("Click intercepted")
    ) {
      domModified = true;
    }

    return {
      toolCall,
      result: execResult,
      error: null,
      durationMs: toolMs,
      domModified,
    };
  } catch (toolError: unknown) {
    if ((toolError as Error).name === "AbortError") throw toolError;
    const errorMsg = (toolError as Error).message || String(toolError);
    const toolMs = Date.now() - startTime;

    logger.error("tools", `${toolName} FAIL`, {
      turn: turnCount,
      tool: toolName,
      risk: riskLevel,
      mode: "sequential",
      args: JSON.stringify(args).slice(0, STRING_LIMITS.ARGS_LOG),
      error: errorMsg,
      durationMs: toolMs,
      intention: llmIntention,
    });

    stepHandler(
      {
        ...toolStep,
        status: "error",
        durationMs: Date.now() - startTime,
        errorMessage: errorMsg,
      },
      true,
    );

    error = errorMsg;
  }

  // This line is never reached after return in try block, but needed for error case
  return {
    toolCall,
    result: null,
    error,
    durationMs: Date.now() - startTime,
    domModified,
  };
}

/**
 * Executes tools in parallel
 */
export async function executeParallel(
  toolCalls: ToolCall[],
  tabId: number,
  signal: AbortSignal,
  turnCount: number,
  llmIntention: string | null,
  stepHandler: (step: AgentStep, update: boolean) => void,
): Promise<ToolResult[]> {
  const results = await Promise.all(
    toolCalls.map(async (toolCall) => {
      const toolName = toolCall.function.name as ToolName;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        // Registry will handle parse error on execute
      }

      const riskLevel = classifyRisk(toolName, args);

      const toolStep: AgentStep = {
        id: crypto.randomUUID(),
        type: "tool",
        label: formatStepLabel(toolName, args),
        detail: JSON.stringify(args),
        toolName,
        status: "running",
        timestamp: Date.now(),
      };
      stepHandler(toolStep, false);

      const startTime = Date.now();

      try {
        const execResult = await toolRegistry.execute(toolCall, tabId, signal);
        const toolMs = Date.now() - startTime;

        stepHandler(
          {
            ...toolStep,
            status: "done",
            durationMs: toolMs,
          },
          true,
        );

        logger.info("tools", `${toolName} OK`, {
          turn: turnCount,
          tool: toolName,
          risk: riskLevel,
          mode: "parallel",
          args: JSON.stringify(args).slice(0, STRING_LIMITS.ARGS_LOG),
          result: execResult.slice(0, STRING_LIMITS.RESULT_LOG),
          durationMs: toolMs,
          intention: llmIntention,
        });

        let domModified = false;
        if (
          DOM_MODIFYING_TOOLS.has(toolName) &&
          !execResult.includes("Click intercepted")
        ) {
          domModified = true;
        }

        return {
          toolCall,
          result: execResult,
          error: null,
          durationMs: toolMs,
          domModified,
        };
      } catch (toolError: unknown) {
        if ((toolError as Error).name === "AbortError") throw toolError;
        const errorMsg = (toolError as Error).message || String(toolError);
        const toolMs = Date.now() - startTime;

        logger.error("tools", `${toolName} FAIL`, {
          turn: turnCount,
          tool: toolName,
          risk: riskLevel,
          mode: "parallel",
          args: JSON.stringify(args).slice(0, STRING_LIMITS.ARGS_LOG),
          error: errorMsg,
          durationMs: toolMs,
          intention: llmIntention,
        });

        stepHandler(
          {
            ...toolStep,
            status: "error",
            durationMs: Date.now() - startTime,
            errorMessage: errorMsg,
          },
          true,
        );

        return {
          toolCall,
          result: null,
          error: errorMsg,
          durationMs: Date.now() - startTime,
          domModified: false,
        };
      }
    }),
  );

  return results;
}

/**
 * Check if a tool result indicates failure
 */
export function isToolFailure(result: string): boolean {
  return (
    result.startsWith("Error:") ||
    result.includes("does not appear to be") ||
    result.includes("No element with tag") ||
    result.includes("Click intercepted")
  );
}
