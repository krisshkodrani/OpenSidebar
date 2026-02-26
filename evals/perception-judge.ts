/**
 * LLM-as-judge for perception eval assessment.
 * Uses Claude Sonnet via OpenRouter with a 5-dimension rubric.
 */

import type { PerceptionEvalCase, PerceptionJudgeScore } from "./types";
import { getPromptTemplate, renderPrompt } from "../src/prompts";

const JUDGE_MODEL = "anthropic/claude-sonnet-4.6";
const JUDGE_SYSTEM_PROMPT = getPromptTemplate("evals.perception_judge.system");

/**
 * Run LLM-as-judge on a single perception eval case.
 * Input is text-only (no screenshot) — judge evaluates consistency
 * between element list, expected annotations, and actual output.
 */
export async function judgePerceptionCase(
  apiKey: string,
  evalCase: PerceptionEvalCase,
  actualInterpretation: string,
): Promise<PerceptionJudgeScore> {
  const prompt = buildPerceptionJudgePrompt(evalCase, actualInterpretation);

  const response = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://opensidebar.dev",
        "X-Title": "OpenSidebar Perception Evals",
      },
      body: JSON.stringify({
        model: JUDGE_MODEL,
        messages: [
          { role: "system", content: JUDGE_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        max_tokens: 1024,
        temperature: 0,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Perception judge API error: ${response.status} ${response.statusText}`,
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

    const accuracy = clamp(parsed.accuracy ?? 0, 0, 10);
    const groundedness = clamp(parsed.groundedness ?? 0, 0, 10);

    return {
      accuracy,
      blockerQuality: clamp(parsed.blockerQuality ?? 0, 0, 10),
      groundedness,
      signalCorrectness: clamp(parsed.signalCorrectness ?? 0, 0, 10),
      conciseness: clamp(parsed.conciseness ?? 0, 0, 10),
      reasoning: parsed.reasoning ?? "",
      promptFixSuggestion: parsed.promptFixSuggestion || undefined,
      pass: accuracy >= 6 && groundedness >= 6,
    };
  } catch {
    return {
      accuracy: 0,
      blockerQuality: 0,
      groundedness: 0,
      signalCorrectness: 0,
      conciseness: 0,
      reasoning: `Failed to parse judge response: ${content.slice(0, 200)}`,
      pass: false,
    };
  }
}

function buildPerceptionJudgePrompt(
  evalCase: PerceptionEvalCase,
  actualInterpretation: string,
): string {
  // Build compact element summary for judge
  const elemLines = evalCase.input.elements
    .slice(0, 50)
    .map(
      (el) =>
        `[${el.tag}] ${el.tagName}${el.role ? ` role=${el.role}` : ""} "${el.text.slice(0, 40)}"`,
    );
  const elementSummary =
    elemLines.join("\n") +
    (evalCase.input.elements.length > 50
      ? `\n... (${evalCase.input.elements.length - 50} more)`
      : "");

  // Build expected annotations summary
  const expectedParts: string[] = [];
  expectedParts.push(`Mode: ${evalCase.expected.mode}`);
  expectedParts.push(`Required sections: ${evalCase.expected.requiredSections.join(", ")}`);
  if (evalCase.expected.pageType) {
    expectedParts.push(`Page type: ${evalCase.expected.pageType}`);
  }
  if (evalCase.expected.blockers && evalCase.expected.blockers.length > 0) {
    expectedParts.push(
      `Blockers:\n${evalCase.expected.blockers.map((b) => `  ${b.type}${b.tagId !== undefined ? ` [${b.tagId}]` : ""}: ${b.description}`).join("\n")}`,
    );
  }
  if (evalCase.expected.completionSignal) {
    expectedParts.push(
      `Completion signal: ${evalCase.expected.completionSignal.status} (${evalCase.expected.completionSignal.scope})`,
    );
  }
  if (evalCase.expected.mustMentionElements) {
    expectedParts.push(
      `Must mention elements: ${evalCase.expected.mustMentionElements.map((id) => `[${id}]`).join(", ")}`,
    );
  }
  if (evalCase.expected.notes) {
    expectedParts.push(`Notes: ${evalCase.expected.notes}`);
  }

  return renderPrompt("evals.perception_judge.user", {
    url: evalCase.input.url,
    title: evalCase.input.title,
    query: evalCase.metadata.query,
    mode: evalCase.expected.mode,
    elements: elementSummary,
    expected: expectedParts.join("\n"),
    actual: actualInterpretation.slice(0, 2000),
    reference: evalCase.reference.interpretation.slice(0, 2000),
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
