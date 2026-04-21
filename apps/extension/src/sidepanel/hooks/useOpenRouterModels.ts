import { useState, useEffect, useRef } from "react";

export interface ProviderModelOption {
  id: string;
  name: string;
  promptPrice: number;
  completionPrice: number;
  supportsVision: boolean;
  provider?: "openrouter" | "fireworks" | "groq";
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

type ProviderMode = "openrouter" | "openrouter-groq" | "openai-groq" | "fireworks";
type ModelRole = "executor" | "planner" | "perception";

export function getProviderModelOptions(args: {
  providerMode: ProviderMode;
  role: ModelRole;
  openRouterModels: ProviderModelOption[];
}): ProviderModelOption[] {
  const { providerMode, role, openRouterModels } = args;
  if (providerMode === "fireworks") return FIREWORKS_MODELS;
  if (providerMode === "openrouter") return openRouterModels;
  if (providerMode === "openrouter-groq") {
    return role === "executor" ? openRouterModels : GROQ_MODELS;
  }
  return role === "executor" ? FIREWORKS_MODELS : GROQ_MODELS;
}

export function getProviderModelCatalogNote(args: {
  providerMode: ProviderMode;
  role: ModelRole;
  hasOpenRouterKey: boolean;
}): string {
  const { providerMode, role, hasOpenRouterKey } = args;
  if (providerMode === "fireworks") {
    return "Scoped to Fireworks models with curated pricing.";
  }
  if (providerMode === "openrouter") {
    return hasOpenRouterKey
      ? "Live OpenRouter catalog with current provider pricing."
      : "Add an OpenRouter key to browse the live OpenRouter catalog.";
  }
  if (providerMode === "openrouter-groq") {
    return role === "executor"
      ? hasOpenRouterKey
        ? "Executor models come from the live OpenRouter catalog."
        : "Add an OpenRouter key to browse executor models."
      : "Scoped to Groq models with curated pricing.";
  }
  return role === "executor"
    ? "Executor currently uses the Fireworks-backed endpoint and curated Fireworks pricing."
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
