import { ToolName, ToolCall, ToolDefinition } from "../../types";
// Removed local ToolDefinition import
import { logger } from "../../utils";

type ToolExecutor = (args: Record<string, unknown>, tabId: number) => Promise<string>;

/** Tools excluded in speed mode to reduce token count and LLM latency */
export const SPEED_MODE_EXCLUDED_TOOLS: Set<ToolName> = new Set([
    ToolName.ACTIVATE_SWARM,
    ToolName.MEMORY_ADD,
    ToolName.MEMORY_SEARCH,
    ToolName.TAKE_SCREENSHOT,
    ToolName.WAIT,
    ToolName.CREATE_TAB,
    ToolName.CLOSE_TAB,
    ToolName.SWITCH_TAB,
]);

export class ToolRegistry {
    private tools: Map<ToolName, ToolExecutor> = new Map();
    private definitions: ToolDefinition[] = [];

    register(name: ToolName, definition: ToolDefinition, executor: ToolExecutor) {
        this.tools.set(name, executor);
        this.definitions.push(definition);
    }

    getDefinitions(exclude?: Set<ToolName>): ToolDefinition[] {
        if (!exclude || exclude.size === 0) return this.definitions;
        return this.definitions.filter(d => !exclude.has(d.function.name));
    }

    setExecutor(name: ToolName, executor: ToolExecutor) {
        this.tools.set(name, executor);
    }

    clear() {
        this.tools.clear();
        this.definitions = [];
    }

    async execute(toolCall: ToolCall, tabId: number): Promise<string> {
        const name = toolCall.function.name as ToolName;
        const executor = this.tools.get(name);

        if (!executor) {
            logger.error("tools", `Tool not found: ${name}`);
            return `Error: Tool ${name} not found.`;
        }

        let args: Record<string, unknown> = {};
        try {
            args = JSON.parse(toolCall.function.arguments);
        } catch (e) {
            logger.error("tools", `Failed to parse arguments for ${name}`, { error: e });
            return `Error: Invalid JSON arguments for ${name}.`;
        }

        try {
            logger.debug("tools", `Executing ${name}`, { args });
            const result = await executor(args, tabId);
            return result;
        } catch (error: any) {
            logger.error("tools", `Tool execution failed`, { tool: name, error: error.message });
            return `Error executing ${name}: ${error.message}`;
        }
    }
}

// Singleton instance
export const toolRegistry = new ToolRegistry();
