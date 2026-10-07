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

type ProviderMode = "openrouter";
export function getProviderModelOptions(args: {providerMode: ProviderMode; role: "executor" | "planner" | "writer"; openRouterModels: ProviderModelOption[]}): ProviderModelOption[] {
 return args.role === "executor" ? args.openRouterModels.filter(model=>isExecutorEligible(model.id, "openrouter")) : args.openRouterModels;
}
export function getProviderModelCatalogNote(args: {providerMode: ProviderMode; role: "executor" | "planner" | "writer"; hasOpenRouterKey: boolean}): string {
 if (!args.hasOpenRouterKey) return "Connect OpenRouter to browse the live model catalog.";
 return args.role === "executor" ? "Live OpenRouter catalog filtered to multimodal executor models." : "Live OpenRouter catalog with current pricing. Leave the writer empty to reuse the executor.";
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
