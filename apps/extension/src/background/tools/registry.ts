import { chromePersistencePort } from "../environment/chrome";
import {
  PageDocumentState,
  ToolName,
  ToolCall,
  ToolDefinition,
  ToolExecutionResult,
  UserSettings,
} from "../../types";
import { logger } from "../../utils";
import { getBlockedRuleForUrl } from "../../utils/site-access";

export interface ToolExecutionContext {
  observationBasis?: PageDocumentState & {
    observationRevision: number;
    requireGeometryMatch?: boolean;
  };
}

type ToolExecutor = (
  args: Record<string, unknown>,
  tabId: number,
  signal?: AbortSignal,
  toolCallId?: string,
  context?: ToolExecutionContext,
) => Promise<string | ToolExecutionResult>;

function normalizeToolResult(
  result: string | ToolExecutionResult,
): ToolExecutionResult {
  return typeof result === "string" ? { result } : result;
}

export class ToolRegistry {
  private tools: Map<ToolName, ToolExecutor> = new Map();
  private definitions: ToolDefinition[] = [];

  register(name: ToolName, definition: ToolDefinition, executor: ToolExecutor) {
    this.tools.set(name, executor);
    this.definitions.push(definition);
  }

  getDefinitions(exclude?: Set<ToolName>): ToolDefinition[] {
    if (!exclude || exclude.size === 0) return this.definitions;
    return this.definitions.filter((d) => !exclude.has(d.function.name));
  }

  setExecutor(name: ToolName, executor: ToolExecutor) {
    this.tools.set(name, executor);
  }

  clear() {
    this.tools.clear();
    this.definitions = [];
  }

  async execute(
    toolCall: ToolCall,
    tabId: number,
    signal?: AbortSignal,
  ): Promise<string> {
    return (await this.executeDetailed(toolCall, tabId, signal)).result;
  }

  async executeDetailed(
    toolCall: ToolCall,
    tabId: number,
    signal?: AbortSignal,
    context?: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const name = toolCall.function.name as ToolName;
    const executor = this.tools.get(name);

    if (!executor) {
      logger.error("tools", `Tool not found: ${name}`);
      // This fires exactly when the model hallucinated a tool name, so the
      // error is the one place a corrective list is guaranteed to be read.
      const available = this.definitions.map((d) => d.function.name).join(", ");
      return {
        result: `Error: Tool ${name} not found. Available tools: ${available}.`,
      };
    }

    let args: Record<string, unknown> = {};
    const rawArgs = toolCall.function.arguments;
    if (rawArgs && rawArgs.trim().length > 0) {
      try {
        args = JSON.parse(rawArgs);
      } catch (e) {
        logger.error("tools", `Failed to parse arguments for ${name}`, {
          error: e,
        });
        const def = this.definitions.find((d) => d.function.name === name);
        const params = Object.keys(
          (def?.function.parameters as { properties?: Record<string, unknown> })
            ?.properties ?? {},
        );
        const hint =
          params.length > 0
            ? ` Expected parameters: ${params.join(", ")}.`
            : "";
        return {
          result: `Error: Invalid JSON arguments for ${name}.${hint} Retry with a valid JSON object.`,
        };
      }
    }

    try {
      try {
        const [stored, tab] = await Promise.all([
          chromePersistencePort.sync.get("userSettings"),
          chrome.tabs.get(tabId),
        ]);
        const settings = (stored.userSettings ?? {}) as UserSettings;
        const blocked = getBlockedRuleForUrl(tab.url ?? "", settings);
        if (blocked) {
          return {
            result: `Error: Tool execution blocked on ${blocked.host} by site access rule "${blocked.rule}".`,
          };
        }
      } catch {
        // Non-fatal: if checks fail, continue and let tool execute.
      }
      const result = await executor(args, tabId, signal, toolCall.id, context);
      return normalizeToolResult(result);
    } catch (error: any) {
      if (error.name === "AbortError") throw error;
      return { result: `Error executing ${name}: ${error.message}` };
    }
  }
}

// Singleton instance
export const toolRegistry = new ToolRegistry();
