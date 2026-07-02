import { useState, useEffect, useRef } from "react";
import { isExecutorModelAllowed } from "../../utils/executor-model-policy";

export interface ProviderModelOption {
  id: string;
  name: string;
  promptPrice: number;
  completionPrice: number;
  supportsVision: boolean;
  provider?:
    | "openrouter"
    | "fireworks"
    | "groq"
    | "moonshot"
    | "deepseek"
    | "xiaomi";
  source?: "live" | "curated";
  effectiveDate?: string;
}

export type OpenRouterModel = ProviderModelOption;

/** Format price per 1M tokens (input from per-token string) */
export function formatPrice(perToken: number): string {
  const perMillion = perToken * 1_000_000;
  if (perMillion < 0.01) return "$0.00";
  return `$${perMillion.toFixed(2)}`;
}

/** Format input/output pricing as a compact badge string */
export function formatPricingBadge(model: ProviderModelOption): string {
  return `${formatPrice(model.promptPrice)} / ${formatPrice(model.completionPrice)} per 1M`;
}

export const FIREWORKS_MODELS: ProviderModelOption[] = [
  {
    id: "accounts/fireworks/models/glm-5p2",
    name: "GLM 5.2",
    promptPrice: 0.55 / 1_000_000,
    completionPrice: 2.19 / 1_000_000,
    supportsVision: false,
    provider: "fireworks",
    source: "curated",
    effectiveDate: "2026-06-24",
  },
  {
    id: "accounts/fireworks/models/kimi-k2p7-code",
    name: "Kimi K2.7 Code",
    promptPrice: 0.95 / 1_000_000,
    completionPrice: 4.0 / 1_000_000,
    supportsVision: true,
    provider: "fireworks",
    source: "curated",
    effectiveDate: "2026-06-12",
  },
  {
    id: "accounts/fireworks/routers/kimi-k2p6-turbo",
    name: "Kimi K2.6 Turbo",
    promptPrice: 2.0 / 1_000_000,
    completionPrice: 8.0 / 1_000_000,
    supportsVision: true,
    provider: "fireworks",
    source: "curated",
    effectiveDate: "2026-05-29",
  },
  {
    id: "accounts/fireworks/routers/kimi-k2p5-turbo",
    name: "Kimi K2.5 Turbo",
    promptPrice: 0.99 / 1_000_000,
    completionPrice: 4.94 / 1_000_000,
    supportsVision: true,
    provider: "fireworks",
    source: "curated",
    effectiveDate: "2026-04-19",
  },
  {
    id: "accounts/fireworks/routers/kimi-k2p5",
    name: "Kimi K2.5",
    promptPrice: 0.6 / 1_000_000,
    completionPrice: 3.0 / 1_000_000,
    supportsVision: false,
    provider: "fireworks",
    source: "curated",
    effectiveDate: "2026-04-19",
  },
  {
    id: "qwen/qwen3-vl-30b-a3b-instruct",
    name: "Qwen3 VL 30B A3B Instruct",
    promptPrice: 0.15 / 1_000_000,
    completionPrice: 0.6 / 1_000_000,
    supportsVision: true,
    provider: "fireworks",
    source: "curated",
    effectiveDate: "2026-04-19",
  },
  {
    id: "openai/gpt-oss-120b",
    name: "OpenAI GPT-OSS 120B",
    promptPrice: 0.15 / 1_000_000,
    completionPrice: 0.6 / 1_000_000,
    supportsVision: false,
    provider: "fireworks",
    source: "curated",
    effectiveDate: "2026-04-19",
  },
  {
    id: "accounts/fireworks/models/minimax-m2p5",
    name: "MiniMax 2.5",
    promptPrice: 0.3 / 1_000_000,
    completionPrice: 1.2 / 1_000_000,
    supportsVision: false,
    provider: "fireworks",
    source: "curated",
    effectiveDate: "2026-04-19",
  },
];

