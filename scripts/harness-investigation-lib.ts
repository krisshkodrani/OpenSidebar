import { createHash } from "node:crypto";

export type AttemptClassification =
  | "valid_pass"
  | "valid_model_failure"
  | "harness_failure"
  | "provider_failure"
  | "validator_disagreement"
  | "indeterminate";

export interface InvestigationConfig {
  label: string;
  role: "baseline" | "planner" | "executor" | "judge" | "full-stack";
  env: Record<string, string>;
}

export interface InvestigationAttempt {
  configLabel: string;
  file: string;
  repetition: number;
  classification: AttemptClassification;
  eligibleForScoring: boolean;
  status: "passed" | "failed";
  durationMs: number;
  reason: string;
  resultFile: string;
  requestedModels: Record<string, string | null>;
  resolvedModels: Record<string, string[]>;
  traceRunIds: string[];
  retryLineage: string[];
  usageByRole: Record<string, {
    calls: number;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    costUsd: number;
    llmTimeMs: number;
  }>;
  configFingerprint: string;
  buildRevision: string;
  worktreeDirty: boolean;
}

const PROVIDER_FAILURE = /\b(401|403|429)\b|unauthori[sz]ed|forbidden|rate.?limit|quota|credit|model.{0,30}(not found|unavailable)|provider[_ -]error/i;
const HARNESS_FAILURE = /runner_error|beforeall|afterall|browser.{0,30}(closed|launch|disconnected)|fixture.{0,30}(failed|unavailable)|service worker.{0,30}(missing|closed)|no agent traces|failed to get an active tab/i;
const INDETERMINATE = /timeout|timed out|stopped by user|cancelled|canceled|empty response|unparseable/i;

export function classifyAttempt(input: {
  passed: boolean;
  reason: string;
  validatorDisagreed?: boolean;
}): Pick<InvestigationAttempt, "classification" | "eligibleForScoring"> {
  if (input.validatorDisagreed) {
    return { classification: "validator_disagreement", eligibleForScoring: false };
  }
  if (PROVIDER_FAILURE.test(input.reason)) {
    return { classification: "provider_failure", eligibleForScoring: false };
  }
  if (HARNESS_FAILURE.test(input.reason)) {
    return { classification: "harness_failure", eligibleForScoring: false };
  }
  if (INDETERMINATE.test(input.reason)) {
    return { classification: "indeterminate", eligibleForScoring: false };
  }
  return input.passed
    ? { classification: "valid_pass", eligibleForScoring: true }
    : { classification: "valid_model_failure", eligibleForScoring: true };
}

export function fingerprintConfig(config: InvestigationConfig): string {
  const sortedEnv = Object.fromEntries(
    Object.entries(config.env).sort(([left], [right]) => left.localeCompare(right)),
  );
  return createHash("sha256")
    .update(JSON.stringify({ label: config.label, role: config.role, env: sortedEnv }))
    .digest("hex")
    .slice(0, 16);
}

export function requestedModels(env: Record<string, string | undefined>): Record<string, string | null> {
  return {
    provider: env.E2E_PROVIDER ?? null,
    executorModel: env.E2E_MODEL ?? env.E2E_EXECUTOR_MODEL ?? null,
    executorProviderPin: env.E2E_EXECUTOR_PROVIDER_PIN ?? null,
    plannerModel: env.E2E_PLANNER_MODEL ?? null,
    plannerProviderPin: env.E2E_PLANNER_PROVIDER_PIN ?? null,
    judgeModel: env.E2E_JUDGE_MODEL ?? null,
    judgeProviderPin: env.E2E_JUDGE_PROVIDER_PIN ?? null,
    perceptionMode: env.E2E_PERCEPTION_MODE ?? null,
  };
}

