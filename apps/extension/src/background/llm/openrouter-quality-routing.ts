import { cloudEndpointMetadataFetch } from "./cloud-relay";

/** Strict planner routing. OpenRouter's native speed preferences are not gates. */
export const PLANNER_PROVIDER_LIMITS = {
  maxOutputUsdPerMillion: 1,
  minThroughputTps: 50,
  maxLatencySeconds: 2,
} as const;

export class PlannerRoutingError extends Error {}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const validSlug = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 128 &&
  /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(value);

type RankedEndpoint = {
  tag: string;
  throughput: number;
  latency: number;
  outputPrice: number;
};

export function rankEligibleEndpoints(endpoints: unknown[], model?: string): RankedEndpoint[] {
  const qualityFirst = model === "openai/gpt-6.1-sol";
  const ranked: RankedEndpoint[] = [];
  const verified = new Set<unknown>();
  for (const value of endpoints) {
    const endpoint = record(value);
    const throughput = record(endpoint.throughput_last_30m).p50 ?? (qualityFirst ? 0 : undefined);
    // OpenRouter endpoint latency percentiles are milliseconds, not seconds.
    const latencyMs = record(endpoint.latency_last_30m).p50 ?? (qualityFirst ? 0 : undefined);
    const latency = typeof latencyMs === "number" ? latencyMs / 1_000 : NaN;
    const rawPrice = record(endpoint.pricing).completion;
    const outputPrice =
      typeof rawPrice === "string" &&
      /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(rawPrice)
        ? Number(rawPrice) * 1_000_000
        : NaN;
    if (
      endpoint.status !== 0 ||
      !validSlug(endpoint.tag) ||
      (qualityFirst && /\/(?:flex|fast)$/.test(String(endpoint.tag))) ||
      typeof throughput !== "number" ||
      !Number.isFinite(throughput) ||
      typeof latency !== "number" ||
      !Number.isFinite(latency) ||
      latency < 0 ||
      !Number.isFinite(outputPrice) ||
      outputPrice < 0 ||
      (!qualityFirst && (throughput <= PLANNER_PROVIDER_LIMITS.minThroughputTps ||
        latency >= PLANNER_PROVIDER_LIMITS.maxLatencySeconds)) ||
      outputPrice > (qualityFirst ? 15 : PLANNER_PROVIDER_LIMITS.maxOutputUsdPerMillion) ||
      (qualityFirst && (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(String(record(endpoint.pricing).prompt ?? "")) ||
        Number(record(endpoint.pricing).prompt) * 1_000_000 > 5))
    )
      continue;
    ranked.push({ tag: endpoint.tag, throughput, latency, outputPrice });
    verified.add(value);
  }
  // A base slug also matches its variants. Never let an eligible base entry
  // admit an unverified variant (or an ineligible duplicate with the same tag).
  const eligible = ranked.filter((candidate) =>
    endpoints.every((endpoint) => {
      const tag = record(endpoint).tag;
      if (
        typeof tag !== "string" ||
        (tag !== candidate.tag && !tag.startsWith(`${candidate.tag}/`))
      )
        return true;
      return verified.has(endpoint);
    }),
  );
  return eligible.sort(
    (a, b) =>
      b.throughput - a.throughput ||
      a.latency - b.latency ||
      a.outputPrice - b.outputPrice ||
      a.tag.localeCompare(b.tag),
  );
}

export class OpenRouterQualityRouter {
  // Per-client cache keeps credentials and account-specific endpoint views isolated.
  private cache = new Map<
    string,
    { expiresAt: number; endpoints: unknown[] }
  >();

  async prepare(init: RequestInit, signal?: AbortSignal): Promise<RequestInit> {
    signal?.throwIfAborted();
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    const model = String(payload.model).replace(
      /(?::(?:nitro|floor|exacto))+$/,
      "",
    );
    const parts = model.split("/");
    if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i.test(model)) {
      throw new PlannerRoutingError(
        "OpenRouter planner quality gate requires a catalog model ID.",
      );
    }
    let cached = this.cache.get(model);
    if (!cached || cached.expiresAt <= Date.now()) {
      const headers = new Headers(init.headers);
      const cloud =
        headers.get("Authorization") === "Bearer __opensidebar_cloud__";
      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason);
      signal?.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(() => controller.abort(), 5_000);
      try {
        const response = cloud
          ? await cloudEndpointMetadataFetch(model, controller.signal)
          : await fetch(
              `https://openrouter.ai/api/v1/models/${parts.map(encodeURIComponent).join("/")}/endpoints`,
              { headers, signal: controller.signal },
            );
        if (!response.ok)
          throw new PlannerRoutingError(
            `Endpoint lookup HTTP ${response.status}`,
          );
        const result: unknown = await response.json();
        controller.signal.throwIfAborted();
        const endpoints = record(record(result).data).endpoints;
        if (!Array.isArray(endpoints))
          throw new PlannerRoutingError("Missing endpoint metadata");
        cached = { endpoints, expiresAt: Date.now() + 60_000 };
        this.cache.set(model, cached);
      } catch {
        signal?.throwIfAborted();
        throw new PlannerRoutingError(
          `OpenRouter planner quality gate: unable to verify providers for ${model}.`,
        );
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
      }
    }
    signal?.throwIfAborted();
    const qualityFirst = model === "openai/gpt-6.1-sol";
    const ranked = rankEligibleEndpoints(cached.endpoints, model);
    if (!ranked.length) {
      throw new PlannerRoutingError(
        qualityFirst
          ? `OpenRouter planner quality gate: no available provider for ${model} meets input ≤$5/M and output ≤$15/M.`
          : `OpenRouter planner quality gate: no verified provider for ${model} meets output ≤$1/M, throughput >50 tokens/sec, and median time to first token <2s. Missing metrics are excluded.`,
      );
    }
    const only = [...new Set(ranked.map((endpoint) => endpoint.tag))];
    // An explicit preference can reorder eligible hosts, but cannot admit others.
    const preferred = (
      payload.provider as { order?: string[] } | undefined
    )?.order?.[0]?.toLowerCase();
    const order = preferred
      ? [
          ...only.filter(
            (tag) =>
              tag.toLowerCase() === preferred ||
              tag.toLowerCase().startsWith(`${preferred}/`),
          ),
          ...only.filter(
            (tag) =>
              tag.toLowerCase() !== preferred &&
              !tag.toLowerCase().startsWith(`${preferred}/`),
          ),
        ]
      : only;
    payload.model = model; // Nitro must not expand eligibility to priority variants.
    payload.provider = {
      only,
      order,
      allow_fallbacks: false,
      require_parameters: true,
      max_price: qualityFirst
        ? { prompt: 5, completion: 15 }
        : { completion: PLANNER_PROVIDER_LIMITS.maxOutputUsdPerMillion },
    };
    if (qualityFirst) {
      // Explicit quality-first planner selection: no unsupported sampling controls.
      delete payload.temperature;
      payload.reasoning = { effort: "high" };
    }
    return { ...init, body: JSON.stringify(payload) };
  }
}
