/**
 * LLM-as-judge for tool-confusion eval assessment.
 * Uses Claude Sonnet 4.6 via OpenRouter with a 4-dimension rubric.
 */

import type { ToolConfusionGoldenCase, ToolConfusionJudgeScore } from "./tool-confusion-types";
import { renderPrompt } from "../src/prompts";

const JUDGE_MODEL = "anthropic/claude-sonnet-4.6";
const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Run LLM-as-judge on a single tool-confusion eval case.
 */
export async function judgeToolConfusionCase(
  apiKey: string,
  goldenCase: ToolConfusionGoldenCase,
  result: {
    toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
    text: string | null;
  },
): Promise<ToolConfusionJudgeScore> {
  const prompt = buildJudgePrompt(goldenCase, result);

  const response = await fetch(OPENROUTER_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://opensidebar.dev",
      "X-Title": "OpenSidebar Tool-Confusion Evals",
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      messages: [
        { role: "system", content: renderPrompt("evals.tool_confusion_judge.system") },
        { role: "user", content: prompt },
      ],
      max_tokens: 1024,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(
      `Tool-confusion judge API error: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as any;
  const content = data.choices?.[0]?.message?.content ?? "";

  try {
    const jsonStr = content
      .replace(/```json\n?/g, "")
      .replace(/```/g, "")
      .trim();
    const parsed = JSON.parse(jsonStr);

    const toolDiscrimination = clamp(parsed.toolDiscrimination ?? 0, 1, 5);
    const contextualReasoning = clamp(parsed.contextualReasoning ?? 0, 1, 5);
    const parameterPrecision = clamp(parsed.parameterPrecision ?? 0, 1, 5);
    const antiPatternAwareness = clamp(parsed.antiPatternAwareness ?? 0, 1, 5);

    return {
      toolDiscrimination,
      contextualReasoning,
      parameterPrecision,
      antiPatternAwareness,
      reasoning: parsed.reasoning ?? "",
      promptFixSuggestion: parsed.promptFixSuggestion || undefined,
      pass: toolDiscrimination >= 4 && antiPatternAwareness >= 4,
    };
  } catch {
    return {
      toolDiscrimination: 1,
      contextualReasoning: 1,
      parameterPrecision: 1,
      antiPatternAwareness: 1,
      reasoning: `Failed to parse judge response: ${content.slice(0, 200)}`,
      pass: false,
    };
  }
}

function buildJudgePrompt(
  goldenCase: ToolConfusionGoldenCase,
  result: {
    toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
    text: string | null;
  },
): string {
  const historyLines = goldenCase.priorHistory
    ? goldenCase.priorHistory
        .map((h, i) => `  T${i + 1}: ${h.tool}(${JSON.stringify(h.args)}) → ${h.result.slice(0, 80)}`)
        .join("\n")
    : "  (no prior history)";

  const agentCalls = result.toolCalls.length > 0
    ? result.toolCalls.map((tc) => `  ${tc.toolName}(${JSON.stringify(tc.args)})`).join("\n")
    : "  (no tool calls)";

  const alternatives = goldenCase.expected.acceptAlternatives?.length
    ? ` (also acceptable: ${goldenCase.expected.acceptAlternatives.join(", ")})`
    : "";

  return `## Tool-Confusion Eval: ${goldenCase.confusionPair.label}

Scenario: ${goldenCase.scenario}
Instruction: ${goldenCase.instruction}
Difficulty: ${goldenCase.difficulty}

### Confusion Pair
- Tool A: ${goldenCase.confusionPair.toolA}
- Tool B: ${goldenCase.confusionPair.toolB}

### Page State
URL: ${goldenCase.snapshot.url}
Title: ${goldenCase.snapshot.title}
Visible content: ${goldenCase.pageContent.slice(0, 500)}

### Prior History
${historyLines}

### Expected Behavior
- Correct tool: ${goldenCase.expected.correctTool}${alternatives}
- Anti-pattern tools: ${goldenCase.expected.antiPatternTools.join(", ")}
- Rationale: ${goldenCase.expected.rationale}

### Agent Response
Tool calls:
${agentCalls}
${result.text ? `Text: ${result.text.slice(0, 400)}` : "(no text)"}

Evaluate the agent's tool discrimination between the confusable pair.`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
