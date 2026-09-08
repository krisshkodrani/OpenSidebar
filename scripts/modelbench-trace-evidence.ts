import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import type {
  ModelSeat,
  PerceptionImageArtifactV1,
  PerceptionImageDetail,
  RequestedSeatV1,
  ResolvedSeatV1,
  RoleUsageV1,
} from "@opensidebar/scenario-contracts";
import { inspectPerceptionImage } from "./modelbench-image-artifacts.js";

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
  imageArtifacts: PerceptionImageArtifactV1[];
  pageUrls: string[];
  canvasObserved: boolean;
  telemetry: {
    turns: number;
    toolExecutions: number;
    perceptions: number;
    replans: number;
    recoveries: number;
    screenshotsCaptured: number;
    screenshotsReused: number;
    imagePrompts: number;
    lowDetailImagePrompts: number;
    highDetailImagePrompts: number;
    autoDetailImagePrompts: number;
    pageStateCoordinatorMode?: "shadow" | "authoritative";
    pageObservations: number;
    consistentPageObservations: number;
    inconsistentPageObservations: number;
    coordinatorConsistencyRetries: number;
    coordinatorShadowMismatches: number;
    actionReceipts: number;
    staleActionsBlocked: number;
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

function imageDetail(entry: JsonRecord): PerceptionImageDetail {
  const sections = entry.llmRequest?.contextMetrics?.promptSections ?? {};
  if (number(sections.highDetailImagePromptCount) > 0) return "high";
  if (number(sections.lowDetailImagePromptCount) > 0) return "low";
  if (number(sections.autoDetailImagePromptCount) > 0) return "auto";
  return "unknown";
}

function screenshotStatus(
  value: unknown,
): PerceptionImageArtifactV1["screenshotStatus"] {
  return value === "captured" || value === "cached" || value === "not_requested"
    ? value
    : "unknown";
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
  let screenshotsCaptured = 0;
  let screenshotsReused = 0;
  let imagePrompts = 0;
  let lowDetailImagePrompts = 0;
  let highDetailImagePrompts = 0;
  let autoDetailImagePrompts = 0;
  let pageStateCoordinatorMode: "shadow" | "authoritative" | undefined;
  let pageObservations = 0;
  let consistentPageObservations = 0;
  let inconsistentPageObservations = 0;
  let coordinatorConsistencyRetries = 0;
  let coordinatorShadowMismatches = 0;
  let actionReceipts = 0;
  let staleActionsBlocked = 0;
  const imageArtifacts = new Map<string, PerceptionImageArtifactV1>();
  const pageUrls = new Set<string>();
  let canvasObserved = false;

  for (const traceFile of input.traceFiles) {
    const path = resolve(traceFile);
    artifactRefs.add(path);
    for (const entry of lines(path)) {
      if (typeof entry.runId === "string") runIds.add(entry.runId);
      if (typeof entry.snapshot?.url === "string") {
        pageUrls.add(entry.snapshot.url);
      }
      if (
        Array.isArray(entry.elements) &&
        entry.elements.some(
          (element: JsonRecord) =>
            String(element?.tagName ?? "").toLocaleLowerCase() === "canvas",
        )
      ) {
        canvasObserved = true;
      }
      if (entry.traceKind === "agent.turn" || entry.llmResponse) turns += 1;
      if (Array.isArray(entry.toolExecutions)) toolExecutions += entry.toolExecutions.length;
      if (
        entry.llmRequest?.modelTier === "perception" ||
        number(entry.llmRequest?.contextMetrics?.promptSections?.imagePromptCount) > 0
      ) perceptions += 1;
      const sections = entry.llmRequest?.contextMetrics?.promptSections ?? {};
      imagePrompts += number(sections.imagePromptCount);
      lowDetailImagePrompts += number(sections.lowDetailImagePromptCount);
      highDetailImagePrompts += number(sections.highDetailImagePromptCount);
      autoDetailImagePrompts += number(sections.autoDetailImagePromptCount);
      if (entry.perception?.screenshotStatus === "captured") {
        screenshotsCaptured += 1;
      }
      const events = Array.isArray(entry.events) ? entry.events : [];
      for (const event of events) {
        if (event?.type === "page_observation") {
          pageObservations += 1;
          const consistency = String(event?.data?.consistency ?? "");
          if (consistency === "consistent") consistentPageObservations += 1;
          if (consistency === "inconsistent") inconsistentPageObservations += 1;
          const mode = event?.data?.coordinatorMode;
          if (mode === "shadow" || mode === "authoritative") {
            pageStateCoordinatorMode = mode;
          }
        } else if (event?.type === "page_observation_consistency_retry") {
          coordinatorConsistencyRetries += 1;
        } else if (event?.type === "page_observation_shadow_mismatch") {
          coordinatorShadowMismatches += 1;
        } else if (event?.type === "action_receipt") {
          actionReceipts += 1;
        } else if (event?.type === "stale_action_blocked") {
          staleActionsBlocked += 1;
        }
      }
      const screenshotReuseEvents = events.filter(
        (event: JsonRecord) => event?.type === "vl_screenshot_reused",
      ).length;
      screenshotsReused += screenshotReuseEvents;
      if (
        entry.perception?.screenshotStatus === "cached" &&
        screenshotReuseEvents === 0
      ) {
        screenshotsReused += 1;
      }
      const sessionId = typeof entry.sessionId === "string"
        ? entry.sessionId
        : basename(path, ".jsonl");
      const turnNumber = number(entry.turnNumber);
      if (turnNumber > 0 && entry.perception?.screenshotStatus) {
        const screenshotPath = resolve(
          tracesRoot,
          "screenshots",
          `${sessionId}-T${turnNumber}.jpg`,
        );
        if (existsSync(screenshotPath) && !imageArtifacts.has(screenshotPath)) {
          const artifact = inspectPerceptionImage({
            path: screenshotPath,
            detail: imageDetail(entry),
            turnNumber,
            screenshotStatus: screenshotStatus(entry.perception.screenshotStatus),
          });
          imageArtifacts.set(screenshotPath, artifact);
          artifactRefs.add(screenshotPath);
        }
      }
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
    imageArtifacts: [...imageArtifacts.values()],
    pageUrls: [...pageUrls],
    canvasObserved,
    telemetry: {
      turns,
      toolExecutions,
      perceptions,
      replans: Math.max(0, plannerCalls - 1),
      recoveries,
      screenshotsCaptured,
      screenshotsReused,
      imagePrompts,
      lowDetailImagePrompts,
      highDetailImagePrompts,
      autoDetailImagePrompts,
      ...(pageStateCoordinatorMode ? { pageStateCoordinatorMode } : {}),
      pageObservations,
      consistentPageObservations,
      inconsistentPageObservations,
      coordinatorConsistencyRetries,
      coordinatorShadowMismatches,
      actionReceipts,
      staleActionsBlocked,
    },
  };
}
