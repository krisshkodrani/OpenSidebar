/**
 * Shared types for the public benchmark adapter (RFC LP-1).
 *
 * The primary benchmark is Online-Mind2Web (osunlp/Online-Mind2Web): verified
 * live-web tasks with difficulty labels and WebJudge auto-evaluation. This
 * module defines the on-disk task schema, the per-task safety profile, the
 * run evidence the headed runner records, and the judge verdict / aggregate
 * shapes. It is harness-only — no product runtime imports.
 */

export type BenchDifficulty = "easy" | "medium" | "hard";

/**
 * One Online-Mind2Web task as stored in the vendored task file. Field names
 * mirror the published dataset (`task_id`, `confirmed_task`, `website`,
 * `level`) so an authenticated fetch of the official set drops in unchanged.
 */
export interface BenchTask {
  task_id: string;
  /** The natural-language instruction given to the agent. */
  confirmed_task: string;
  /** The start URL the task begins from. */
  website: string;
  level: BenchDifficulty;
  /** Optional reference trajectory length from the dataset (informational). */
  reference_length?: number;
}

/** Metadata wrapper around a vendored task file, with provenance pinning. */
export interface BenchTaskFile {
  /** Dataset identifier, e.g. "osunlp/Online-Mind2Web". */
  source: string;
  /** Pinned dataset revision (git SHA or tag) for reproducibility. */
  revision: string;
  /** License identifier for the task text, e.g. "CC-BY-4.0". */
  license: string;
  /** Human note: where this came from and any subset/redaction applied. */
  note?: string;
  tasks: BenchTask[];
}

/**
 * Per-task safety profile for unattended live-web runs. Derived from the task,
 * never hand-edited per task. Enforces the RFC's live-web rails: scope
 * navigation to the task's site(s), refuse payment/checkout submission, and
 * skip (not fail) tasks that would mutate third-party state.
 */
export interface BenchSafetyProfile {
  /** Hostnames the agent may navigate to (task site + its registrable domain). */
  domainAllowlist: string[];
  /** Whether navigation is allowed at all (always scoped to the allowlist). */
  allowNavigation: boolean;
  /** Approvals are always required-then-auto-denied for refused tool classes. */
  refusedToolClasses: BenchRefusedToolClass[];
  /** If true, the runner skips the task and counts it as skipped, not failed. */
  skip: boolean;
  /** Why the task was skipped (present only when skip is true). */
  skipReason?: string;
}

export type BenchRefusedToolClass = "payment" | "checkout" | "account_mutation";

/** Evidence the headed runner records for one task, consumed by the judge. */
export interface BenchRunEvidence {
  task: BenchTask;
  /** Terminal completion status from the agent run. */
  completionStatus: "completed" | "partial" | "failed" | "stopped" | "skipped";
  /** The agent's final answer (done-tool summary), if any. */
  doneSummary: string;
  /** Compact trajectory: one line per turn (tool + key args + url). */
  trajectory: string[];
  /** Final page URL the run ended on. */
  finalUrl: string;
  /** Turn count for the run. */
  turns: number;
  /** Observed cost in USD, if the provider reported it. */
  costUsd: number | null;
  /** Wall-clock duration of the run in milliseconds. */
  durationMs: number;
  /** Relative paths to the copied raw trace receipts for this task. */
  traceFiles: string[];
  /** Set when the task was skipped by the safety profile. */
  skipReason?: string;
}

export type BenchJudgeOutcome = "success" | "failure" | "uncertain";

/** WebJudge verdict for one task. */
export interface BenchJudgeVerdict {
  task_id: string;
  outcome: BenchJudgeOutcome;
  /** Judge confidence 0..1 when the model provides one, else null. */
  confidence: number | null;
  /** Judge's short rationale. */
  reasoning: string;
  /** The judge model id that produced this verdict. */
  judgeModel: string;
}

/** One fully-scored task: run evidence + judge verdict. */
export interface BenchTaskResult {
  evidence: BenchRunEvidence;
  verdict: BenchJudgeVerdict | null;
}

/** Aggregate score over a sweep. */
export interface BenchAggregate {
  total: number;
  scored: number;
  skipped: number;
  successes: number;
  failures: number;
  uncertain: number;
  /** Pass rate over scored (non-skipped, judged) tasks, 0..1. */
  passRate: number;
  byLevel: Record<BenchDifficulty, { total: number; successes: number; passRate: number }>;
  totalCostUsd: number | null;
  medianTurns: number;
}
