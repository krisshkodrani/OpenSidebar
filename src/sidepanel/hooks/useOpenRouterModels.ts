import { useState, useEffect, useRef } from "react";

export interface OpenRouterModel {
  id: string;
  name: string;
  promptPrice: number;
  completionPrice: number;
  supportsVision: boolean;
}

/** Format price per 1M tokens (input from per-token string) */
export function formatPrice(perToken: number): string {
  const perMillion = perToken * 1_000_000;
  if (perMillion < 0.01) return "$0.00";
  return `$${perMillion.toFixed(2)}`;
}

/** Format input/output pricing as a compact badge string */
export function formatPricingBadge(model: OpenRouterModel): string {
  return `${formatPrice(model.promptPrice)} / ${formatPrice(model.completionPrice)} per 1M`;
}

interface CacheEntry {
  models: OpenRouterModel[];
  key: string;
}

let moduleCache: CacheEntry | null = null;

export function useOpenRouterModels(apiKey: string) {
  const [models, setModels] = useState<OpenRouterModel[]>(
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
        const parsed: OpenRouterModel[] = (json.data || [])
          .map((m: any) => ({
            id: m.id as string,
            name: (m.name as string) || m.id,
            promptPrice: parseFloat(m.pricing?.prompt || "0"),
            completionPrice: parseFloat(m.pricing?.completion || "0"),
            supportsVision:
              m.architecture?.modality?.includes("image") ??
              m.architecture?.input_modalities?.includes("image") ??
              false,
          }))
          .sort((a: OpenRouterModel, b: OpenRouterModel) =>
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
