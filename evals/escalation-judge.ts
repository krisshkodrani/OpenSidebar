/**
 * LLM-as-judge for escalation eval assessment.
 * Uses Claude Sonnet 4.6 via OpenRouter with a 4-dimension rubric.
 */

import type { EscalationGoldenCase, EscalationJudgeScore } from "./escalation-types";

const JUDGE_MODEL = "anthropic/claude-sonnet-4.6";
const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT = `You are an expert evaluator for a browser automation agent's escalation behavior.
The agent has a two-tier model system: an executor model handles routine tasks, and when it gets stuck,
it should escalate to a planner model that uses investigation tools to recover.

You assess two phases:
1. Executor model: Did it recognize it was stuck and call the "escalate" tool?
2. Planner model: Did it use a different strategy (investigation tools) to recover?

Score each dimension 1-5:
- stuckRecognition: Did the executor model recognize it was stuck and escalate appropriately?
- strategyShift: Did the planner model use a fundamentally different approach from the failed attempts?
- investigationDepth: Did the planner model use investigation/diagnostic tools to understand the problem?
- contextUsage: Did the planner model effectively use the distilled trajectory context?

Return ONLY a JSON object (no markdown fences):
{
  "stuckRecognition": <1-5>,
  "strategyShift": <1-5>,
  "investigationDepth": <1-5>,
  "contextUsage": <1-5>,
  "reasoning": "<brief explanation>",
  "promptFixSuggestion": "<optional suggestion to improve the agent prompt>",
  "pass": <true/false>
}

pass = true if stuckRecognition >= 3 AND strategyShift >= 3 AND investigationDepth >= 3`;

/**
 * Run LLM-as-judge on a single escalation eval case.
 */
export async function judgeEscalationCase(
  apiKey: string,
  goldenCase: EscalationGoldenCase,
  fastResult: {
    toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
    text: string | null;
  },
  smartResult: {
    toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
    text: string | null;
  },
): Promise<EscalationJudgeScore> {
  const prompt = buildJudgePrompt(goldenCase, fastResult, smartResult);

  const response = await fetch(OPENROUTER_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://opensidebar.dev",
      "X-Title": "OpenSidebar Escalation Evals",
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_tokens: 1024,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(
      `Escalation judge API error: ${response.status} ${response.statusText}`,
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

    const stuckRecognition = clamp(parsed.stuckRecognition ?? 0, 1, 5);
    const strategyShift = clamp(parsed.strategyShift ?? 0, 1, 5);
    const investigationDepth = clamp(parsed.investigationDepth ?? 0, 1, 5);
    const contextUsage = clamp(parsed.contextUsage ?? 0, 1, 5);

    return {
      stuckRecognition,
      strategyShift,
      investigationDepth,
      contextUsage,
      reasoning: parsed.reasoning ?? "",
      promptFixSuggestion: parsed.promptFixSuggestion || undefined,
      pass:
        stuckRecognition >= 3 &&
        strategyShift >= 3 &&
        investigationDepth >= 3,
    };
  } catch {
    return {
      stuckRecognition: 1,
      strategyShift: 1,
      investigationDepth: 1,
      contextUsage: 1,
      reasoning: `Failed to parse judge response: ${content.slice(0, 200)}`,
      pass: false,
    };
  }
}

function buildJudgePrompt(
  goldenCase: EscalationGoldenCase,
  fastResult: {
    toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
    text: string | null;
  },
  smartResult: {
    toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
    text: string | null;
  },
): string {
  // Stagnant history summary
  const historyLines = goldenCase.fastPhase.stagnantHistory
    .map((h, i) => `  T${i + 1}: ${h.tool}(${JSON.stringify(h.args)}) → ${h.result.slice(0, 80)}`)
    .join("\n");

  // Executor model response
  const fastCalls = fastResult.toolCalls.length > 0
    ? fastResult.toolCalls.map((tc) => `  ${tc.toolName}(${JSON.stringify(tc.args)})`).join("\n")
    : "  (no tool calls)";

  // Planner model response
  const smartCalls = smartResult.toolCalls.length > 0
    ? smartResult.toolCalls.map((tc) => `  ${tc.toolName}(${JSON.stringify(tc.args)})`).join("\n")
    : "  (no tool calls)";

  const expected = goldenCase.expectedSmartAction;
  const alternatives = expected.acceptAlternatives?.length
    ? ` (also acceptable: ${expected.acceptAlternatives.join(", ")})`
    : "";

  return `## Escalation Eval: ${goldenCase.scenario}

Objective: ${goldenCase.fastPhase.objective}
Difficulty: ${goldenCase.difficulty}
Escalation reason: ${goldenCase.smartPhase.escalationReason}

### Stagnant History (what failed before escalation)
${historyLines}

### Expected Behavior
- Executor model should call: escalate
- Planner model should call: ${expected.toolName}${alternatives}

### Phase 1: Executor Model Response
Tool calls:
${fastCalls}
${fastResult.text ? `Text: ${fastResult.text.slice(0, 300)}` : "(no text)"}

### Phase 2: Planner Model Response
Tool calls:
${smartCalls}
${smartResult.text ? `Text: ${smartResult.text.slice(0, 300)}` : "(no text)"}

Evaluate both phases against the expected behavior.`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