export const MOONSHOT_MODELS: ProviderModelOption[] = [
  {
    id: "kimi-k2.6",
    name: "Kimi K2.6",
    promptPrice: 0.95 / 1_000_000,
    completionPrice: 4.0 / 1_000_000,
    supportsVision: true,
    provider: "moonshot",
    source: "curated",
    effectiveDate: "2026-04-22",
  },
  {
    id: "kimi-k2.5",
    name: "Kimi K2.5",
    promptPrice: 0.6 / 1_000_000,
    completionPrice: 3.0 / 1_000_000,
    supportsVision: true,
    provider: "moonshot",
    source: "curated",
    effectiveDate: "2026-04-22",
  },
];

export const XIAOMI_MODELS: ProviderModelOption[] = [
  {
    id: "mimo-v2-omni",
    name: "MiMo V2 Omni",
    promptPrice: 0,
    completionPrice: 0,
    supportsVision: true,
    provider: "xiaomi",
    source: "curated",
    effectiveDate: "2026-04-29",
  },
  {
    id: "mimo-v2-pro",
    name: "MiMo V2 Pro",
    promptPrice: 0,
    completionPrice: 0,
    supportsVision: false,
    provider: "xiaomi",
    source: "curated",
    effectiveDate: "2026-04-29",
  },
  {
    id: "mimo-v2-flash",
    name: "MiMo V2 Flash",
    promptPrice: 0,
    completionPrice: 0,
    supportsVision: false,
    provider: "xiaomi",
    source: "curated",
    effectiveDate: "2026-04-29",
  },
];

export const DEEPSEEK_MODELS: ProviderModelOption[] = [
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    promptPrice: 0.14 / 1_000_000,
    completionPrice: 0.28 / 1_000_000,
    supportsVision: false,
    provider: "deepseek",
    source: "curated",
    effectiveDate: "2026-04-26",
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    promptPrice: 0.435 / 1_000_000,
    completionPrice: 0.87 / 1_000_000,
    supportsVision: false,
    provider: "deepseek",
    source: "curated",
    effectiveDate: "2026-04-26",
  },
];

export const GROQ_MODELS: ProviderModelOption[] = [
  {
    id: "openai/gpt-oss-120b",
    name: "OpenAI GPT-OSS 120B",
    promptPrice: 0.15 / 1_000_000,
    completionPrice: 0.6 / 1_000_000,
    supportsVision: false,
    provider: "groq",
    source: "curated",
    effectiveDate: "2026-04-19",
  },
  {
    id: "openai/gpt-oss-20b",
    name: "OpenAI GPT-OSS 20B",
    promptPrice: 0.075 / 1_000_000,
    completionPrice: 0.3 / 1_000_000,
    supportsVision: false,
    provider: "groq",
    source: "curated",
    effectiveDate: "2026-04-19",
  },
  {
    id: "meta-llama/llama-4-scout-17b-16e-instruct",
    name: "Llama 4 Scout 17B 16E",
    promptPrice: 0.11 / 1_000_000,
    completionPrice: 0.34 / 1_000_000,
    supportsVision: true,
    provider: "groq",
    source: "curated",
    effectiveDate: "2026-04-19",
  },
];

type ProviderMode =
  | "openrouter"
  | "openrouter-groq"
  | "openai-groq"
  | "fireworks"
  | "fireworks-deepseek"
  | "moonshot"
  | "xiaomi";
type ModelRole = "executor" | "planner" | "perception" | "writer";

export function getProviderModelOptions(args: {
  providerMode: ProviderMode;
  role: ModelRole;
  openRouterModels: ProviderModelOption[];
}): ProviderModelOption[] {
  const { providerMode, role, openRouterModels } = args;
  const filterExecutorModels = (models: ProviderModelOption[]) =>
    role === "executor"
      ? models.filter((model) => isExecutorModelAllowed(model.id, providerMode))
      : models;
  if (providerMode === "fireworks")
    return filterExecutorModels(FIREWORKS_MODELS);
  if (providerMode === "fireworks-deepseek") {
    return role === "executor"
      ? filterExecutorModels(FIREWORKS_MODELS)
      : DEEPSEEK_MODELS;
  }
  if (providerMode === "moonshot") return filterExecutorModels(MOONSHOT_MODELS);
  if (providerMode === "xiaomi") return filterExecutorModels(XIAOMI_MODELS);
  if (providerMode === "openrouter") {
    return filterExecutorModels(openRouterModels);
  }
  if (providerMode === "openrouter-groq") {
    return role === "executor"
      ? filterExecutorModels(openRouterModels)
      : GROQ_MODELS;
  }
  return role === "executor"
    ? filterExecutorModels(FIREWORKS_MODELS)
    : GROQ_MODELS;
}

