/**
 * Golden case extractor — builds eval cases from real trace turns.
 *
 * Reads a specific turn from a trace session and produces an EvalCase
 * with real system prompts, conversation history, and (optionally corrected)
 * expected tool calls.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { EvalCase } from "./types";
import { readTrace, readSessionIndex, resolveSessionId } from "./utils";

const GOLDEN_DIR = join("evals", "golden");

export interface ExtractOverrides {
  /** Replace the expected tool name */
  correctTool?: string;
  /** Replace the expected tool args (JSON string or object) */
  correctArgs?: Record<string, unknown>;
  /** Pathology tag */
  tag?: string;
  /** Custom case ID (default: auto-generated from session + turn) */
  id?: string;
}

/**
 * Extract a golden eval case from a specific trace turn.
 */
export function extractGoldenCase(
  sessionIdPrefix: string,
  turnNumber: number,
  overrides?: ExtractOverrides,
): EvalCase {
  const sessionId = resolveSessionId(sessionIdPrefix);
  const entries = readTrace(sessionId);
  const sessions = readSessionIndex();
  const session = sessions.find((s: any) => s.sessionId === sessionId) as any;

  if (!session) {
    throw new Error(`Session metadata not found in index for: ${sessionId}`);
  }

  const turn = (entries as any[]).find((e) => e.turnNumber === turnNumber);
  if (!turn) {
    throw new Error(
      `Turn ${turnNumber} not found in session ${sessionId}. ` +
      `Available turns: ${(entries as any[]).filter(e => e.turnNumber).map(e => e.turnNumber).join(", ")}`,
    );
  }

  // Extract system prompt from LLM request messages
  const messages = turn.llmRequest?.messages ?? [];
  const systemMsg = messages.find((m: any) => m.role === "system");
  const systemPrompt = systemMsg?.content ?? "";

  if (!systemPrompt) {
    throw new Error(
      `Turn ${turnNumber} in session ${sessionId} has no system prompt in llmRequest.messages`,
    );
  }

  // Extract expected tool calls from LLM response
  const responseToolCalls = turn.llmResponse?.toolCalls ?? [];
  let expectedToolCalls = responseToolCalls.map((tc: any) => {
    let args: Record<string, unknown> = {};
    try {
      args = typeof tc.function?.arguments === "string"
        ? JSON.parse(tc.function.arguments)
        : tc.function?.arguments ?? {};
    } catch { /* keep empty */ }
    return { toolName: tc.function?.name ?? "unknown", args };
  });

  // Apply overrides
  if (overrides?.correctTool || overrides?.correctArgs) {
    if (expectedToolCalls.length === 0) {
      // Create a new expected tool call from overrides
      expectedToolCalls = [{
        toolName: overrides.correctTool ?? "unknown",
        args: overrides.correctArgs ?? {},
      }];
    } else {
      expectedToolCalls = expectedToolCalls.map((tc: any) => ({
        toolName: overrides.correctTool ?? tc.toolName,
        args: overrides.correctArgs ?? tc.args,
      }));
    }
  }

  const caseId = overrides?.id ??
    `${overrides?.tag ?? "golden"}-${sessionId.slice(0, 8)}-t${turnNumber}`;

  return {
    id: caseId,
    sourceSessionId: sessionId,
    sourceTurn: turnNumber,
    strategy: "golden",
    input: {
      systemPrompt,
      conversationHistory: messages,
      tools: [], // Runner loads from registry at replay time
      model: turn.llmRequest?.model ?? "unknown",
    },
    expected: {
      toolCalls: expectedToolCalls,
      text: turn.llmResponse?.content ?? null,
    },
    metadata: {
      url: turn.snapshot?.url ?? session.startUrl ?? "",
      query: session.query ?? "",
      sessionOutcome: session.outcome ?? "unknown",
      difficulty: "hard",
      tags: ["golden", ...(overrides?.tag ? [overrides.tag] : [])],
      pathology: overrides?.tag,
    },
  };
}

/**
 * Extract and write a golden case to disk.
 * Returns the output file path.
 */
export function extractAndSave(
  sessionIdPrefix: string,
  turnNumber: number,
  overrides?: ExtractOverrides,
): string {
  const evalCase = extractGoldenCase(sessionIdPrefix, turnNumber, overrides);

  if (!existsSync(GOLDEN_DIR)) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
  }

  const filename = `${evalCase.id}.json`;
  const outputPath = join(GOLDEN_DIR, filename);
  writeFileSync(outputPath, JSON.stringify(evalCase, null, 2), "utf-8");

  return outputPath;
}
