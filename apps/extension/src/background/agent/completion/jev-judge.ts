import type { JudgeRubric, JudgeUsage, JudgeVerdict } from "./judge";

export interface JevDecisionResponse {
  answers?: Record<string, { type?: string; noul?: number; choice?: string }>;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cost?: number };
}

export async function requestJevVerdict(
  rubric: JudgeRubric,
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): Promise<JudgeVerdict> {
  if (!apiKey || apiKey === "__opensidebar_cloud__") {
    throw new Error("Jev Decisions API requires a direct OpenRouter key");
  }
  const response = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      state: { claim: rubric.claim, evidence: rubric.evidence, corpusFacts: rubric.corpusFacts },
      questions: jevQuestions(rubric),
    }),
    signal,
  });
  if (!response.ok) throw new Error(`Jev Decisions API returned HTTP ${response.status}`);
  const data = await response.json() as JevDecisionResponse;
  return { ...parseJevVerdict(rubric, data), model: data.model ?? model, providerId: "openrouter" };
}

/** Build independent, typed questions; keep IDs local to this request. */
export function jevQuestions(rubric: JudgeRubric) {
  const questions: Record<string, object> = {};
  rubric.criteria.forEach((criterion, index) => {
    questions[`criterion_${index}`] = {
      type: "noul",
      instructions: `Does the evidence establish this completed outcome: ${criterion.description}? Judge the end state, not effort. A preserved earlier view may establish a prerequisite replaced by a later state. An unsupported claim fails.`,
      criteria: {
        true: "Concrete evidence establishes the described outcome.",
        false: "The evidence is missing, ambiguous, or contradicts the outcome.",
      },
    };
  });
  rubric.corpusFacts.forEach((fact, index) => {
    questions[`fact_${index}`] = {
      type: "choice",
      instructions: `How does the evidence relate to this corpus fact: ${fact}?`,
      criteria: {
        entailed: "The evidence agrees with the fact.",
        contradicted: "The evidence conflicts with the fact.",
        unsupported: "The evidence is silent or inconclusive about the fact.",
      },
    };
  });
  return questions;
}

export function parseJevVerdict(
  rubric: JudgeRubric,
  response: JevDecisionResponse,
): Pick<JudgeVerdict, "pass" | "perCriterion" | "entailment" | "confidence" | "source" | "usage"> {
  const answers = response.answers;
  if (!answers) throw new Error("Jev response has no answers");
  const perCriterion = rubric.criteria.map((criterion, index) => {
    const answer = answers[`criterion_${index}`];
    if (answer?.type !== "noul" || typeof answer.noul !== "number" ||
      !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) {
      throw new Error(`Invalid Jev criterion_${index} answer`);
    }
    return { id: criterion.id, pass: answer.noul >= 0.5,
      rationale: `Jev probability ${answer.noul.toFixed(3)} (uncalibrated 0.5 threshold)` };
  });
  const entailment = rubric.corpusFacts.map((fact, index) => {
    const answer = answers[`fact_${index}`];
    if (answer?.type !== "choice" || !["entailed", "contradicted", "unsupported"].includes(answer.choice ?? "")) {
      throw new Error(`Invalid Jev fact_${index} answer`);
    }
    return { claimKey: fact, label: answer.choice as "entailed" | "contradicted" | "unsupported" };
  });
  const rawUsage = response.usage;
  const usage: JudgeUsage | undefined = rawUsage &&
    Number.isFinite(rawUsage.input_tokens) && Number.isFinite(rawUsage.output_tokens)
    ? {
        promptTokens: rawUsage.input_tokens ?? 0,
        completionTokens: rawUsage.output_tokens ?? 0,
        totalTokens: (rawUsage.input_tokens ?? 0) + (rawUsage.output_tokens ?? 0),
        ...(typeof rawUsage.cost === "number" && Number.isFinite(rawUsage.cost) && rawUsage.cost >= 0
          ? { costUsd: rawUsage.cost, costSource: "actual" as const }
          : { costUsd: (rawUsage.input_tokens ?? 0) * 0.042 / 1_000_000, costSource: "estimated" as const }),
      }
    : undefined;
  return {
    pass: rubric.criteria.filter((c) => c.required).every((c) => perCriterion.find((v) => v.id === c.id)?.pass),
    perCriterion,
    entailment,
    confidence: perCriterion.length ? Math.min(...perCriterion.map((_, i) =>
      Math.abs((answers[`criterion_${i}`].noul ?? 0.5) - 0.5) * 2)) : 0,
    source: "judge",
    usage,
  };
}
