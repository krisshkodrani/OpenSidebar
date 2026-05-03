import { ToolCall } from "../../types";
import { CompletionResponse } from "../llm/types";
import { extractThinkContent, stripThinkTags } from "../llm";
import { recoverToolCallsFromText } from "./tool-recovery";

export type NormalizedResponseContent = {
  rawContent: string | null;
  cleanContent: string | null;
  thinkingContent: string | null;
  hadThinking: boolean;
};

export type ToolCallRecoveryResult = {
  recovered: boolean;
  recoveredToolCalls: ToolCall[];
  cleanContent: string | null;
};

export function isEmptyCompletionResponse(
  response: CompletionResponse,
): boolean {
  return (
    !response.content &&
    (!response.tool_calls || response.tool_calls.length === 0)
  );
}

export function normalizeResponseContent(
  response: CompletionResponse,
): NormalizedResponseContent {
  const rawContent = response.content;
  const cleanContent = rawContent ? stripThinkTags(rawContent) || null : null;
  const thinkingContent = rawContent ? extractThinkContent(rawContent) : null;

  return {
    rawContent,
    cleanContent,
    thinkingContent,
    hadThinking: thinkingContent !== null,
  };
}

export function summarizeToolCalls(
  toolCalls: ToolCall[] | undefined,
  maxArgumentChars: number,
): string[] {
  return (
    toolCalls?.map((toolCall) => {
      let argSnippet = "";
      try {
        argSnippet = toolCall.function.arguments.slice(0, maxArgumentChars);
      } catch {
        /* best effort summary */
      }
      return `${toolCall.function.name}(${argSnippet})`;
    }) ?? []
  );
}

export function recoverResponseToolCallsFromText(
  response: CompletionResponse,
  cleanContent: string | null,
): ToolCallRecoveryResult {
  if (response.tool_calls?.length || !cleanContent) {
    return {
      recovered: false,
      recoveredToolCalls: [],
      cleanContent,
    };
  }

  const recoveredToolCalls = recoverToolCallsFromText(cleanContent) ?? [];
  if (recoveredToolCalls.length === 0) {
    return {
      recovered: false,
      recoveredToolCalls: [],
      cleanContent,
    };
  }

  response.tool_calls = recoveredToolCalls;
  response.content = null;

  return {
    recovered: true,
    recoveredToolCalls,
    cleanContent: null,
  };
}
