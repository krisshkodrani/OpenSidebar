import { DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER } from "../utils/executor-model-policy";

export interface LLMModelDefaults {
  executor: string;
  executorEmptyResponseFallback: string;
  planner: string;
  /** Optional specialist writer model default (falls back to planner default). */
  writer: string;
  /** Verification judge seat default (RFC LP-15 Phase 10; falls back to planner). */
  judge: string;
  openai: {
    executor: string;
    planner: string;
  };
  groq: {
    planner: string;
  };
  fireworks: {
    executor: string;
    planner: string;
  };
  moonshot: {
    executor: string;
    planner: string;
  };
  xiaomi: {
    executor: string;
    planner: string;
  };
  deepseek: {
    planner: string;
    plannerPro: string;
  };
  cerebras: {
    executor: string;
  };
}

export const DEFAULT_LLM_MODEL_CONFIG: LLMModelDefaults = {
  executor: DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER.openrouter,
  executorEmptyResponseFallback:
    DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER.openrouter,
  planner: "accounts/fireworks/models/glm-5p2",
  writer: "accounts/fireworks/models/glm-5p2",
  judge: "accounts/fireworks/models/glm-5p2",
  openai: {
    executor: DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER["openai-groq"],
    planner: "accounts/fireworks/models/glm-5p2",
  },
  groq: {
    planner: "openai/gpt-oss-120b",
  },
  fireworks: {
    executor: DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER.fireworks,
    planner: "accounts/fireworks/models/glm-5p2",
  },
  moonshot: {
    executor: DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER.moonshot,
    planner: "kimi-k2.6",
  },
  xiaomi: {
    executor: DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER.xiaomi,
    planner: "mimo-v2-pro",
  },
  deepseek: {
    planner: "deepseek-v4-flash",
    plannerPro: "deepseek-v4-pro",
  },
  cerebras: {
    executor: DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER["cerebras-fireworks"],
  },
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

function readGroup<T extends Record<string, string>>(
  source: Record<string, unknown>,
  key: string,
  fallback: T,
): T {
  const value = source[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(fallback).map(([entryKey, entryFallback]) => [
      entryKey,
      readString(record, entryKey, entryFallback),
    ]),
  ) as T;
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
    openai: readGroup(record, "openai", DEFAULT_LLM_MODEL_CONFIG.openai),
    groq: readGroup(record, "groq", DEFAULT_LLM_MODEL_CONFIG.groq),
    fireworks: readGroup(
      record,
      "fireworks",
      DEFAULT_LLM_MODEL_CONFIG.fireworks,
    ),
    moonshot: readGroup(record, "moonshot", DEFAULT_LLM_MODEL_CONFIG.moonshot),
    xiaomi: readGroup(record, "xiaomi", DEFAULT_LLM_MODEL_CONFIG.xiaomi),
    deepseek: readGroup(record, "deepseek", DEFAULT_LLM_MODEL_CONFIG.deepseek),
    cerebras: readGroup(record, "cerebras", DEFAULT_LLM_MODEL_CONFIG.cerebras),
  };
}

export const LLM_MODEL_CONFIG = resolveLLMModelConfig(
  DEFAULT_LLM_MODEL_CONFIG,
);
