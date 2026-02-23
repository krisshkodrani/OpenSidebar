/**
 * Golden Builder — converts enriched GoldenAction[] into EvalCase[] for the eval pipeline.
 *
 * Pure functions: no side effects, no chrome APIs.
 */

import type { GoldenAction, ToolName, DomSnapshot } from "../../types";
import type { EvalCase } from "../../../evals/types";
import type { LLMMessage } from "../llm/types";
import type { ToolDefinition } from "../../types";
import { formatSnapshotElements } from "../agent/context";

// --- Action → Tool Call Mapping ---

interface ExpectedToolCall {
  toolName: ToolName;
  args: Record<string, unknown>;
}

/**
 * Map a DemoAction + tagId to the tool call the agent would make.
 */
export function actionToToolCall(
  action: GoldenAction["action"],
  tagId: number | null,
): ExpectedToolCall | null {
  switch (action.type) {
    case "click":
      if (tagId == null) return null;
      return { toolName: "click_element" as ToolName, args: { id: tagId } };

    case "type":
      if (tagId == null || !action.value) return null;
      return {
        toolName: "type_text" as ToolName,
        args: { id: tagId, text: action.value },
      };

    case "scroll":
      return {
        toolName: "scroll_page" as ToolName,
        args: {
          direction: (action.scrollDelta ?? 0) > 0 ? "down" : "up",
          amount: Math.abs(action.scrollDelta ?? 500),
        },
      };

    case "select":
      if (tagId == null || !action.value) return null;
      return {
        toolName: "select_option" as ToolName,
        args: { id: tagId, value: action.value },
      };

    case "press_key": {
      if (!action.key) return null;
      const modifiers: string[] = [];
      if (action.value) {
        for (const mod of action.value.split("+")) {
          if (mod) modifiers.push(mod);
        }
      }
      const args: Record<string, unknown> = { key: action.key };
      if (modifiers.length > 0) args.modifiers = modifiers;
      return { toolName: "press_key" as ToolName, args };
    }

    case "navigate":
      return {
        toolName: "navigate" as ToolName,
        args: { url: action.url },
      };

    case "annotate":
      return null;

    default:
      return null;
  }
}

// --- System Prompt Builder ---

function buildSystemPromptFromSnapshot(snapshot: DomSnapshot): string {
  const elements = formatSnapshotElements(snapshot.elements);
  const visibleContent = snapshot.visibleContent
    ? `\n\nVisible content:\n${snapshot.visibleContent.slice(0, 3000)}`
    : "";

  return [
    `Page: ${snapshot.title}`,
    `URL: ${snapshot.url}`,
    `Viewport: ${snapshot.viewport.width}x${snapshot.viewport.height}`,
    `Scroll: ${snapshot.scroll.y}/${snapshot.scroll.maxY}`,
    "",
    "Interactive elements:",
    elements,
    visibleContent,
  ].join("\n");
}

// --- Conversation History Builder ---

/**
 * Build the conversation history the agent would have at turn N.
 * Includes the user query + prior tool call/result pairs.
 */
export function buildConversationHistory(
  priorActions: GoldenAction[],
  query: string,
): LLMMessage[] {
  const messages: LLMMessage[] = [{ role: "user", content: query }];

  for (let i = 0; i < priorActions.length; i++) {
    const ga = priorActions[i];

    // Annotations become user-role messages in conversation history
    if (ga.action.type === "annotate") {
      messages.push({
        role: "user",
        content: `[Annotation] ${ga.action.value ?? ""}`,
      });
      continue;
    }

    const toolCall = actionToToolCall(ga.action, ga.tagId);
    if (!toolCall) continue;

    const toolCallId = `golden-tc-${i}`;
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: toolCallId,
          type: "function",
          function: {
            name: toolCall.toolName,
            arguments: JSON.stringify(toolCall.args),
          },
        },
      ],
    });
    messages.push({
      role: "tool",
      tool_call_id: toolCallId,
      content: "OK",
    });
  }

  return messages;
}

// --- Main Builder ---

/**
 * Convert a sequence of golden actions into EvalCase objects.
 *
 * @param actions - Enriched golden actions from recording
 * @param name - Demo name (used as query and in case IDs)
 * @param screenshot - Optional base64 screenshot for reference
 * @param tools - Tool definitions to include in eval cases
 */
export function buildGoldenCases(
  actions: GoldenAction[],
  name: string,
  _screenshot: string | null,
  tools: ToolDefinition[],
): EvalCase[] {
  const cases: EvalCase[] = [];
  const sessionId = `golden-${name.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}`;

  // Collect annotation texts between DOM actions to attach as notes
  let pendingAnnotations: string[] = [];

  for (let i = 0; i < actions.length; i++) {
    const ga = actions[i];

    // Accumulate annotations — they'll attach to the next eval case
    if (ga.action.type === "annotate") {
      pendingAnnotations.push(ga.action.value ?? "");
      continue;
    }

    const toolCall = actionToToolCall(ga.action, ga.tagId);
    if (!toolCall) continue;

    const systemPrompt = buildSystemPromptFromSnapshot(ga.snapshot);
    const conversationHistory = buildConversationHistory(
      actions.slice(0, i),
      name,
    );

    const caseId = `${sessionId}-${String(i + 1).padStart(3, "0")}`;

    const evalCase: EvalCase = {
      id: caseId,
      sourceSessionId: sessionId,
      sourceTurn: i + 1,
      strategy: "golden",
      input: {
        systemPrompt,
        conversationHistory,
        tools,
        model: "golden-recording",
      },
      expected: {
        toolCalls: [toolCall],
        text: null,
      },
      metadata: {
        url: ga.action.url,
        query: name,
        sessionOutcome: "golden",
        difficulty: i === 0 ? "easy" : "medium",
        tags: ["golden", name.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()],
      },
    };

    // Attach pending annotations as notes
    if (pendingAnnotations.length > 0) {
      evalCase.promptQuality = {
        notes: pendingAnnotations.join(" | "),
      };
      pendingAnnotations = [];
    }

    cases.push(evalCase);
  }

  // Trailing annotations attach to the last case
  if (pendingAnnotations.length > 0 && cases.length > 0) {
    const lastCase = cases[cases.length - 1];
    const existingNotes = lastCase.promptQuality?.notes;
    lastCase.promptQuality = {
      ...lastCase.promptQuality,
      notes: existingNotes
        ? `${existingNotes} | ${pendingAnnotations.join(" | ")}`
        : pendingAnnotations.join(" | "),
    };
  }

  return cases;
}
