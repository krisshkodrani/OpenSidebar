/**
 * Rubric judge (RFC LP-15, Phase 10).
 *
 * The model-backed adjudicator evaluates completion criteria against current
 * evidence and corpus context. It uses an OUTCOME-grounded rubric — each criterion asks "is this
 * end-state true given the evidence?", never "was a step performed?" (the lesson
 * from the LP-11 validator failures) — and returns a structured verdict the
 * verifier turns into accept | retry | reroute | human.
 *
 * Three safety properties the runner guarantees regardless of the model:
 *   - hard timeout — the judge never blocks completion indefinitely;
 *   - fail-open-to-human — on timeout / error / unparseable output the verdict
 *     is `source: "fail_open"` (NOT an auto-reject), so the consumer routes to a
 *     human rather than silently passing or failing the task;
 *   - verdict cache — keyed on the claim + evidence digest, so a repeated
 *     adjudication of the same state costs nothing.
 *
 * The model call is injected as a `JudgeSeat` (satisfied by `LLMClient.runJudge`)
 * so the runner is pure-ish and unit-testable with a fake seat.
 */

import type { EntailmentLabel } from "./entailment-gate";
import { parseJevRubricResponse } from "../../llm/jev-decision";

export interface JudgeCriterion {
  id: string;
  /** Outcome-grounded question, e.g. "The submitted email equals the user's". */
  description: string;
  /** A required criterion failing fails the whole verdict. */
  required: boolean;
}

export interface JudgeRubric {
  /** The claim under adjudication (an unresolved success criterion). */
  claim: string;
  criteria: JudgeCriterion[];
  /** Rendered evidence lines the executor produced. */
  evidence: string[];
  /** Rendered trusted-corpus facts relevant to the claim. */
  corpusFacts: string[];
}

export interface CriterionVerdict {
  id: string;
  pass: boolean;
  rationale?: string;
}

export interface ClaimEntailmentVerdict {
  claimKey: string;
  label: EntailmentLabel;
}

/** Token accounting for one judge adjudication (absent on cache hits / skips). */
export interface JudgeUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  /** Estimated USD cost of the call (null when the model has no pricing row). */
  costUsd?: number;
}

export interface JudgeVerdict {
  /** Overall pass — false when any required criterion fails. */
  pass: boolean;
  perCriterion: CriterionVerdict[];
  entailment: ClaimEntailmentVerdict[];
  /** 0..1 self-reported confidence (0 for a fail-open verdict). */
  confidence: number;
  confidenceKind?: "self_reported" | "classifier";
  /**
   * `judge` — the model decided; `fail_open` — the model timed out / errored /
   * returned garbage, so the consumer must route to a human, not auto-reject.
   */
  source: "judge" | "fail_open";
  /** Why a fail-open verdict failed open (absent on real judge verdicts). */
  failureCause?: "timeout" | "seat_error" | "parse_error" | "contract_error";
  /** Truncated seat error message, for seat_error diagnosis. */
  failureDetail?: string;
  /** Wall-clock of the adjudication (absent on cache hits). */
  durationMs?: number;
  /** Model that produced the verdict (absent when the seat never answered). */
  model?: string;
  /** Provider that served the verdict (absent when the seat never answered). */
  providerId?: string;
  /** Token accounting for the call (absent on cache hits / seat non-answer). */
  usage?: JudgeUsage;
}

/** The narrow model seat the judge needs (satisfied by `LLMClient.runJudge`). */
export interface JudgeSeat {
  runJudge(args: {
    systemPrompt: string;
    userPrompt: string;
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
    rubric?: JudgeRubric;
  }): Promise<{
    text: string;
    model: string;
    providerId: string;
    usage?: JudgeUsage;
    decision?: unknown;
  }>;
}

export interface JudgeVerdictCache {
  get(key: string): JudgeVerdict | undefined;
  set(key: string, verdict: JudgeVerdict): void;
}

export interface RunRubricJudgeOptions {
  seat: JudgeSeat;
  /** Hard timeout; on expiry the verdict fails open to human. Default 15s. */
  timeoutMs?: number;
  cache?: JudgeVerdictCache;
  signal?: AbortSignal;
}

// 2026-07-09 telemetry: judge calls succeed in ~2.6s uncontended but queued
// behind planner traffic they hit the previous 15s cap ~75% of the time and
// failed open (losing judge coverage — harmless but useless). 25s keeps a hard
// bound on completion latency while absorbing the contention tail.
const DEFAULT_TIMEOUT_MS = 25_000;

