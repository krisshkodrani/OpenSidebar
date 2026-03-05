import { ToolName, RiskLevel, Result, ToolCall } from "../../types";
import { getToolMeta } from "../tools/metadata";

/** Valid tool names for fast lookup */
const VALID_TOOL_NAMES = new Set<string>(Object.values(ToolName));

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

// --- Prompt Injection Defense ---

const INJECTION_PATTERNS = [
  /ignore (all |previous )?instructions/gi,
  /you are now/gi,
  /disregard (all |previous )?/gi,
  /forget everything/gi,
  // OpenAI ChatML delimiters
  /<\|im_(start|end)\|>/g,
  /<\|endoftext\|>/g,
  /<\|(system|user|assistant)\|>/g,
  // Llama / Mistral delimiters
  /\[(\/?)INST\]/g,
  /<<\/?SYS>>/g,
  // BOS/EOS tokens
  /<\/?s>/g,
  // Alpaca-style markers
  /^### (?:Instruction|Response|Input)\b/gim,
];

/**
 * Neutralize prompt-injection patterns in page-sourced text before embedding
 * into the LLM system prompt. Wraps suspicious phrases in [PAGE_TEXT: …]
 * markers rather than deleting them, so pages that legitimately discuss
 * prompt injection remain readable.
 */
export function sanitizeForPrompt(text: string): string {
  let s = text;
  // Neutralize role impersonation lines (OpenAI + Claude-style)
  s = s.replace(/^(system|user|assistant|human)\s*:/gim, "[PAGE_TEXT: $1]:");
  // Neutralize injection patterns (wrap, don't delete)
  for (const pat of INJECTION_PATTERNS) {
    // Reset lastIndex for global regexes
    pat.lastIndex = 0;
    s = s.replace(pat, (m) => `[PAGE_TEXT: ${m}]`);
  }
  // Normalize excessive whitespace
  s = s.replace(/\n{4,}/g, "\n\n\n");
  s = s.replace(/ {11,}/g, " ");
  // Length cap
  return s.slice(0, 50_000);
}

// --- Tool Call Validation ---

export interface ValidatedToolCall {
  original: ToolCall;
  blocked: boolean;
  reason?: string;
  auditFlag?: string;
}

/**
 * Validate tool calls before dispatch. URL tools are hard-blocked on
 * dangerous protocols; type_text is audit-only (logged, not blocked).
 */
export function validateToolCalls(calls: ToolCall[]): ValidatedToolCall[] {
  return calls.map((tc) => {
    const name = tc.function.name;

    // Block unknown/hallucinated tool names early
    if (!VALID_TOOL_NAMES.has(name)) {
      return {
        original: tc,
        blocked: true,
        reason: `Unknown tool "${name}". Use one of the tools provided in your tool list.`,
      };
    }

    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments || "{}");
    } catch {
      // Unparseable args — let executor handle the error
      return { original: tc, blocked: false };
    }

    // execute_js: block dangerous APIs
    if (name === "execute_js") {
      const code = (args.code as string) || (args.expression as string) || "";
      // Block navigation via location assignment (any accessor variant)
      if (
        /(?:window|document|globalThis|self|top|parent|frames\s*\[.*?\])\.location/i.test(code) ||
        /\blocation\s*\.\s*(?:href|assign|replace|reload)/i.test(code) ||
        /\blocation\s*=/i.test(code)
      ) {
        return {
          original: tc,
          blocked: true,
          reason:
            "Navigation via location is blocked. Use the navigate tool instead.",
        };
      }
      // Block window.open (can open arbitrary URLs including javascript:)
      if (/\bwindow\.open\s*\(/i.test(code) || /\bopen\s*\(\s*['"`]/i.test(code)) {
        return {
          original: tc,
          blocked: true,
          reason:
            "window.open() is blocked. Use the create_tab tool instead.",
        };
      }
      // Block document.write/writeln (arbitrary HTML/JS injection)
      if (/\bdocument\.write(?:ln)?\s*\(/i.test(code)) {
        return {
          original: tc,
          blocked: true,
          reason:
            "document.write() is blocked due to XSS risk.",
        };
      }
      // Block eval and Function constructor (code obfuscation)
      if (/\beval\s*\(/i.test(code) || /\bFunction\s*\(/i.test(code)) {
        return {
          original: tc,
          blocked: true,
          reason:
            "eval() and Function() are blocked due to code injection risk.",
        };
      }
      // Block dynamic script injection
      if (/createElement\s*\(\s*['"`]script/i.test(code)) {
        return {
          original: tc,
          blocked: true,
          reason:
            "Dynamic script injection is blocked due to XSS risk.",
        };
      }
    }

    // navigate / open_tab / create_tab: re-validate URL at loop level
    if (name === "navigate" || name === "create_tab") {
      const url = args.url as string;
      if (url) {
        const result = sanitizeUrl(url);
        if (!result.ok) {
          return { original: tc, blocked: true, reason: result.error };
        }
      }
    }

    // type_text: audit-only flag for injection patterns
    if (name === "type_text") {
      const text = (args.text as string) || "";
      if (
        INJECTION_PATTERNS.some((p) => {
          p.lastIndex = 0;
          return p.test(text);
        })
      ) {
        return {
          original: tc,
          blocked: false,
          auditFlag: "injection_pattern_in_typed_text",
        };
      }
    }

    return { original: tc, blocked: false };
  });
}