export function getProviderModelCatalogNote(args: {
  providerMode: ProviderMode;
  role: ModelRole;
  hasOpenRouterKey: boolean;
}): string {
  const { providerMode, role, hasOpenRouterKey } = args;
  if (providerMode === "fireworks") {
    return role === "executor"
      ? "Scoped to multimodal Fireworks executor models with curated pricing."
      : "Scoped to Fireworks models with curated pricing.";
  }
  if (providerMode === "fireworks-deepseek") {
    return role === "executor"
      ? "Executor models come from multimodal Fireworks models with curated pricing."
      : "Scoped to DeepSeek planner models with curated pricing.";
  }
  if (providerMode === "moonshot") {
    return role === "executor"
      ? "Scoped to multimodal Moonshot executor models with curated pricing."
      : "Scoped to Moonshot models with curated pricing.";
  }
  if (providerMode === "xiaomi") {
    return role === "executor"
      ? "Scoped to MiMo V2 Omni for multimodal Xiaomi executor runs. Pricing is unknown until Xiaomi publishes official rates."
      : "Scoped to curated Xiaomi MiMo planner models. Pricing is unknown until Xiaomi publishes official rates.";
  }
  if (providerMode === "openrouter") {
    if (role === "writer")
      return hasOpenRouterKey
        ? "Optional. Live OpenRouter catalog — pick a prose-strong model (e.g. a GPT/Claude writer). Leave empty to reuse the executor."
        : "Optional. Add an OpenRouter key to choose a dedicated Writer model.";
    return hasOpenRouterKey
      ? role === "executor"
        ? "Live OpenRouter catalog filtered to multimodal executor models."
        : "Live OpenRouter catalog with current provider pricing."
      : "Add an OpenRouter key to browse the live OpenRouter catalog.";
  }
  if (providerMode === "openrouter-groq") {
    return role === "executor"
      ? hasOpenRouterKey
        ? "Executor models come from the live OpenRouter catalog, filtered to multimodal models."
        : "Add an OpenRouter key to browse executor models."
      : "Scoped to Groq models with curated pricing.";
  }
  return role === "executor"
    ? "Executor currently uses multimodal Fireworks models through the OpenAI-compatible endpoint."
    : "Scoped to Groq models with curated pricing.";
}

interface CacheEntry {
  models: ProviderModelOption[];
  key: string;
}

let moduleCache: CacheEntry | null = null;

export function useOpenRouterModels(apiKey: string) {
  const [models, setModels] = useState<ProviderModelOption[]>(
    moduleCache?.key === apiKey ? moduleCache.models : [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedKeyRef = useRef<string>("");

  useEffect(() => {
    if (!apiKey) {
      setModels([]);
      setError(null);
      fetchedKeyRef.current = "";
      return;
    }

    // Use cache if key matches
    if (moduleCache?.key === apiKey) {
      setModels(moduleCache.models);
      return;
    }

    // Already fetching for this key
    if (fetchedKeyRef.current === apiKey) return;
    fetchedKeyRef.current = apiKey;

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        const parsed: ProviderModelOption[] = (json.data || [])
          .map((m: any) => ({
            id: m.id as string,
            name: (m.name as string) || m.id,
            promptPrice: parseFloat(m.pricing?.prompt || "0"),
            completionPrice: parseFloat(m.pricing?.completion || "0"),
            supportsVision:
              m.architecture?.modality?.includes("image") ??
              m.architecture?.input_modalities?.includes("image") ??
              false,
            provider: "openrouter" as const,
            source: "live" as const,
          }))
          .sort((a: ProviderModelOption, b: ProviderModelOption) =>
            a.name.localeCompare(b.name),
          );

        moduleCache = { models: parsed, key: apiKey };
        setModels(parsed);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
        fetchedKeyRef.current = "";
      });

    return () => {
      cancelled = true;
    };
  }, [apiKey]);

  return { models, loading, error };
}
