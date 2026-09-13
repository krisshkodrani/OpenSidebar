import type { ModelSeat, RequestedSeatV1, ResolvedSeatV1, RoleUsageV1 } from "@opensidebar/scenario-contracts";

export interface ProviderCallEvidence {
  requestedModel: string;
  model: string;
  provider: string;
  status: number;
  durationMs: number;
  usageReported: boolean;
  usage: RoleUsageV1;
}

/** Observe API metadata only; never infer the served identity from the request. */
export function observeProviderCall(request: string, response: string, status: number, durationMs: number): ProviderCallEvidence {
  const requestedModel = String(JSON.parse(request).model ?? "");
  const records: Record<string, any>[] = [];
  const appendRecord = (value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value)) records.push(value as Record<string, unknown>);
  };
  try { appendRecord(JSON.parse(response)); } catch {
    for (const line of response.split(/\r?\n/)) {
      if (!line.startsWith("data: ")) continue;
      try { appendRecord(JSON.parse(line.slice(6))); } catch { /* SSE comments/end marker */ }
    }
  }
  let model = "", provider = "";
  let usage: Record<string, any> = {};
  for (const record of records) {
    if (typeof record.model === "string") model = record.model;
    if (typeof record.provider === "string") provider = record.provider.toLowerCase();
    if (record.usage) usage = record.usage;
  }
  return {
    requestedModel, model, provider, status, durationMs,
    usageReported: typeof usage.cost === "number" && Number.isFinite(usage.cost),
    usage: {
      calls: 1,
      promptTokens: Number(usage.prompt_tokens ?? 0),
      completionTokens: Number(usage.completion_tokens ?? 0),
      cachedTokens: Number(usage.prompt_tokens_details?.cached_tokens ?? 0),
      costUsd: Number(usage.cost ?? 0), llmTimeMs: durationMs,
    },
  };
}

/** Resolve display names only from the provider's published catalog. */
export function providerSlugsFromCatalog(entries: unknown): Record<string, string> {
  const names = new Map<string, Set<string>>();
  if (!Array.isArray(entries)) return {};
  for (const entry of entries) {
    if (!entry || typeof entry.name !== "string" || typeof entry.slug !== "string") continue;
    const name = entry.name.trim().toLowerCase();
    const slug = entry.slug.trim().toLowerCase();
    if (!name || !slug) continue;
    const slugs = names.get(name) ?? new Set<string>();
    slugs.add(slug);
    names.set(name, slugs);
  }
  return Object.fromEntries([...names].filter(([, slugs]) => slugs.size === 1)
    .map(([name, slugs]) => [name, [...slugs][0]]));
}

export function summarizeProviderCalls(calls: ProviderCallEvidence[], seats: Partial<Record<ModelSeat, RequestedSeatV1>>, providerSlugs: Record<string, string> = {}) {
  const resolvedSeats: Partial<Record<ModelSeat, ResolvedSeatV1>> = {};
  const usageByRole: Partial<Record<ModelSeat, RoleUsageV1>> = {};
  const issues: string[] = [];
  if (!calls.length) issues.push("No provider response evidence was captured.");
  for (const call of calls) {
    const matches = Object.entries(seats).filter(([, seat]) => seat?.model === call.requestedModel);
    if (matches.length !== 1) { issues.push(`Unassigned or ambiguous model seat: ${call.requestedModel}`); continue; }
    const [role, requested] = matches[0] as [ModelSeat, RequestedSeatV1];
    const total = usageByRole[role] ?? { calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0, llmTimeMs: 0 };
    for (const key of Object.keys(total) as (keyof RoleUsageV1)[]) total[key] += call.usage[key];
    usageByRole[role] = total;
    if (call.status < 200 || call.status >= 300) continue;
    if (!call.usageReported) issues.push(`Missing reported cost for ${role}.`);
    const provider = Object.hasOwn(providerSlugs, call.provider)
      ? providerSlugs[call.provider] : call.provider;
    if (!call.model || !provider || call.model !== requested.model ||
        (requested.providerPin && provider !== requested.providerPin.toLowerCase())) {
      issues.push(`Unverified route for ${role}: ${call.provider || "unknown"}/${call.model || "unknown"}`);
      continue;
    }
    resolvedSeats[role] = { ...requested, resolvedModel: call.model, resolvedProvider: provider };
  }
  const providerFailures: string[] = [];
  for (const [role, seat] of Object.entries(seats)) {
    const roleCalls = calls.filter((call) => call.requestedModel === seat?.model);
    if (roleCalls.length && roleCalls.every((call) => call.status < 200 || call.status >= 300)) {
      providerFailures.push(`${role}: no successful provider response (HTTP ${[...new Set(roleCalls.map((call) => call.status))].join(", ")}).`);
    }
  }
  return { resolvedSeats, usageByRole, issues: [...new Set(issues)], providerFailures };
}