const JUDGE_SYSTEM_PROMPT = [
  "You are a strict verification judge. Decide whether a CLAIM about the",
  "end-state of a completed web task is TRUE, given the EVIDENCE and known",
  "CORPUS FACTS. Judge OUTCOMES, never process: a criterion asks whether an",
  "end-state holds, not whether a step was performed. Do not reward effort.",
  "",
  "For each criterion, decide pass/fail from the evidence alone — if the",
  "evidence does not establish the outcome, the criterion fails. For each",
  "criterion describing a prerequisite view that a later workflow state",
  "replaced, preserved trajectory evidence may establish that criterion; do",
  "not require the old control or table to coexist with terminal confirmation.",
  "A bare claim without concrete preserved evidence still fails.",
  "For each",
  "corpus fact relevant to the claim, label it: 'entailed' (evidence agrees),",
  "'contradicted' (evidence conflicts), or 'unsupported' (evidence is silent).",
  "",
  "Copy each criterion id exactly as supplied. Return it once; never rename,",
  "invent, or duplicate ids. Each criterion pass must be a JSON boolean.",
  "Reply with ONLY a JSON object, no prose:",
  '{"pass": boolean, "confidence": 0..1,',
  ' "perCriterion": [{"id": string, "pass": boolean, "rationale": string}],',
  ' "entailment": [{"claimKey": string, "label": "entailed|contradicted|unsupported"}]}',
].join("\n");

function renderUserPrompt(rubric: JudgeRubric): string {
  const lines: string[] = [`CLAIM: ${rubric.claim}`, "", "CRITERIA:"];
  lines.push(JSON.stringify(rubric.criteria));
  lines.push("", "EVIDENCE:");
  lines.push(
    ...(rubric.evidence.length
      ? rubric.evidence.map((e) => `- ${e}`)
      : ["- (none)"]),
  );
  lines.push("", "CORPUS FACTS:");
  lines.push(
    ...(rubric.corpusFacts.length
      ? rubric.corpusFacts.map((f) => `- ${f}`)
      : ["- (none)"]),
  );
  return lines.join("\n");
}

/** Deterministic non-crypto digest (djb2) of the claim + evidence for caching. */
export function judgeCacheKey(rubric: JudgeRubric): string {
  const material = [
    rubric.claim,
    ...rubric.criteria.map((c) =>
      JSON.stringify([c.id, c.description, c.required]),
    ),
    ...rubric.evidence,
    ...rubric.corpusFacts,
  ].join("\0");
  let hash = 5381;
  for (let i = 0; i < material.length; i++) {
    hash = ((hash << 5) + hash) ^ material.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/** A bounded in-memory verdict cache (FIFO eviction). */
export function createJudgeVerdictCache(maxEntries = 128): JudgeVerdictCache {
  const map = new Map<string, JudgeVerdict>();
  return {
    get: (key) => map.get(key),
    set: (key, verdict) => {
      if (map.has(key)) map.delete(key);
      map.set(key, verdict);
      while (map.size > maxEntries) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
      }
    },
  };
}

function failOpen(
  failureCause: NonNullable<JudgeVerdict["failureCause"]>,
  failureDetail?: string,
): JudgeVerdict {
  return {
    pass: false,
    perCriterion: [],
    entailment: [],
    confidence: 0,
    source: "fail_open",
    failureCause,
    ...(failureDetail ? { failureDetail: failureDetail.slice(0, 200) } : {}),
  };
}

function clamp01(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(1, n));
}

const ENTAILMENT_LABELS: ReadonlySet<string> = new Set([
  "entailed",
  "contradicted",
  "unsupported",
]);

/** Extract the first balanced top-level JSON object from model text. */
function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

class JudgeContractError extends Error {}

