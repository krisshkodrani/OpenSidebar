/**
 * LLM-as-judge for completion-timing eval assessment.
 * Uses Claude Sonnet 4.6 via OpenRouter with a 4-dimension rubric.
 */

import type {
  CompletionTimingGoldenCase,
  CompletionTimingJudgeScore,
} from "./completion-timing-types";

const JUDGE_MODEL = "anthropic/claude-sonnet-4.6";
const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT = `You are an expert evaluator for a browser automation agent's completion-timing behavior.
The agent must decide when a task is truly done vs when it should keep working. Two failure modes exist:
1. Premature termination: calling done() before all subtasks are complete
2. Over-continuation: continuing to act after the task is already finished

You assess the agent's single decision point: given a page state, action history, and plan status,
did it correctly decide to call done() or continue acting?

Score each dimension 1-5:
- completionRecognition: Did the agent correctly identify whether the task was complete?
- timingAccuracy: Was the timing of the done/continue decision appropriate given the evidence?
- summarySpecificity: For done cases — does the summary cite concrete evidence? For continue — does reasoning show what's left?
- planAdherence: Did the agent respect the plan status (pending vs completed subtasks)?

Return ONLY a JSON object (no markdown fences):
{
  "completionRecognition": <1-5>,
  "timingAccuracy": <1-5>,
  "summarySpecificity": <1-5>,
  "planAdherence": <1-5>,
  "reasoning": "<brief explanation>",
  "promptFixSuggestion": "<optional suggestion to improve the agent prompt>",
  "pass": <true/false>
}

pass = true if completionRecognition >= 3 AND timingAccuracy >= 3 AND planAdherence >= 3`;

/**
 * Run LLM-as-judge on a single completion-timing eval case.
 */
export async function judgeCompletionTimingCase(
  apiKey: string,
  goldenCase: CompletionTimingGoldenCase,
  result: {
    toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
    text: string | null;
  },
): Promise<CompletionTimingJudgeScore> {
  const prompt = buildJudgePrompt(goldenCase, result);

  const response = await fetch(OPENROUTER_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://opensidebar.dev",
      "X-Title": "OpenSidebar Completion-Timing Evals",
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
      `Completion-timing judge API error: ${response.status} ${response.statusText}`,
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

    const completionRecognition = clamp(parsed.completionRecognition ?? 0, 1, 5);
    const timingAccuracy = clamp(parsed.timingAccuracy ?? 0, 1, 5);
    const summarySpecificity = clamp(parsed.summarySpecificity ?? 0, 1, 5);
    const planAdherence = clamp(parsed.planAdherence ?? 0, 1, 5);

    return {
      completionRecognition,
      timingAccuracy,
      summarySpecificity,
      planAdherence,
      reasoning: parsed.reasoning ?? "",
      promptFixSuggestion: parsed.promptFixSuggestion || undefined,
      pass:
        completionRecognition >= 3 &&
        timingAccuracy >= 3 &&
        planAdherence >= 3,
    };
  } catch {
    return {
      completionRecognition: 1,
      timingAccuracy: 1,
      summarySpecificity: 1,
      planAdherence: 1,
      reasoning: `Failed to parse judge response: ${content.slice(0, 200)}`,
      pass: false,
    };
  }
}

function buildJudgePrompt(
  goldenCase: CompletionTimingGoldenCase,
  result: {
    toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
    text: string | null;
  },
): string {
  // Action history summary
  const historyLines = goldenCase.actionHistory
    .map((h, i) => `  T${i + 1}: ${h.tool}(${JSON.stringify(h.args)}) → ${h.result.slice(0, 80)}`)
    .join("\n");

  // Plan status
  const planLines = goldenCase.plan
    .map((p, i) => `  ${i + 1}. [${p.status}] ${p.step}`)
    .join("\n");

  // Model response
  const modelCalls = result.toolCalls.length > 0
    ? result.toolCalls.map((tc) => `  ${tc.toolName}(${JSON.stringify(tc.args)})`).join("\n")
    : "  (no tool calls)";

  return `## Completion-Timing Eval: ${goldenCase.scenario}

Objective: ${goldenCase.objective}
Difficulty: ${goldenCase.difficulty}
Expected action: ${goldenCase.expectedAction}

### Page State
URL: ${goldenCase.snapshot.url}
Title: ${goldenCase.snapshot.title}

### Perception (Vision Model Output)
${goldenCase.perception}

### Plan Status
${planLines}

### Action History
${historyLines}

### Expected Behavior
The agent should ${goldenCase.expectedAction === "done" ? 'call done() with a summary citing evidence of completion' : 'continue acting (NOT call done)'}

### Actual Model Response
Tool calls:
${modelCalls}
${result.text ? `Text: ${result.text.slice(0, 300)}` : "(no text)"}

Evaluate whether the agent made the correct completion decision.`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
