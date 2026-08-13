import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  ModelSeat,
  RequestedSeatV1,
  ResolvedSeatV1,
  RoleUsageV1,
} from "@opensidebar/scenario-contracts";

type JsonRecord = Record<string, any>;

interface ObservedCall {
  seat: ModelSeat;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  costUsd: number;
  llmTimeMs: number;
}

export interface ModelBenchTraceEvidence {
  resolvedSeats: Partial<Record<ModelSeat, ResolvedSeatV1>>;
  usageByRole: Partial<Record<ModelSeat, RoleUsageV1>>;
  artifactRefs: string[];
  runIds: string[];
  ambiguousSeats: Partial<Record<ModelSeat, string[]>>;
  telemetry: {
    turns: number;
    toolExecutions: number;
    perceptions: number;
    replans: number;
    recoveries: number;
  };
}

function number(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function lines(path: string): JsonRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as JsonRecord];
      } catch {
        return [];
      }
    });
}

function executorCall(entry: JsonRecord): ObservedCall | null {
  const response = entry.llmResponse;
  if (!response || typeof response !== "object") return null;
  const model = response.actualModel ?? entry.llmRequest?.model;
  const provider = response.actualProviderId;
  if (typeof model !== "string" || typeof provider !== "string") return null;
  const rawTier = String(entry.llmRequest?.modelTier ?? "executor");
  const seat: ModelSeat = rawTier === "perception" ? "perception" : "executor";
  const usage = response.usage ?? {};
  return {
    seat,
    model,
    provider,
    promptTokens: number(usage.promptTokens, usage.prompt_tokens),
    completionTokens: number(usage.completionTokens, usage.completion_tokens),
    cachedTokens: number(usage.cachedTokens, usage.cached_tokens),
    costUsd: number(usage.costUsd, usage.cost),
    llmTimeMs: number(response.durationMs),
  };
}

function orchestratorCall(entry: JsonRecord): ObservedCall | null {
  const data = entry.data ?? {};
  let seat: ModelSeat | null = null;
  if (entry.type === "planner_llm_call") seat = "planner";
  if (entry.type === "judge_call" && data.judged !== false) seat = "judge";
  if (!seat || typeof data.model !== "string") return null;
  const usage = data.usage ?? {};
  const provider = data.providerId ?? usage.cacheTelemetry?.provider;
  if (typeof provider !== "string") return null;
  return {
    seat,
    model: data.actualModel ?? data.model,
    provider,
    promptTokens: number(usage.promptTokens, usage.prompt_tokens),
    completionTokens: number(usage.completionTokens, usage.completion_tokens),
    cachedTokens: number(usage.cachedTokens, usage.cached_tokens),
    costUsd: number(usage.costUsd, usage.cost),
    llmTimeMs: number(data.durationMs),
  };
}

function aggregate(calls: readonly ObservedCall[]): RoleUsageV1 {
  return calls.reduce<RoleUsageV1>(
    (total, call) => ({
      calls: total.calls + 1,
      promptTokens: total.promptTokens + call.promptTokens,
      completionTokens: total.completionTokens + call.completionTokens,
      cachedTokens: total.cachedTokens + call.cachedTokens,
      costUsd: total.costUsd + call.costUsd,
      llmTimeMs: total.llmTimeMs + call.llmTimeMs,
    }),
    {
      calls: 0,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      costUsd: 0,
      llmTimeMs: 0,
    },
  );
}

export function collectModelBenchTraceEvidence(input: {
  traceFiles: readonly string[];
  requestedSeats: Partial<Record<ModelSeat, RequestedSeatV1>>;
  tracesRoot?: string;
}): ModelBenchTraceEvidence {
  const tracesRoot = resolve(input.tracesRoot ?? "traces");
  const runIds = new Set<string>();
  const artifactRefs = new Set<string>();
  const calls: ObservedCall[] = [];
  let turns = 0;
  let toolExecutions = 0;
  let perceptions = 0;
  let plannerCalls = 0;
  let recoveries = 0;

  for (const traceFile of input.traceFiles) {
    const path = resolve(traceFile);
    artifactRefs.add(path);
    for (const entry of lines(path)) {
      if (typeof entry.runId === "string") runIds.add(entry.runId);
      if (entry.traceKind === "agent.turn" || entry.llmResponse) turns += 1;
      if (Array.isArray(entry.toolExecutions)) toolExecutions += entry.toolExecutions.length;
      if (
        entry.llmRequest?.modelTier === "perception" ||
        number(entry.contextMetrics?.imagePromptCount) > 0
      ) perceptions += 1;
      const call = executorCall(entry);
      if (call) calls.push(call);
    }
  }
  for (const runId of runIds) {
    const path = resolve(tracesRoot, "runs", `${runId}.jsonl`);
    if (!existsSync(path)) continue;
    artifactRefs.add(path);
    for (const entry of lines(path)) {
      if (entry.type === "planner_llm_call") plannerCalls += 1;
      if (String(entry.type ?? "").toLocaleLowerCase().includes("recovery")) recoveries += 1;
      const call = orchestratorCall(entry);
      if (call) calls.push(call);
    }
  }

  const resolvedSeats: Partial<Record<ModelSeat, ResolvedSeatV1>> = {};
  const usageByRole: Partial<Record<ModelSeat, RoleUsageV1>> = {};
  const ambiguousSeats: Partial<Record<ModelSeat, string[]>> = {};
  const seats: ModelSeat[] = ["executor", "planner", "perception", "judge"];
  for (const seat of seats) {
    const seatCalls = calls.filter((call) => call.seat === seat);
    if (!seatCalls.length) continue;
    usageByRole[seat] = aggregate(seatCalls);
    const identities = [
      ...new Set(seatCalls.map((call) => `${call.provider}\u0000${call.model}`)),
    ];
    if (identities.length !== 1) {
      ambiguousSeats[seat] = identities.map((identity) => identity.replace("\u0000", ":"));
      continue;
    }
    const requested = input.requestedSeats[seat];
    if (!requested) continue;
    const [transportProvider, resolvedModel] = identities[0].split("\u0000");
    const resolvedProvider =
      transportProvider === "openrouter" &&
      requested.provider === "openrouter" &&
      requested.providerPin
        ? requested.providerPin
        : transportProvider;
    resolvedSeats[seat] = {
      ...requested,
      resolvedProvider,
      resolvedModel,
    };
  }

  return {
    resolvedSeats,
    usageByRole,
    artifactRefs: [...artifactRefs],
    runIds: [...runIds],
    ambiguousSeats,
    telemetry: {
      turns,
      toolExecutions,
      perceptions,
      replans: Math.max(0, plannerCalls - 1),
      recoveries,
    },
  };
}
