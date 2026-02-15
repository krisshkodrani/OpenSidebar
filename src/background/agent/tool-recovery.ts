import { ToolCall, ToolName } from "../../types";

/** Valid tool names for validation (lowercase set from ToolName enum values) */
const VALID_TOOL_NAMES = new Set<string>(
  Object.values(ToolName).map((v) => v.toLowerCase()),
);

/**
 * Extract top-level JSON objects from a string that may contain
 * interleaved plain text. Handles nested braces and escaped quotes
 * inside string literals.
 */
export function extractJsonObjects(text: string): unknown[] {
  const results: unknown[] = [];
  let depth = 0;
  let inString = false;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    // Handle string literals (skip escaped quotes)
    if (ch === '"' && (i === 0 || text[i - 1] !== "\\")) {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const candidate = text.slice(start, i + 1);
        try {
          results.push(JSON.parse(candidate));
        } catch {
          // Malformed — skip silently
        }
        start = -1;
      }
      if (depth < 0) depth = 0; // Reset on stray closing brace
    }
  }

  return results;
}

/**
 * Attempt to recover structured tool calls from LLM text output.
 * Models sometimes emit tool calls as plain JSON instead of using
 * the structured `tool_calls` API field.
 *
 * Recognized patterns:
 *   A: { "function": "tool_name", "arguments": {...} }
 *   B: { "tool": "tool_name", ...rest }
 *   C: { "to": "functions.tool_name", "args": {...} }
 *
 * Returns recovered ToolCall[] or null if nothing valid was found.
 */
export function recoverToolCallsFromText(content: string): ToolCall[] | null {
  if (!content || content.length === 0) return null;

  const objects = extractJsonObjects(content);
  if (objects.length === 0) return null;

  const calls: ToolCall[] = [];

  for (const obj of objects) {
    if (typeof obj !== "object" || obj === null) continue;
    const o = obj as Record<string, unknown>;

    let name: string | null = null;
    let args: Record<string, unknown> = {};

    // Pattern A: { function: "name", arguments: {...} }
    if (typeof o.function === "string" && o.arguments !== undefined) {
      name = o.function;
      args =
        typeof o.arguments === "object" && o.arguments !== null
          ? (o.arguments as Record<string, unknown>)
          : {};
    }
    // Pattern B: { tool: "name", ...rest }
    else if (typeof o.tool === "string") {
      name = o.tool;
      const { tool: _, ...rest } = o;
      args = rest as Record<string, unknown>;
    }
    // Pattern C: { to: "functions.name", args: {...} }
    else if (typeof o.to === "string") {
      name = o.to.replace(/^functions\./, "");
      args =
        typeof o.args === "object" && o.args !== null
          ? (o.args as Record<string, unknown>)
          : {};
    }

    if (!name) continue;

    // Validate tool name (case-insensitive)
    const normalized = name.toLowerCase();
    if (!VALID_TOOL_NAMES.has(normalized)) continue;

    // Deduplicate consecutive identical calls
    if (calls.length > 0) {
      const prev = calls[calls.length - 1];
      if (
        prev.function.name === normalized &&
        prev.function.arguments === JSON.stringify(args)
      ) {
        continue;
      }
    }

    calls.push({
      id: `recovered-${crypto.randomUUID()}`,
      type: "function",
      function: {
        name: normalized as ToolName,
        arguments: JSON.stringify(args),
      },
    });
  }

  return calls.length > 0 ? calls : null;
}
