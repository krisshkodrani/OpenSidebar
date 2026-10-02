import type { ModelSeat, RequestedSeatV1, ResolvedSeatV1, RoleUsageV1 } from "@opensidebar/scenario-contracts";

export interface ProviderCallEvidence {
  requestId?: string;
  role?: ModelSeat | "writer";
  requestedModel: string;
  model: string;
  provider: string;
  routeEvidenceConflict?: boolean;
  status: number;
  durationMs: number;
  usageReported: boolean;
  usage: RoleUsageV1;
}

/** Observe API metadata only; never infer the served identity from the request. */
export function observeProviderCall(
  request: string, response: string, status: number, durationMs: number,
  observation?: { role?: string; requestId?: string; providerName?: string },
): ProviderCallEvidence {
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
  const reportedModels = new Set<string>();
  const reportedProviders = new Set<string>();
  if (observation?.providerName) reportedProviders.add(observation.providerName.toLowerCase());
  const selectedRoutes = new Set<string>();
  let routeEvidenceConflict = false;
  let usage: Record<string, any> = {};
  for (const record of records) {
    if (typeof record.model === "string") reportedModels.add(record.model);
    if (typeof record.provider === "string") reportedProviders.add(record.provider.toLowerCase());
    const endpoints = record.openrouter_metadata?.endpoints?.available;
    if (Array.isArray(endpoints)) {
      const selected = endpoints.filter((endpoint) => endpoint?.selected === true);
      if (selected.length !== 1 || typeof selected[0].model !== "string" ||
          typeof selected[0].provider !== "string") {
        routeEvidenceConflict = true;
      } else {
        selectedRoutes.add(JSON.stringify([selected[0].model, selected[0].provider.toLowerCase()]));
      }
    }
    if (record.usage) usage = record.usage;
  }
  if (reportedModels.size > 1 || reportedProviders.size > 1 || selectedRoutes.size > 1) {
    routeEvidenceConflict = true;
  }
  model = [...reportedModels][0] ?? "";
  provider = [...reportedProviders][0] ?? "";
  if (selectedRoutes.size === 1) {
    const [selectedModel, selectedProvider] = JSON.parse([...selectedRoutes][0]) as [string, string];
    if ((model && model !== selectedModel) || (provider && provider !== selectedProvider)) {
      routeEvidenceConflict = true;
    }
    model = selectedModel;
    provider = selectedProvider;
  }
  return {
    ...(["executor", "planner", "perception", "judge", "writer"].includes(observation?.role ?? "") &&
      typeof observation?.requestId === "string" && observation.requestId.length > 0
      ? { role: observation.role as ModelSeat | "writer", requestId: observation.requestId } : {}),
    requestedModel, model, provider, routeEvidenceConflict, status, durationMs,
    usageReported: typeof usage.cost === "number" && Number.isFinite(usage.cost),
    usage: {
      calls: 1,
      promptTokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0),
      completionTokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0),
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
  const unattributedUsage: RoleUsageV1 = { calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0, llmTimeMs: 0 };
  const issues: string[] = [];
  if (!calls.length) issues.push("No provider response evidence was captured.");
  const roleForCall = (call: ProviderCallEvidence): ModelSeat | undefined => {
    if (call.role) {
      const role = call.role === "writer" ? "executor" : call.role;
      // With no writer seat in the benchmark contract, an unconfigured writer
      // reuses executor. A distinct writer route remains unattributed.
      if (call.role === "writer" && seats.executor?.model !== call.requestedModel) return undefined;
      return role;
    }
    const matches = Object.entries(seats).filter(([, seat]) => seat?.model === call.requestedModel);
    return matches.length === 1 ? matches[0][0] as ModelSeat : undefined;
  };
  const addUsage = (total: RoleUsageV1, usage: RoleUsageV1) => {
    for (const key of Object.keys(total) as (keyof RoleUsageV1)[]) total[key] += usage[key];
  };
  for (const call of calls) {
    const role = roleForCall(call);
    const requested = role && seats[role];
    if (!role || !requested) {
      addUsage(unattributedUsage, call.usage);
      issues.push(`Unassigned or ambiguous model seat: ${call.requestedModel}`);
      continue;
    }
    const total = usageByRole[role] ?? { calls: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0, llmTimeMs: 0 };
    addUsage(total, call.usage);
    usageByRole[role] = total;
    if (call.status < 200 || call.status >= 300) continue;
    if (!call.usageReported) issues.push(`Missing reported cost for ${role}.`);
    if (call.routeEvidenceConflict) {
      issues.push(`Conflicting route evidence for ${role}.`);
      continue;
    }
    const provider = Object.hasOwn(providerSlugs, call.provider)
      ? providerSlugs[call.provider] : call.provider;
    if (!call.model || !provider || call.requestedModel !== requested.model || call.model !== requested.model ||
        (requested.providerPin && provider !== requested.providerPin.toLowerCase())) {
      issues.push(`Unverified route for ${role}: ${call.provider || "unknown"}/${call.model || "unknown"}`);
      continue;
    }
    resolvedSeats[role] = { ...requested, resolvedModel: call.model, resolvedProvider: provider };
  }
  const providerFailures: string[] = [];
  for (const role of Object.keys(seats)) {
    const roleCalls = calls.filter((call) => roleForCall(call) === role);
    if (roleCalls.length && roleCalls.every((call) => call.status < 200 || call.status >= 300)) {
      providerFailures.push(`${role}: no successful provider response (HTTP ${[...new Set(roleCalls.map((call) => call.status))].join(", ")}).`);
    }
  }
  return { resolvedSeats, usageByRole, unattributedUsage, issues: [...new Set(issues)], providerFailures };
}

/** Compare captured API calls with calls recorded by the agent and orchestrator. */
export function reconcileProviderAndTraceUsage(
  provider: ReturnType<typeof summarizeProviderCalls>,
  traceUsageByRole: Partial<Record<ModelSeat, RoleUsageV1>>,
  orchestratorTotalCostUsd?: number,
) {
  const issues: string[] = [];
  for (const role of ["executor", "planner", "judge"] as const) {
    const traced = traceUsageByRole[role]?.calls ?? 0;
    const captured = provider.usageByRole[role]?.calls ?? 0;
    if (traced > captured) {
      issues.push(`Provider capture missed at least ${traced - captured} ${role} call(s) recorded in runtime traces.`);
    }
  }
  const providerReportedCostUsd = Object.values(provider.usageByRole).reduce(
    (sum, usage) => sum + usage.costUsd, provider.unattributedUsage.costUsd,
  );
  const traceRecordedCostUsd = Object.values(traceUsageByRole).reduce(
    (sum, usage) => sum + usage.costUsd, 0,
  );
  if (orchestratorTotalCostUsd !== undefined) {
    const difference = Math.abs(providerReportedCostUsd - orchestratorTotalCostUsd);
    if (difference > Math.max(0.00001, orchestratorTotalCostUsd * 0.01)) {
      issues.push(`Provider-reported cost differs from orchestrator total by $${difference.toFixed(6)}; cost attribution is unverified.`);
    }
  }
  return {
    providerReportedCostUsd,
    traceRecordedCostUsd,
    costDifferenceUsd: providerReportedCostUsd - traceRecordedCostUsd,
    ...(orchestratorTotalCostUsd !== undefined ? {
      orchestratorTotalCostUsd,
      providerVsOrchestratorCostUsd: providerReportedCostUsd - orchestratorTotalCostUsd,
    } : {}),
    issues,
  };
}
