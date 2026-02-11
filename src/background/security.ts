import { ToolName, RiskLevel, Result } from "../types";

/**
 * Classifies the risk level of a tool invocation.
 * Used for structured logging and ToolCallSummary display.
 * Non-blocking — risk is informational, not a gate.
 */
export function classifyRisk(toolName: ToolName, _args: Record<string, unknown>): RiskLevel {
    switch (toolName) {
        case ToolName.READ_PAGE:
        case ToolName.SCROLL_PAGE:
        case ToolName.MEMORY_SEARCH:
        case ToolName.WAIT:
        case ToolName.TAKE_SCREENSHOT:
        case ToolName.HOVER_ELEMENT:
        case ToolName.FIND_ELEMENT:
        case ToolName.DONE:
            return RiskLevel.LOW;

        case ToolName.CLICK_ELEMENT:
        case ToolName.TYPE_TEXT:
        case ToolName.SELECT_OPTION:
        case ToolName.PRESS_KEY:
        case ToolName.DRAG_AND_DROP:
        case ToolName.DRAW_STROKE:
        case ToolName.HIDE_ELEMENT:
        case ToolName.MEMORY_ADD:
        case ToolName.SWITCH_TAB:
            return RiskLevel.MEDIUM;

        case ToolName.NAVIGATE:
        case ToolName.CREATE_TAB:
        case ToolName.CLOSE_TAB:
        case ToolName.ACTIVATE_SWARM:
            return RiskLevel.HIGH;

        default:
            return RiskLevel.HIGH;
    }
}

/**
 * Sanitizes a URL before navigation or tab creation.
 * Only allows http: and https: protocols.
 */
export function sanitizeUrl(url: string): Result<string> {
    try {
        const parsed = new URL(url);
        if (!["http:", "https:"].includes(parsed.protocol)) {
            return { ok: false, error: `Blocked protocol: ${parsed.protocol}` };
        }
        return { ok: true, value: parsed.href };
    } catch {
        return { ok: false, error: `Invalid URL: ${url}` };
    }
}

/**
 * Sanitizes user input text before sending to the LLM.
 * Removes null bytes and truncates to a reasonable length.
 */
export function sanitizeUserInput(text: string): string {
    let sanitized = text.replace(/\0/g, "");
    sanitized = sanitized.slice(0, 10_000);
    return sanitized;
}
