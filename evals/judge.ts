/**
 * LLM-as-judge for qualitative eval assessment.
 * Uses a cheap model via OpenRouter to evaluate failed cases.
 */

import type { EvalCase, JudgeScore } from "./types";
import { getPromptTemplate, renderPrompt } from "../src/prompts";

const JUDGE_MODEL = "openai/gpt-4o-mini";
const JUDGE_SYSTEM_PROMPT = getPromptTemplate("evals.judge.system");

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
          content: JUDGE_SYSTEM_PROMPT,
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
  return renderPrompt("evals.judge.user", {
    query: evalCase.metadata.query,
    url: evalCase.metadata.url,
    strategy: evalCase.strategy,
    expected_tools: expectedTools || "(none)",
    expected_text: evalCase.expected.text?.slice(0, 200) || "(none)",
    actual_tools: actualTools || "(none)",
    actual_text: actual.text?.slice(0, 200) || "(none)",
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
