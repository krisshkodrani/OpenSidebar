/**
 * LLM-as-judge for grounding eval assessment.
 * Uses Claude Sonnet 4.6 via OpenRouter with a 4-dimension rubric.
 */

import type { GroundingGoldenCase, GroundingJudgeScore } from "./grounding-types";
import { renderPrompt } from "../src/prompts";

const JUDGE_MODEL = "anthropic/claude-sonnet-4.6";
const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Run LLM-as-judge on a single grounding eval case.
 */
export async function judgeGroundingCase(
  apiKey: string,
  goldenCase: GroundingGoldenCase,
  result: {
    toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
    text: string | null;
  },
): Promise<GroundingJudgeScore> {
  const prompt = buildJudgePrompt(goldenCase, result);

  const response = await fetch(OPENROUTER_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://opensidebar.dev",
      "X-Title": "OpenSidebar Grounding Evals",
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      messages: [
        { role: "system", content: renderPrompt("evals.grounding_judge.system") },
        { role: "user", content: prompt },
      ],
      max_tokens: 1024,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(
      `Grounding judge API error: ${response.status} ${response.statusText}`,
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

    const situationalAwareness = clamp(parsed.situationalAwareness ?? 0, 1, 5);
    const contradictionHandling = clamp(parsed.contradictionHandling ?? 0, 1, 5);
    const strategicReasoning = clamp(parsed.strategicReasoning ?? 0, 1, 5);
    const trapResistance = clamp(parsed.trapResistance ?? 0, 1, 5);

    return {
      situationalAwareness,
      contradictionHandling,
      strategicReasoning,
      trapResistance,
      reasoning: parsed.reasoning ?? "",
      promptFixSuggestion: parsed.promptFixSuggestion || undefined,
      pass:
        situationalAwareness >= 3 &&
        strategicReasoning >= 3,
    };
  } catch {
    return {
      situationalAwareness: 1,
      contradictionHandling: 1,
      strategicReasoning: 1,
      trapResistance: 1,
      reasoning: `Failed to parse judge response: ${content.slice(0, 200)}`,
      pass: false,
    };
  }
}

function buildJudgePrompt(
  goldenCase: GroundingGoldenCase,
  result: {
    toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
    text: string | null;
  },
): string {
  // Prior history summary
  const historyLines = goldenCase.priorHistory
    ? goldenCase.priorHistory
        .map((h, i) => `  T${i + 1}: ${h.tool}(${JSON.stringify(h.args)}) → ${h.result.slice(0, 80)}`)
        .join("\n")
    : "  (no prior history)";

  // Agent response
  const agentCalls = result.toolCalls.length > 0
    ? result.toolCalls.map((tc) => `  ${tc.toolName}(${JSON.stringify(tc.args)})`).join("\n")
    : "  (no tool calls)";

  const expected = goldenCase.expected;
  const alternatives = expected.acceptAlternatives?.length
    ? ` (also acceptable: ${expected.acceptAlternatives.join(", ")})`
    : "";

  const traps = expected.trapActions.length > 0
    ? `Trap actions to avoid: ${expected.trapActions.join(", ")}`
    : "No specific trap actions defined";

  return `## Grounding Eval: ${goldenCase.scenario}

Instruction: ${goldenCase.instruction}
Difficulty: ${goldenCase.difficulty}
Should detect mismatch: ${expected.shouldDetectMismatch}

### Page State
URL: ${goldenCase.snapshot.url}
Title: ${goldenCase.snapshot.title}
Visible content: ${goldenCase.pageContent.slice(0, 500)}

### Prior History (what was tried before)
${historyLines}

### Expected Behavior
- Expected first tool: ${expected.expectedTool}${alternatives}
- ${traps}

### Agent Response
Tool calls:
${agentCalls}
${result.text ? `Text: ${result.text.slice(0, 400)}` : "(no text)"}

Evaluate the agent's grounding behavior against the expected behavior.`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
