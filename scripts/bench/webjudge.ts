/**
 * WebJudge auto-evaluation for the public benchmark adapter (RFC LP-1).
 *
 * Online-Mind2Web's primary scoring is WebJudge: a separate judge model reads
 * the task and the agent's trajectory and returns a binary success/failure
 * judgment. This module assembles the judge prompt and parses the verdict
 * (both pure and unit-tested), and performs the judge call against any
 * OpenAI-compatible chat-completions endpoint (configurable provider key).
 *
 * Fidelity note: the published WebJudge is screenshot-grounded. This v1 judges
 * primarily on the textual trajectory + final answer recorded by the runner;
 * screenshot grounding is a documented follow-up. The disagreement rate against
 * a manual sample (RFC honest-aggregates discipline) is reported alongside the
 * headline number precisely so this approximation stays honest.
 */

import type {
  BenchJudgeOutcome,
  BenchJudgeVerdict,
  BenchRunEvidence,
  BenchTask,
} from "./types";

export interface WebJudgePrompt {
  system: string;
  user: string;
}

const TRAJECTORY_LINE_LIMIT = 60;
const DONE_SUMMARY_CHAR_LIMIT = 4000;

const JUDGE_SYSTEM_PROMPT = [
  "You are WebJudge, a strict evaluator of web-agent task completion.",
  "You are given a task, the website it started on, and the agent's recorded",
  "trajectory and final answer. Decide whether the agent ACTUALLY accomplished",
  "the user's real objective — not whether it claimed success.",
  "",
  "Rules:",
  "- Judge against the literal task intent. Partial progress is a failure.",
  "- A confident-sounding final answer with no supporting trajectory evidence",
  "  is a failure. Hallucinated or unverifiable answers are failures.",
  "- If the task asked to find/report information, the answer must be present",
  "  and consistent with what the trajectory actually observed.",
  "- If you genuinely cannot tell from the evidence, return \"uncertain\".",
  "",
  "Harness context (factual — use when interpreting trajectories):",
  "- Before the agent's first turn the harness always navigates to the START",
  "  WEBSITE and injects the fully-rendered page content into the agent's",
  "  context. Therefore a done() call on turn 1 at the start URL means the",
  "  agent read the page content and answered directly — this counts as",
  "  observed evidence, not hallucination. Judge the answer on its merits.",
  "- read_page() and xray_page() return the full rendered content of the",
  "  current page. A trajectory of read_page() followed by done() is a",
  "  complete observe-then-answer pattern — treat it as evidence-supported.",
  "",
  'Respond with ONLY a JSON object: {"success": boolean, "confidence": number',
  'between 0 and 1, "reasoning": short string}. No prose outside the JSON.',
].join("\n");

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… [truncated ${text.length - max} chars]`;
}

/** Assemble the WebJudge prompt for one task from the runner's evidence. */
export function buildWebJudgePrompt(
  task: BenchTask,
  evidence: BenchRunEvidence,
): WebJudgePrompt {
  const trajectory = evidence.trajectory.slice(0, TRAJECTORY_LINE_LIMIT);
  const trajectoryOverflow =
    evidence.trajectory.length > TRAJECTORY_LINE_LIMIT
      ? `\n… (${evidence.trajectory.length - TRAJECTORY_LINE_LIMIT} more turns omitted)`
      : "";

  const user = [
    `TASK: ${task.confirmed_task}`,
    `START WEBSITE: ${task.website}`,
    `DIFFICULTY: ${task.level}`,
    "",
    `AGENT FINAL ANSWER:`,
    evidence.doneSummary.trim().length > 0
      ? clip(evidence.doneSummary.trim(), DONE_SUMMARY_CHAR_LIMIT)
      : "(the agent produced no final answer)",
    "",
    `RUN OUTCOME: ${evidence.completionStatus} in ${evidence.turns} turns; ended on ${evidence.finalUrl || "(unknown url)"}`,
    "",
    "AGENT TRAJECTORY (one line per turn):",
    trajectory.length > 0 ? trajectory.join("\n") : "(no trajectory recorded)",
    trajectoryOverflow,
    "",
    "Did the agent actually accomplish the task? Respond with the JSON verdict only.",
  ].join("\n");

  return { system: JUDGE_SYSTEM_PROMPT, user };
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], raw].filter(
    (value): value is string => typeof value === "string",
  );
  for (const candidate of candidates) {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) continue;
    const slice = candidate.slice(start, end + 1);
    try {
      const parsed = JSON.parse(slice);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

function coerceOutcome(value: unknown): BenchJudgeOutcome | null {
  if (typeof value === "boolean") return value ? "success" : "failure";
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["success", "true", "pass", "passed", "yes"].includes(normalized)) {
      return "success";
    }
    if (["failure", "false", "fail", "failed", "no"].includes(normalized)) {
      return "failure";
    }
    if (["uncertain", "unknown", "unsure", "maybe"].includes(normalized)) {
      return "uncertain";
    }
  }
  return null;
}

function coerceConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0) return 0;
  if (value <= 1) return value;
  // Values above 1 are read as percentages (0..100); anything beyond clamps.
  if (value <= 100) return value / 100;
  return 1;
}

/**
 * Parse a raw judge response into a verdict. Unparseable or contradictory
 * output maps to "uncertain" (never silently to success) — a judge that can't
 * be read must not inflate the score.
 */
export function parseWebJudgeVerdict(
  raw: string,
  judgeModel: string,
  taskId: string,
): BenchJudgeVerdict {
  const parsed = extractJsonObject(raw);
  if (!parsed) {
    return {
      task_id: taskId,
      outcome: "uncertain",
      confidence: null,
      reasoning: `unparseable judge response: ${clip(raw.trim(), 200)}`,
      judgeModel,
    };
  }
  const outcome =
    coerceOutcome(parsed.success) ??
    coerceOutcome(parsed.outcome) ??
    coerceOutcome(parsed.verdict) ??
    "uncertain";
  const reasoning =
    typeof parsed.reasoning === "string"
      ? parsed.reasoning
      : typeof parsed.reason === "string"
        ? parsed.reason
        : "";
  return {
    task_id: taskId,
    outcome,
    confidence: coerceConfidence(parsed.confidence),
    reasoning: reasoning.trim(),
    judgeModel,
  };
}

export interface JudgeClientConfig {
  /** OpenAI-compatible base URL, e.g. https://openrouter.ai/api/v1. */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Optional extra headers (e.g. OpenRouter referer/title). */
  headers?: Record<string, string>;
  /** Per-call timeout in ms. */
  timeoutMs?: number;
}

const DEFAULT_JUDGE_TIMEOUT_MS = 60_000;

/** Call the judge model for one task and return a parsed verdict. */
export async function judgeTask(
  task: BenchTask,
  evidence: BenchRunEvidence,
  config: JudgeClientConfig,
): Promise<BenchJudgeVerdict> {
  const prompt = buildWebJudgePrompt(task, evidence);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    config.timeoutMs ?? DEFAULT_JUDGE_TIMEOUT_MS,
  );
  try {
    const response = await fetch(
      `${config.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
          ...(config.headers ?? {}),
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0,
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        task_id: task.task_id,
        outcome: "uncertain",
        confidence: null,
        reasoning: `judge HTTP ${response.status}: ${clip(body, 200)}`,
        judgeModel: config.model,
      };
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    return parseWebJudgeVerdict(content, config.model, task.task_id);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      task_id: task.task_id,
      outcome: "uncertain",
      confidence: null,
      reasoning: `judge call failed: ${detail}`,
      judgeModel: config.model,
    };
  } finally {
    clearTimeout(timer);
  }
}
