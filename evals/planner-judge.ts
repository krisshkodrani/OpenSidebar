/**
 * Planner eval LLM-as-judge.
 *
 * Uses Claude Sonnet via OpenRouter to assess plan quality
 * across 5 dimensions.
 */

import type { PlannerEvalCase, PlannerJudgeScore } from "./types";
import { getPromptTemplate } from "../src/prompts";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const JUDGE_MODEL = "anthropic/claude-sonnet-4-6";

/**
 * Judge a planner decompose result using an LLM.
 */
export async function judgePlannerCase(
  openRouterKey: string,
  evalCase: PlannerEvalCase,
  actual: { subtasks: string[]; steps?: any[]; difficulty: string; isMultiStep: boolean },
): Promise<PlannerJudgeScore> {
  const systemPrompt = getPromptTemplate("evals.planner_judge.system");
  const userTemplate = getPromptTemplate("evals.planner_judge.user");

  const actualPlanText = formatPlan(actual);
  const referencePlanText = evalCase.reference.decomposition
    ? formatPlan({
        subtasks: evalCase.reference.decomposition.subtasks,
        steps: evalCase.reference.decomposition.steps,
        difficulty: evalCase.reference.decomposition.difficulty,
        isMultiStep: true,
      })
    : "(no reference plan available)";

  const te = evalCase.expected.terminationExpectations;
  const terminationContext = te
    ? `Expected: last step calls done = ${te.lastStepCallsDone}, min gates = ${te.minVerificationGates}, all gates = ${te.allStepsHaveGates}, pattern = ${te.pattern ?? "none"}`
    : "(no termination expectations specified)";

  const userMessage = userTemplate
    .replace("{{query}}", evalCase.input.query)
    .replace("{{pageTitle}}", evalCase.input.pageTitle)
    .replace("{{pageUrl}}", evalCase.input.pageUrl)
    .replace("{{perception}}", evalCase.input.perception ?? "(no perception)")
    .replace("{{actualPlan}}", actualPlanText)
    .replace("{{referencePlan}}", referencePlanText)
    .replace("{{sessionOutcome}}", evalCase.reference.sessionOutcome)
    .replace("{{sessionTurnCount}}", String(evalCase.reference.sessionTurnCount))
    .replace("{{terminationContext}}", terminationContext);

  const response = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openRouterKey}`,
      "HTTP-Referer": "https://opensidebar.dev",
      "X-Title": "OpenSidebar Planner Judge",
    },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0,
      max_tokens: 2048,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Judge API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const json = (await response.json()) as any;
  const text = json.choices?.[0]?.message?.content ?? "";

  return parseJudgeResponse(text);
}

function formatPlan(plan: {
  subtasks: string[];
  steps?: any[];
  difficulty: string;
  isMultiStep: boolean;
}): string {
  const lines: string[] = [];
  lines.push(`Difficulty: ${plan.difficulty}`);
  lines.push(`Multi-step: ${plan.isMultiStep}`);
  lines.push("");

  if (plan.steps && plan.steps.length > 0) {
    lines.push("Steps:");
    for (let i = 0; i < plan.steps.length; i++) {
      const s = plan.steps[i];
      lines.push(`  ${i + 1}. ${s.objective ?? "(no objective)"}`);
      if (s.successCriteria) lines.push(`     Success: ${s.successCriteria}`);
      if (s.dependencies?.length) lines.push(`     Deps: [${s.dependencies.join(", ")}]`);
      if (s.verifyAfter) lines.push(`     Verify: "${s.verifyAfter.trigger}" → ${s.verifyAfter.action}`);
    }
  } else {
    lines.push("Subtasks:");
    for (let i = 0; i < plan.subtasks.length; i++) {
      lines.push(`  ${i + 1}. ${plan.subtasks[i]}`);
    }
  }

  return lines.join("\n");
}

function parseJudgeResponse(text: string): PlannerJudgeScore {
  // Try JSON extraction first
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const score: PlannerJudgeScore = {
        planCoherence: clamp(parsed.planCoherence ?? parsed.plan_coherence ?? 0),
        taskAlignment: clamp(parsed.taskAlignment ?? parsed.task_alignment ?? 0),
        granularity: clamp(parsed.granularity ?? 0),
        feasibility: clamp(parsed.feasibility ?? 0),
        robustness: clamp(parsed.robustness ?? 0),
        verificationGateQuality: parsed.verificationGateQuality != null
          ? clamp(parsed.verificationGateQuality) : undefined,
        terminationAwareness: parsed.terminationAwareness != null
          ? clamp(parsed.terminationAwareness) : undefined,
        reasoning: parsed.reasoning ?? "",
        promptFixSuggestion: parsed.promptFixSuggestion ?? parsed.prompt_fix_suggestion,
        pass: false,
      };
      score.pass = score.planCoherence >= 6 && score.taskAlignment >= 6;
      return score;
    } catch {
      // fall through to regex extraction
    }
  }

  // Regex fallback
  const extract = (name: string): number => {
    const match = text.match(new RegExp(`${name}[:\\s]+(\\d+(?:\\.\\d+)?)`, "i"));
    return match ? clamp(parseFloat(match[1])) : 0;
  };

  const vgate = extract("verificationGateQuality") || extract("verification_gate_quality");
  const term = extract("terminationAwareness") || extract("termination_awareness");

  const score: PlannerJudgeScore = {
    planCoherence: extract("planCoherence") || extract("plan_coherence") || extract("coherence"),
    taskAlignment: extract("taskAlignment") || extract("task_alignment") || extract("alignment"),
    granularity: extract("granularity"),
    feasibility: extract("feasibility"),
    robustness: extract("robustness"),
    verificationGateQuality: vgate || undefined,
    terminationAwareness: term || undefined,
    reasoning: text.slice(0, 500),
    pass: false,
  };
  score.pass = score.planCoherence >= 6 && score.taskAlignment >= 6;
  return score;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(10, value));
}
