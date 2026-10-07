import { DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER } from "../utils/executor-model-policy";
export interface LLMModelDefaults {
  executor: string;
  executorEmptyResponseFallback: string;
  planner: string;
  writer: string;
  judge: string;
  openrouter: { executor: string; planner: string; judge: string };
}
export const DEFAULT_LLM_MODEL_CONFIG: LLMModelDefaults = {
  executor: DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER.openrouter,
  executorEmptyResponseFallback:
    DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER.openrouter,
  planner: "deepseek/deepseek-v4.1-flash",
  writer: "deepseek/deepseek-v4.1-flash",
  judge: "openai/gpt-oss-120b",
  openrouter: {
    executor: DEFAULT_MULTIMODAL_EXECUTOR_BY_PROVIDER.openrouter,
    planner: "deepseek/deepseek-v4.1-flash",
    judge: "openai/gpt-oss-120b",
  },
};
function model(value: unknown, fallback: string): string {
  return typeof value === "string" &&
    value.trim() &&
    !value.startsWith("accounts/")
    ? value
    : fallback;
}
export function resolveLLMModelConfig(candidate: unknown): LLMModelDefaults {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
    return DEFAULT_LLM_MODEL_CONFIG;
  const source = candidate as Record<string, unknown>,
    defaults = DEFAULT_LLM_MODEL_CONFIG;
  const router =
    source.openrouter && typeof source.openrouter === "object"
      ? (source.openrouter as Record<string, unknown>)
      : {};
  return {
    executor: model(source.executor, defaults.executor),
    executorEmptyResponseFallback: model(
      source.executorEmptyResponseFallback,
      defaults.executorEmptyResponseFallback,
    ),
    planner: model(source.planner, defaults.planner),
    writer: model(source.writer, defaults.writer),
    judge: model(source.judge, defaults.judge),
    openrouter: {
      executor: model(router.executor, defaults.openrouter.executor),
      planner: model(router.planner, defaults.openrouter.planner),
      judge: model(router.judge, defaults.openrouter.judge),
    },
  };
}
export const LLM_MODEL_CONFIG = resolveLLMModelConfig(DEFAULT_LLM_MODEL_CONFIG);