export function validateConfig(config: InvestigationConfig): string[] {
  const errors: string[] = [];
  if (!config.label.trim()) errors.push("configuration label is required");
  if (!config.env.E2E_PROVIDER) errors.push(`${config.label}: E2E_PROVIDER is required`);
  if (!config.env.E2E_MODEL) errors.push(`${config.label}: E2E_MODEL is required`);
  if (!config.env.E2E_PLANNER_MODEL) errors.push(`${config.label}: E2E_PLANNER_MODEL is required`);
  if (!config.env.E2E_JUDGE_MODEL) errors.push(`${config.label}: E2E_JUDGE_MODEL is required`);
  if (!config.env.E2E_EXECUTOR_PROVIDER_PIN) errors.push(`${config.label}: executor provider pin is required`);
  if (!config.env.E2E_PLANNER_PROVIDER_PIN) errors.push(`${config.label}: planner provider pin is required`);
  if (!config.env.E2E_JUDGE_PROVIDER_PIN) errors.push(`${config.label}: judge provider pin is required`);
  return errors;
}

export function buildInvestigationReport(
  attempts: readonly InvestigationAttempt[],
  generatedAt = new Date().toISOString(),
): string {
  const scored = attempts.filter((attempt) => attempt.eligibleForScoring);
  const passes = scored.filter((attempt) => attempt.classification === "valid_pass").length;
  const lines = [
    "# Harness Validity Investigation",
    "",
    `Generated: ${generatedAt}`,
    `Scored attempts: ${passes}/${scored.length} valid passes; ${attempts.length - scored.length} excluded`,
    "",
    "## Attempts",
    "",
    "| Configuration | Case | Repeat | Classification | Score eligible | Duration | Reason | Fingerprint |",
    "| --- | --- | ---: | --- | --- | ---: | --- | --- |",
  ];
  for (const attempt of attempts) {
    lines.push(
      `| ${attempt.configLabel} | ${attempt.file} | ${attempt.repetition} | ${attempt.classification} | ${attempt.eligibleForScoring ? "yes" : "no"} | ${(attempt.durationMs / 1000).toFixed(1)}s | ${attempt.reason.replace(/\|/g, "\\|")} | \`${attempt.configFingerprint}\` |`,
    );
  }
  const usageRows = new Map<string, InvestigationAttempt["usageByRole"][string]>();
  for (const attempt of attempts) {
    for (const [role, values] of Object.entries(attempt.usageByRole)) {
      const key = `${attempt.configLabel}\0${role}`;
      const target = usageRows.get(key) ?? {
        calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0, llmTimeMs: 0,
      };
      target.calls += values.calls;
      target.promptTokens += values.promptTokens;
      target.completionTokens += values.completionTokens;
      target.cachedTokens += values.cachedTokens;
      target.costUsd += values.costUsd;
      target.llmTimeMs += values.llmTimeMs;
      usageRows.set(key, target);
    }
  }
  lines.push("", "## Usage by configuration and role", "");
  lines.push("| Configuration | Role | Calls | Prompt | Completion | Cached | Cache rate | LLM time | Cost |", "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const [key, values] of usageRows) {
    const [configuration, role] = key.split("\0");
    const cacheRate = values.promptTokens > 0 ? (values.cachedTokens / values.promptTokens) * 100 : 0;
    lines.push(`| ${configuration} | ${role} | ${values.calls} | ${values.promptTokens} | ${values.completionTokens} | ${values.cachedTokens} | ${cacheRate.toFixed(2)}% | ${(values.llmTimeMs / 1000).toFixed(1)}s | $${values.costUsd.toFixed(6)} |`);
  }
  lines.push("", "## Interpretation rules", "");
  lines.push("- Provider, harness, validator-disagreement, and indeterminate attempts are excluded from model scores.");
  lines.push("- Three repetitions are calibration evidence; report counts directly and do not claim statistical significance.");
  lines.push("- Internal judge decisions are orchestration evidence, not the authoritative fixture score.");
  lines.push("- Compare `requestedModels` and `resolvedModels` in `attempts.json`; any mismatch requires exclusion or explanation.");
  return `${lines.join("\n")}\n`;
}
