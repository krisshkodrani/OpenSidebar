/**
 * LLM-as-judge for E2E eval assessment.
 * Uses Claude Sonnet via OpenRouter with a 4-dimension rubric.
 */

import type { E2EGoldenCase, E2EJudgeScore } from "./e2e-types";
import { renderPrompt } from "../src/prompts";

const JUDGE_MODEL = "anthropic/claude-sonnet-4.6";
const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Run LLM-as-judge on a single E2E eval case.
 */
export async function judgeE2ECase(
  apiKey: string,
  goldenCase: E2EGoldenCase,
  actualToolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
  actualText: string | null,
): Promise<E2EJudgeScore> {
  const prompt = buildJudgePrompt(goldenCase, actualToolCalls, actualText);

  const response = await fetch(OPENROUTER_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://opensidebar.dev",
      "X-Title": "OpenSidebar E2E Evals",
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      messages: [
        { role: "system", content: renderPrompt("evals.e2e_judge.system") },
        { role: "user", content: prompt },
      ],
      max_tokens: 1024,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(
      `E2E judge API error: ${response.status} ${response.statusText}`,
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

    const puzzleSolving = clamp(parsed.puzzleSolving ?? 0, 1, 5);
    const codeIdentification = clamp(parsed.codeIdentification ?? 0, 1, 5);
    const actionPrecision = clamp(parsed.actionPrecision ?? 0, 1, 5);
    const distractorAvoidance = clamp(parsed.distractorAvoidance ?? 0, 1, 5);

    return {
      puzzleSolving,
      codeIdentification,
      actionPrecision,
      distractorAvoidance,
      reasoning: parsed.reasoning ?? "",
      promptFixSuggestion: parsed.promptFixSuggestion || undefined,
      pass:
        puzzleSolving >= 3 &&
        codeIdentification >= 3 &&
        actionPrecision >= 3,
    };
  } catch {
    return {
      puzzleSolving: 1,
      codeIdentification: 1,
      actionPrecision: 1,
      distractorAvoidance: 1,
      reasoning: `Failed to parse judge response: ${content.slice(0, 200)}`,
      pass: false,
    };
  }
}

function buildJudgePrompt(
  goldenCase: E2EGoldenCase,
  actualToolCalls: Array<{ toolName: string; args: Record<string, unknown> }>,
  actualText: string | null,
): string {
  // Compact element summary
  const elemLines = goldenCase.entryElements
    .slice(0, 40)
    .map(
      (el) =>
        `[${el.tag}] ${el.tagName} role=${el.role} "${el.text.slice(0, 40)}"` +
        (el.isDisabled ? " [disabled]" : ""),
    );
  const elementSummary =
    elemLines.join("\n") +
    (goldenCase.entryElements.length > 40
      ? `\n... (${goldenCase.entryElements.length - 40} more)`
      : "");

  // Ground truth
  const expectedSequence = goldenCase.actions.sequence
    .map((a) => `  ${a.tool}(${JSON.stringify(a.args)})`)
    .join("\n");

  // Actual response
  const actualSequence = actualToolCalls.length > 0
    ? actualToolCalls
        .map((tc) => `  ${tc.toolName}(${JSON.stringify(tc.args)})`)
        .join("\n")
    : "  (no tool calls)";

  return `## Challenge Step ${goldenCase.stepNumber}

URL: ${goldenCase.challengeUrl}
Title: ${goldenCase.entrySnapshot.title}

### Solution
- Hidden code: "${goldenCase.solution.code}"
- Code input element: [${goldenCase.solution.codeInputId}]
- Submit button: [${goldenCase.solution.submitButtonId}]

### Page Elements
${elementSummary}

### Expected Action Sequence (${goldenCase.actions.total} actions, ${goldenCase.actions.exploration} exploration + ${goldenCase.actions.solutionPhase} solution)
${expectedSequence}

### Actual Agent Response
Tool calls:
${actualSequence}

${actualText ? `Text output:\n${actualText.slice(0, 500)}` : "(no text output)"}

Evaluate the agent's response against the ground truth.`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
