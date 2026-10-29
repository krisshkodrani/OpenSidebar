import { DEFAULT_EXECUTOR_MODEL } from "../utils/executor-model-policy";

/** Per-seat model defaults, in OpenRouter catalog id form. */
export interface LLMModelDefaults {
  executor: string;
  executorEmptyResponseFallback: string;
  planner: string;
  /** Optional specialist writer model default (falls back to planner default). */
  writer: string;
  /** Verification judge seat default (RFC LP-15 Phase 10). */
  judge: string;
}

// Luna handles executor and planner; Jev uses the typed Decisions API for
// rubric judging. The writer seat is DORMANT: it activates only when
// settings.writerModel is set, and then the writer pool aliases the executor
// pool, not this value.
export const DEFAULT_LLM_MODEL_CONFIG: LLMModelDefaults = {
  executor: DEFAULT_EXECUTOR_MODEL,
  executorEmptyResponseFallback: DEFAULT_EXECUTOR_MODEL,
  planner: "openai/gpt-6-luna",
  writer: "openai/gpt-6-luna",
  judge: "typesafe/jev-1.13",
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readString(
  source: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = source[key];
  return isNonEmptyString(value) ? value : fallback;
}

export function resolveLLMModelConfig(
  candidate: unknown,
): LLMModelDefaults {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return DEFAULT_LLM_MODEL_CONFIG;
  }

  const record = candidate as Record<string, unknown>;
  return {
    executor: readString(
      record,
      "executor",
      DEFAULT_LLM_MODEL_CONFIG.executor,
    ),
    executorEmptyResponseFallback: readString(
      record,
      "executorEmptyResponseFallback",
      DEFAULT_LLM_MODEL_CONFIG.executorEmptyResponseFallback,
    ),
    planner: readString(record, "planner", DEFAULT_LLM_MODEL_CONFIG.planner),
    writer: readString(record, "writer", DEFAULT_LLM_MODEL_CONFIG.writer),
    judge: readString(record, "judge", DEFAULT_LLM_MODEL_CONFIG.judge),
  };
}

export const LLM_MODEL_CONFIG = resolveLLMModelConfig(
  DEFAULT_LLM_MODEL_CONFIG,
);
