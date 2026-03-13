/**
 * LLM-as-judge for perception eval assessment.
 * Uses Claude Sonnet via OpenRouter with a v6 production rubric.
 */

import type { PerceptionEvalCase, PerceptionJudgeScore } from "./types";
import { getPromptTemplate, renderPrompt } from "../src/prompts";

const JUDGE_MODEL = "anthropic/claude-sonnet-4.6";
const JUDGE_SYSTEM_PROMPT = getPromptTemplate("evals.perception_judge.system");

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

    const locationAccuracy = clamp(parsed.locationAccuracy ?? 0, 0, 10);
    const changeAccuracy = clamp(parsed.changeAccuracy ?? 0, 0, 10);
    const blockerQuality = clamp(parsed.blockerQuality ?? 0, 0, 10);
    const affordanceUsefulness = clamp(parsed.affordanceUsefulness ?? 0, 0, 10);
    const groundedness = clamp(parsed.groundedness ?? 0, 0, 10);
    const conciseness = clamp(parsed.conciseness ?? 0, 0, 10);

    return {
      locationAccuracy,
      changeAccuracy,
      blockerQuality,
      affordanceUsefulness,
      groundedness,
      conciseness,
      reasoning: parsed.reasoning ?? "",
      promptFixSuggestion: parsed.promptFixSuggestion || undefined,
      pass:
        locationAccuracy >= 6 &&
        blockerQuality >= 6 &&
        groundedness >= 6,
    };
  } catch {
    return {
      locationAccuracy: 0,
      changeAccuracy: 0,
      blockerQuality: 0,
      affordanceUsefulness: 0,
      groundedness: 0,
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

  const expectedParts: string[] = [];
  expectedParts.push(`Required sections: ${evalCase.expected.requiredSections.join(", ")}`);
  if (evalCase.expected.pageType) {
    expectedParts.push(`Page type: ${evalCase.expected.pageType}`);
  }
  if (evalCase.expected.blockers && evalCase.expected.blockers.length > 0) {
    expectedParts.push(
      `Expected blockers:\n${evalCase.expected.blockers.map((b) => `  ${b.type}${b.tagId !== undefined ? ` [${b.tagId}]` : ""}: ${b.description}`).join("\n")}`,
    );
  }
  if (evalCase.expected.mustMentionElements && evalCase.expected.mustMentionElements.length > 0) {
    expectedParts.push(
      `Must mention affordances: ${evalCase.expected.mustMentionElements.map((id) => `[${id}]`).join(", ")}`,
    );
  }
  if (evalCase.expected.visualOnlyContent && evalCase.expected.visualOnlyContent.length > 0) {
    expectedParts.push(
      `Expected visual-only facts: ${evalCase.expected.visualOnlyContent.join(" | ")}`,
    );
  }
  if (evalCase.expected.notes) {
    expectedParts.push(`Notes: ${evalCase.expected.notes}`);
  }

  return renderPrompt("evals.perception_judge.user", {
    url: evalCase.input.url,
    title: evalCase.input.title,
    query: evalCase.metadata.query,
    elements: elementSummary,
    expected: expectedParts.join("\n"),
    actual: actualInterpretation.slice(0, 2000),
    reference: evalCase.reference.interpretation.slice(0, 2000),
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
