import { DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER } from "../utils/executor-model-policy";

export interface LLMModelDefaults {
  executor: string;
  executorEmptyResponseFallback: string;
  planner: string;
  /** Optional specialist writer model default (falls back to planner default). */
  writer: string;
  openai: {
    executor: string;
    planner: string;
    perception: string;
  };
  groq: {
    planner: string;
    perception: string;
  };
  fireworks: {
    executor: string;
    planner: string;
  };
  moonshot: {
    executor: string;
    planner: string;
    perception: string;
  };
  xiaomi: {
    executor: string;
    planner: string;
    perception: string;
  };
  deepseek: {
    planner: string;
    plannerPro: string;
  };
}

export const DEFAULT_LLM_MODEL_CONFIG: LLMModelDefaults = {
  executor: DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER.openrouter,
  executorEmptyResponseFallback:
    DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER.openrouter,
  planner: "accounts/fireworks/routers/kimi-k2p6-turbo",
  writer: "accounts/fireworks/routers/kimi-k2p6-turbo",
  openai: {
    executor: DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER["openai-groq"],
    planner: "accounts/fireworks/routers/kimi-k2p6-turbo",
    perception: "accounts/fireworks/routers/kimi-k2p6-turbo",
  },
  groq: {
    planner: "openai/gpt-oss-120b",
    perception: "meta-llama/llama-4-scout-17b-16e-instruct",
  },
  fireworks: {
    executor: DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER.fireworks,
    planner: "accounts/fireworks/routers/kimi-k2p6-turbo",
  },
  moonshot: {
    executor: DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER.moonshot,
    planner: "kimi-k2.6",
    perception: "kimi-k2.6",
  },
  xiaomi: {
    executor: DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER.xiaomi,
    planner: "mimo-v2-pro",
    perception: "mimo-v2-omni",
  },
  deepseek: {
    planner: "deepseek-v4-flash",
    plannerPro: "deepseek-v4-pro",
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
  };
}

export const LLM_MODEL_CONFIG = resolveLLMModelConfig(
  DEFAULT_LLM_MODEL_CONFIG,
);
