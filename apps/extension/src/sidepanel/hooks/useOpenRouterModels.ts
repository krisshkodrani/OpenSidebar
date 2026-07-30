import { useState, useEffect, useRef } from "react";
import { isExecutorEligible } from "../../utils/executor-model-policy";

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
    | "xiaomi"
    | "cerebras";
  source?: "live" | "curated";
  effectiveDate?: string;
  pricingKnown?: boolean;
}

export type OpenRouterModel = ProviderModelOption;

/** Format price per 1M tokens (input from per-token string) */
export function formatPrice(perToken: number): string {
  if (!Number.isFinite(perToken)) return "Unknown";
  const perMillion = perToken * 1_000_000;
  if (perMillion > 0 && perMillion < 0.01) return "<$0.01";
  return `$${perMillion.toFixed(2)}`;
}

/** Format input/output pricing as a compact badge string */
export function formatPricingBadge(model: ProviderModelOption): string {
  if (model.pricingKnown === false) return "Pricing unavailable";
  return `${formatPrice(model.promptPrice)} / ${formatPrice(model.completionPrice)} per 1M`;
}

export const FIREWORKS_MODELS: ProviderModelOption[] = [
  {
    id: "accounts/fireworks/models/glm-5p2",
    name: "GLM 5.2",
    promptPrice: 1.4 / 1_000_000,
    completionPrice: 4.4 / 1_000_000,
    supportsVision: false,
    provider: "fireworks",
    source: "curated",
    effectiveDate: "2026-07-21",
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
    id: "accounts/fireworks/models/kimi-k2p6",
    name: "Kimi K2.6",
    promptPrice: 2.0 / 1_000_000,
    completionPrice: 8.0 / 1_000_000,
    supportsVision: true,
    provider: "fireworks",
    source: "curated",
    effectiveDate: "2026-05-29",
  },
  {
    id: "accounts/fireworks/models/qwen3p7-plus",
    name: "Qwen3.7 Plus",
    promptPrice: 0.4 / 1_000_000,
    completionPrice: 1.6 / 1_000_000,
    supportsVision: true,
    provider: "fireworks",
    source: "curated",
    effectiveDate: "2026-07-17",
  },
  {
    id: "accounts/fireworks/models/minimax-m3",
    name: "MiniMax M3",
    promptPrice: 0.3 / 1_000_000,
    completionPrice: 1.2 / 1_000_000,
    supportsVision: false,
    provider: "fireworks",
    source: "curated",
    effectiveDate: "2026-07-27",
  },
  {
    // Fireworks API id form — the catalog-style "openai/gpt-oss-120b" 404s on
    // the Fireworks endpoint (judge-seat incident, 2026-07-10).
    id: "accounts/fireworks/models/gpt-oss-120b",
    name: "OpenAI GPT-OSS 120B",
    promptPrice: 0.15 / 1_000_000,
    completionPrice: 0.6 / 1_000_000,
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
    pricingKnown: false,
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
    pricingKnown: false,
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
    pricingKnown: false,
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

export const CEREBRAS_MODELS: ProviderModelOption[] = [
  {
    id: "gemma-4-31b",
    name: "Gemma 4 31B (Cerebras)",
    promptPrice: 0.99 / 1_000_000,
    completionPrice: 1.49 / 1_000_000,
    supportsVision: true,
    provider: "cerebras",
    source: "curated",
    effectiveDate: "2026-07-09",
  },
];

type ProviderMode =
  | "openrouter"
  | "openrouter-groq"
  | "openai-groq"
  | "fireworks"
  | "fireworks-deepseek"
  | "cerebras-fireworks"
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
      ? models.filter((model) => isExecutorEligible(model.id, providerMode))
      : models;
  if (providerMode === "fireworks")
    return filterExecutorModels(FIREWORKS_MODELS);
  if (providerMode === "fireworks-deepseek") {
    return role === "planner"
      ? DEEPSEEK_MODELS
      : filterExecutorModels(FIREWORKS_MODELS);
  }
  if (providerMode === "cerebras-fireworks") {
    return role === "planner"
      ? FIREWORKS_MODELS
      : filterExecutorModels(CEREBRAS_MODELS);
  }
  if (providerMode === "moonshot") return filterExecutorModels(MOONSHOT_MODELS);
  if (providerMode === "xiaomi") return filterExecutorModels(XIAOMI_MODELS);
  if (providerMode === "openrouter") {
    return filterExecutorModels(openRouterModels);
  }
  if (providerMode === "openrouter-groq") {
    return role === "planner"
      ? GROQ_MODELS
      : filterExecutorModels(openRouterModels);
  }
  return role === "planner"
    ? GROQ_MODELS
    : filterExecutorModels(FIREWORKS_MODELS);
}

export function getProviderModelCatalogNote(args: {
  providerMode: ProviderMode;
  role: ModelRole;
  hasOpenRouterKey: boolean;
}): string {
  const { providerMode, role, hasOpenRouterKey } = args;
  if (providerMode === "fireworks") {
    return role === "executor"
      ? "Scoped to vision-capable, executor-eligible Fireworks models with curated pricing."
      : "Scoped to Fireworks models with curated pricing.";
  }
  if (providerMode === "fireworks-deepseek") {
    return role === "planner"
      ? "Scoped to DeepSeek planner models with curated pricing."
      : "Scoped to Fireworks models with curated pricing.";
  }
  if (providerMode === "cerebras-fireworks") {
    return role === "planner"
      ? "Scoped to Fireworks planner models with curated pricing."
      : "Scoped to Cerebras models with curated pricing.";
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
    if (role === "planner")
      return "Scoped to Groq models with curated pricing.";
    return hasOpenRouterKey
      ? role === "executor"
        ? "Live OpenRouter catalog filtered to multimodal executor models."
        : "Optional. Live OpenRouter catalog; leave empty to reuse the executor."
      : "Add an OpenRouter key to browse models.";
  }
  return role === "executor"
    ? "Executor currently uses multimodal Fireworks models through the OpenAI-compatible endpoint."
    : "Scoped to Groq models with curated pricing.";
}

interface CacheEntry {
  models: ProviderModelOption[];
  key: string;
}

interface OpenRouterCatalogModel {
  id?: string;
  name?: string;
  pricing?: {
    prompt?: string | number;
    completion?: string | number;
  };
  architecture?: {
    modality?: string;
    input_modalities?: string[];
  };
}

function parseOpenRouterCatalog(json: unknown): ProviderModelOption[] {
  const data =
    json &&
    typeof json === "object" &&
    Array.isArray((json as { data?: unknown }).data)
      ? ((json as { data: OpenRouterCatalogModel[] }).data ?? [])
      : [];
  return data
    .filter(
      (model): model is OpenRouterCatalogModel & { id: string } =>
        typeof model.id === "string" && model.id.trim().length > 0,
    )
    .map((model) => ({
      id: model.id,
      name:
        typeof model.name === "string" && model.name.trim()
          ? model.name
          : model.id,
      promptPrice: Number(model.pricing?.prompt ?? 0),
      completionPrice: Number(model.pricing?.completion ?? 0),
      supportsVision: Boolean(
        model.architecture?.modality?.includes("image") ||
        model.architecture?.input_modalities?.includes("image"),
      ),
      provider: "openrouter" as const,
      source: "live" as const,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

let moduleCache: CacheEntry | null = null;

export function useOpenRouterModels(apiKey: string) {
  const normalizedKey = apiKey.trim();
  const [models, setModels] = useState<ProviderModelOption[]>(
    moduleCache?.key === normalizedKey ? moduleCache.models : [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedKeyRef = useRef<string>("");

  useEffect(() => {
    if (!normalizedKey) {
      setModels([]);
      setError(null);
      fetchedKeyRef.current = "";
      return;
    }

    // Use cache if key matches
    if (moduleCache?.key === normalizedKey) {
      setModels(moduleCache.models);
      return;
    }

    // Already fetching for this key
    if (fetchedKeyRef.current === normalizedKey) return;
    fetchedKeyRef.current = normalizedKey;

    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const timeout = window.setTimeout(() => {
      fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${normalizedKey}` },
        signal: controller.signal,
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((json) => {
          if (cancelled) return;
          const parsed = parseOpenRouterCatalog(json);

          moduleCache = { models: parsed, key: normalizedKey };
          setModels(parsed);
          setLoading(false);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setError(error instanceof Error ? error.message : String(error));
          setLoading(false);
          fetchedKeyRef.current = "";
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
      if (fetchedKeyRef.current === normalizedKey) {
        fetchedKeyRef.current = "";
      }
    };
  }, [normalizedKey]);

  return { models, loading, error };
}