function normalizeVerdict(
  parsed: unknown,
  rubric: JudgeRubric,
): JudgeVerdict | null {
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const perCriterion: CriterionVerdict[] = Array.isArray(obj.perCriterion)
    ? obj.perCriterion
        .map((raw): CriterionVerdict | null => {
          if (!raw || typeof raw !== "object") return null;
          const r = raw as Record<string, unknown>;
          if (typeof r.id !== "string") return null;
          return {
            id: r.id,
            pass: r.pass === true,
            rationale:
              typeof r.rationale === "string" ? r.rationale : undefined,
          };
        })
        .filter((c): c is CriterionVerdict => c !== null)
    : [];

  // Identity mistakes are an invalid response, not evidence against the task.
  // Keep required-id matching strict; the gate must not treat a malformed
  // decision as approval or guess which criterion the model intended.
  const knownIds = new Set(rubric.criteria.map((criterion) => criterion.id));
  const seenIds = new Set<string>();
  if (Array.isArray(obj.perCriterion)) {
    for (const raw of obj.perCriterion) {
      if (
        !raw ||
        typeof raw !== "object" ||
        typeof raw.pass !== "boolean" ||
        !knownIds.has(raw.id) ||
        seenIds.has(raw.id)
      ) {
        throw new JudgeContractError(
          "Judge criterion ids or decisions do not match the rubric",
        );
      }
      seenIds.add(raw.id);
    }
  }

  const entailment: ClaimEntailmentVerdict[] = Array.isArray(obj.entailment)
    ? obj.entailment
        .map((raw): ClaimEntailmentVerdict | null => {
          if (!raw || typeof raw !== "object") return null;
          const r = raw as Record<string, unknown>;
          if (typeof r.claimKey !== "string") return null;
          if (typeof r.label !== "string" || !ENTAILMENT_LABELS.has(r.label)) {
            return null;
          }
          return { claimKey: r.claimKey, label: r.label as EntailmentLabel };
        })
        .filter((e): e is ClaimEntailmentVerdict => e !== null)
    : [];

  // A required criterion that failed (or is missing from the verdict) fails the
  // whole claim — the model's top-level `pass` cannot override that.
  const byId = new Map(perCriterion.map((c) => [c.id, c]));
  const requiredSatisfied = rubric.criteria
    .filter((c) => c.required)
    .every((c) => byId.get(c.id)?.pass === true);
  const pass = obj.pass === true && requiredSatisfied;

  return {
    pass,
    perCriterion,
    entailment,
    confidence: clamp01(obj.confidence),
    source: "judge",
  };
}

/**
 * Adjudicate one claim against its rubric. Returns a `fail_open` verdict (route
 * to human) on timeout, seat error, or unparseable output — never throws.
 */
export async function runRubricJudge(
  rubric: JudgeRubric,
  options: RunRubricJudgeOptions,
): Promise<JudgeVerdict> {
  const key = judgeCacheKey(rubric);
  const cached = options.cache?.get(key);
  if (cached) return cached;

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });

  const startedAt = Date.now();
  let verdict: JudgeVerdict;
  try {
    const result = await Promise.race([
      options.seat.runJudge({
        systemPrompt: JUDGE_SYSTEM_PROMPT,
        userPrompt: renderUserPrompt(rubric),
        rubric,
        signal,
      }),
      timeout,
    ]);
    if (!result) {
      verdict = failOpen("timeout");
    } else {
      try {
        const parsed =
          result.decision !== undefined
            ? normalizeJevVerdict(result.decision, rubric)
            : normalizeVerdict(extractJsonObject(result.text), rubric);
        verdict = parsed ?? failOpen("parse_error", result.text);
      } catch (error) {
        if (!(error instanceof JudgeContractError)) throw error;
        verdict = failOpen("contract_error", error.message);
      }
      // The call cost tokens whether or not the output parsed — attach usage
      // and provenance to both a real verdict and a parse-error fail-open.
      verdict.model = result.model;
      verdict.providerId = result.providerId;
      verdict.usage = result.usage;
    }
  } catch (error) {
    verdict = failOpen(
      error instanceof JudgeContractError ? "contract_error" : "seat_error",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
  verdict.durationMs = Date.now() - startedAt;

  // Only cache a real decision — a fail-open should be retried next time.
  if (verdict.source === "judge") options.cache?.set(key, verdict);
  return verdict;
}

function normalizeJevVerdict(raw: unknown, rubric: JudgeRubric): JudgeVerdict {
  try {
    const decision = parseJevRubricResponse(rubric, raw);
    const perCriterion = decision.criteria.map((item) => ({
      id: item.id,
      pass: item.choice === "entailed" && item.probabilities.entailed >= 0.9,
    }));
    return {
      pass: decision.criteria.every(
        (item, index) => !item.required || perCriterion[index].pass,
      ),
      perCriterion,
      entailment: decision.entailment.map((item) => ({
        claimKey: item.claimKey,
        label:
          item.probabilities[item.choice] >= 0.9 ? item.choice : "unsupported",
      })),
      confidence: Math.min(
        ...decision.criteria.map((item) => item.probabilities[item.choice]),
      ),
      confidenceKind: "classifier",
      source: "judge",
    };
  } catch (error) {
    throw new JudgeContractError(
      error instanceof Error ? error.message : String(error),
    );
  }
}
