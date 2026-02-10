/**
 * LLM-as-Judge Critique Model
 *
 * Uses openai/gpt-5-mini via OpenRouter to evaluate agent outputs
 * with structured reasoning. Produces a JudgeVerdict for each evaluation case.
 */

import { LLMClient } from "../../src/background/llm/client.js";
import type { LLMMessage } from "../../src/background/llm/types.js";
import type { GoldenCase, EvaluationResult, JudgeVerdict } from "./types.js";

const JUDGE_SYSTEM_PROMPT = `You are an evaluation judge for a browser automation agent. Given the user's task, the page context, expected behavior, and actual agent behavior, evaluate the agent's performance.

Score each dimension 0-10. Return ONLY a JSON object with these fields:
- task_completion (0-10): Did the agent accomplish what the user asked?
- tool_selection (0-10): Were the tools chosen appropriate?
- efficiency (0-10): Was the approach minimal and direct?
- reasoning: Brief explanation of your evaluation
- issues: Array of specific problems found (empty array if none)
- overall_pass: true if task_completion >= 7 and no critical issues

Be lenient about alternative valid approaches. The agent may use different tool sequences than expected if the result is equivalent.`;

/**
 * Build the user message for the judge from test case + actual result
 */
function buildJudgePrompt(
  testCase: GoldenCase,
  result: EvaluationResult,
): string {
  const expectedTools = testCase.expected.tool_calls
    ?.map(
      (tc) =>
        `  - ${tc.tool}(${JSON.stringify(tc.params)})${tc.optional ? " [optional]" : ""}`,
    )
    .join("\n") || "  (none specified)";

  const actualTools = result.details.actual_tool_calls
    .map((tc) => `  - ${tc.tool}(${JSON.stringify(tc.params)}) → ${tc.success ? "OK" : "FAIL"}`)
    .join("\n") || "  (none)";

  // Truncate HTML to ~2000 chars to stay within token budget
  const htmlSnippet = testCase.input.dom_snapshot.length > 2000
    ? testCase.input.dom_snapshot.slice(0, 2000) + "\n... (truncated)"
    : testCase.input.dom_snapshot;

  return `## Task
User query: "${testCase.input.user_query}"
Page URL: ${testCase.input.url}

## Page HTML (truncated)
${htmlSnippet}

## Expected Behavior
Expected tool calls:
${expectedTools}
Expected outcome: ${testCase.expected.outcome ? JSON.stringify(testCase.expected.outcome) : "not specified"}
Expected text: ${testCase.expected.assistant_text || "not specified"}

## Actual Behavior
Actual tool calls:
${actualTools}
Actual text output: ${result.details.actual_text || "(none)"}
Actual outcome: ${JSON.stringify(result.details.actual_outcome)}

## Algorithmic Metrics
Tool accuracy: ${result.metrics.tool_accuracy !== undefined ? (result.metrics.tool_accuracy * 100).toFixed(1) + "%" : "N/A"}
Text similarity: ${result.metrics.text_similarity !== undefined ? (result.metrics.text_similarity * 100).toFixed(1) + "%" : "N/A"}
Outcome match: ${result.metrics.outcome_match !== undefined ? result.metrics.outcome_match : "N/A"}

Evaluate the agent's performance and return a JSON verdict.`;
}

/**
 * Parse the judge's response into a JudgeVerdict
 */
function parseJudgeResponse(content: string): JudgeVerdict {
  // Try to extract JSON from the response (handles markdown code blocks)
  let jsonStr = content.trim();

  // Strip markdown code fences if present
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr);

  return {
    task_completion: clampScore(parsed.task_completion),
    tool_selection: clampScore(parsed.tool_selection),
    efficiency: clampScore(parsed.efficiency),
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    issues: Array.isArray(parsed.issues)
      ? parsed.issues.filter((i: unknown) => typeof i === "string")
      : [],
    overall_pass: Boolean(parsed.overall_pass),
  };
}

function clampScore(val: unknown): number {
  const n = Number(val);
  if (isNaN(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n)));
}

/**
 * JudgeModel - evaluates agent outputs using LLM-as-Judge
 */
export class JudgeModel {
  private llm: LLMClient;

  constructor(openRouterApiKey: string) {
    this.llm = new LLMClient(openRouterApiKey, "openrouter", "openai/gpt-5-mini");
  }

  /**
   * Evaluate a single case result and produce a JudgeVerdict
   */
  async evaluate(
    testCase: GoldenCase,
    result: EvaluationResult,
  ): Promise<JudgeVerdict> {
    const messages: LLMMessage[] = [
      { role: "system", content: JUDGE_SYSTEM_PROMPT },
      { role: "user", content: buildJudgePrompt(testCase, result) },
    ];

    try {
      const response = await this.llm.complete({
        messages,
        temperature: 0.0,
        max_tokens: 500,
      });

      if (!response.content) {
        return fallbackVerdict("Judge returned empty response");
      }

      return parseJudgeResponse(response.content);
    } catch (error) {
      return fallbackVerdict(
        `Judge error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/**
 * Produce a conservative fallback verdict when the judge fails
 */
function fallbackVerdict(reason: string): JudgeVerdict {
  return {
    task_completion: 5,
    tool_selection: 5,
    efficiency: 5,
    reasoning: reason,
    issues: [reason],
    overall_pass: false,
  };
}
