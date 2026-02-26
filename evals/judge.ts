/**
 * LLM-as-judge for qualitative eval assessment.
 * Uses Claude Sonnet via OpenRouter with a 5-dimension rubric.
 */

import type { EvalCase, JudgeScore } from "./types";
import { getPromptTemplate, renderPrompt } from "../src/prompts";

const JUDGE_MODEL = "anthropic/claude-sonnet-4";
const JUDGE_SYSTEM_PROMPT = getPromptTemplate("evals.judge.system");

interface ToolCallInfo {
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * Run LLM-as-judge on a single eval case.
 * Evaluates across 5 dimensions with prompt fix suggestions.
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
      max_tokens: 1024,
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
    const toolSelection = clamp(parsed.toolSelection ?? 0, 0, 10);
    const antiPatternAvoidance = clamp(parsed.antiPatternAvoidance ?? 0, 0, 10);
    return {
      toolSelection,
      parameterAccuracy: clamp(parsed.parameterAccuracy ?? 0, 0, 10),
      efficiency: clamp(parsed.efficiency ?? 0, 0, 10),
      antiPatternAvoidance,
      reasoningQuality: clamp(parsed.reasoningQuality ?? 0, 0, 10),
      reasoning: parsed.reasoning ?? "",
      promptFixSuggestion: parsed.promptFixSuggestion || undefined,
      pass: toolSelection >= 6 && antiPatternAvoidance >= 6,
    };
  } catch {
    return {
      toolSelection: 0,
      parameterAccuracy: 0,
      efficiency: 0,
      antiPatternAvoidance: 0,
      reasoningQuality: 0,
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

  // Extract visible elements from system prompt (the "## Visible Elements" section)
  const visibleElements = extractSection(evalCase.input.systemPrompt, "## Visible Elements", "##");

  // Truncate system prompt to a useful excerpt (first 2K chars)
  const systemPromptExcerpt = evalCase.input.systemPrompt.slice(0, 2000);

  return renderPrompt("evals.judge.user", {
    query: evalCase.metadata.query,
    url: evalCase.metadata.url,
    strategy: evalCase.strategy,
    expected_tools: expectedTools || "(none)",
    expected_text: evalCase.expected.text?.slice(0, 200) || "(none)",
    actual_tools: actualTools || "(none)",
    actual_text: actual.text?.slice(0, 200) || "(none)",
    system_prompt_excerpt: systemPromptExcerpt || "(empty)",
    visible_elements: visibleElements || "(none)",
    pathology: evalCase.metadata.pathology || "(untagged)",
  });
}

/** Extract a markdown section between two ## headers */
function extractSection(text: string, startHeader: string, nextHeaderPrefix: string): string {
  const startIdx = text.indexOf(startHeader);
  if (startIdx === -1) return "";
  const afterHeader = startIdx + startHeader.length;
  const nextIdx = text.indexOf(nextHeaderPrefix, afterHeader + 1);
  const section = nextIdx === -1
    ? text.slice(afterHeader)
    : text.slice(afterHeader, nextIdx);
  return section.trim().slice(0, 1500); // Cap at 1500 chars
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
