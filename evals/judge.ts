/**
 * LLM-as-judge for qualitative eval assessment.
 * Uses a cheap model via OpenRouter to evaluate failed cases.
 */

import type { EvalCase, JudgeScore } from "./types";

const JUDGE_MODEL = "openai/gpt-4o-mini";

interface ToolCallInfo {
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * Run LLM-as-judge on a single eval case.
 * Evaluates task completion, tool selection, and efficiency.
 */
export async function judgeCase(
  apiKey: string,
  evalCase: EvalCase,
  actual: { toolCalls: ToolCallInfo[]; text: string | null },
): Promise<JudgeScore> {
  const prompt = buildJudgePrompt(evalCase, actual);

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://opensidebar.dev",
      "X-Title": "OpenSidebar Evals",
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      messages: [
        {
          role: "system",
          content: "You are an eval judge for a browser automation agent. Score the agent's response on task completion, tool selection, and efficiency. Respond ONLY with valid JSON.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 512,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    throw new Error(`Judge API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as any;
  const content = data.choices?.[0]?.message?.content ?? "";

  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonStr = content.replace(/```json\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(jsonStr);
    return {
      taskCompletion: clamp(parsed.taskCompletion ?? 0, 0, 10),
      toolSelection: clamp(parsed.toolSelection ?? 0, 0, 10),
      efficiency: clamp(parsed.efficiency ?? 0, 0, 10),
      reasoning: parsed.reasoning ?? "",
      pass: (parsed.taskCompletion ?? 0) >= 6 && (parsed.toolSelection ?? 0) >= 6,
    };
  } catch {
    return {
      taskCompletion: 0,
      toolSelection: 0,
      efficiency: 0,
      reasoning: `Failed to parse judge response: ${content.slice(0, 200)}`,
      pass: false,
    };
  }
}

function buildJudgePrompt(
  evalCase: EvalCase,
  actual: { toolCalls: ToolCallInfo[]; text: string | null },
): string {
  const expectedTools = evalCase.expected.toolCalls
    .map((tc) => `${tc.toolName}(${JSON.stringify(tc.args)})`)
    .join("\n  ");
  const actualTools = actual.toolCalls
    .map((tc) => `${tc.toolName}(${JSON.stringify(tc.args)})`)
    .join("\n  ");

  return `## Context
User query: "${evalCase.metadata.query}"
Current URL: ${evalCase.metadata.url}
Strategy: ${evalCase.strategy}

## Expected response
Tools: ${expectedTools || "(none)"}
Text: ${evalCase.expected.text?.slice(0, 200) || "(none)"}

## Actual response
Tools: ${actualTools || "(none)"}
Text: ${actual.text?.slice(0, 200) || "(none)"}

## Scoring criteria
Score each 0-10:
- taskCompletion: Would this action advance the user's goal?
- toolSelection: Was the right tool chosen for the situation?
- efficiency: Were there unnecessary or redundant steps?

Respond with JSON:
{"taskCompletion": N, "toolSelection": N, "efficiency": N, "reasoning": "..."}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
