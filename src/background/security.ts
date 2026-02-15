import { ToolName, RiskLevel, Result } from "../types";
import { getToolMeta } from "./tools/metadata";

/**
 * Classifies the risk level of a tool invocation.
 * Uses consolidated tool metadata from tools/metadata.ts.
 * Non-blocking — risk is informational, not a gate.
 */
export function classifyRisk(
  toolName: ToolName,
  _args: Record<string, unknown>,
): RiskLevel {
  return getToolMeta(toolName)?.risk ?? RiskLevel.HIGH;
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
