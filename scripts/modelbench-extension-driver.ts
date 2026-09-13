import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { ScenarioRunV2 } from "@opensidebar/scenario-contracts";
import { createE2EHarness } from "../apps/extension/tests/e2e/helpers/harness.js";
import {
  openHelperPage,
  withLiveServiceWorker,
} from "../apps/extension/tests/e2e/helpers/browser.js";
import {
  getActiveTabId,
  getMonitoredEventsWithControlLane,
  navigateAndWait,
  sendUserChat,
  startApprovalAutoResponder,
} from "../apps/extension/tests/e2e/helpers/utils.js";
import type {
  ModelBenchDriver,
  ModelBenchDriverInput,
  ModelBenchDriverResult,
} from "./modelbench-runner-lib.js";
import {
  E2E_CREATE_WORKSPACE_MESSAGE_TYPE,
  E2E_TEST_API_ENABLED_STORAGE_KEY,
} from "../apps/extension/src/background/e2e-test-api.js";
import { startModelBenchTargetServer } from "./modelbench-target-server.js";
import { collectModelBenchTraceEvidence } from "./modelbench-trace-evidence.js";
import { observeProviderCall, providerSlugsFromCatalog, summarizeProviderCalls, type ProviderCallEvidence } from "./modelbench-provider-evidence.js";

type EventRecord = Record<string, any>;

interface DriverOutcome {
  kind: "completion" | "clarification" | "timeout";
  events: EventRecord[];
  event?: EventRecord;
}

export function observedTabOpeningAction(turns: readonly EventRecord[]): boolean {
  return turns.some((turn) =>
    Array.isArray(turn.toolCalls) &&
    turn.toolCalls.some((call: EventRecord) =>
      call?.name === "create_tab" || call?.name === "click_element"
    )
  );
}

async function collectBrowserDriverEvidence(input: {
  worker: Parameters<typeof getMonitoredEventsWithControlLane>[0];
  sourceTabId: number;
  targetOrigin: string;
  turns: readonly EventRecord[];
}): Promise<Record<string, boolean>> {
  const browserState = await input.worker.evaluate(
    async ({ sourceTabId, targetOrigin }) => {
      const source = await chrome.tabs.get(sourceTabId).catch(() => null);
      const tabs = source
        ? await chrome.tabs.query({ windowId: source.windowId })
        : [];
      const linked = tabs.find((tab) =>
        tab.id !== sourceTabId &&
        typeof tab.url === "string" &&
        tab.url.startsWith(targetOrigin) &&
        tab.url.includes("view=linked-resource")
      ) ?? null;
      const active = tabs.find((tab) => tab.active) ?? null;
      const [sourcePanel, linkedPanel] = await Promise.all([
        chrome.sidePanel.getOptions({ tabId: sourceTabId }).catch(() => null),
        linked?.id
          ? chrome.sidePanel.getOptions({ tabId: linked.id }).catch(() => null)
          : Promise.resolve(null),
      ]);
      const validGroup =
        typeof source?.groupId === "number" &&
        source.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE;
      return {
        linkedResourceOpened: Boolean(linked),
        spawnedTabInWorkspaceGroup: Boolean(
          linked && validGroup && linked.groupId === source?.groupId,
        ),
        sourcePanelEnabled: sourcePanel?.enabled === true,
        spawnedPanelEnabled: linkedPanel?.enabled === true,
        returnedToSourceTab: active?.id === sourceTabId,
      };
    },
    { sourceTabId: input.sourceTabId, targetOrigin: input.targetOrigin },
  );
  return {
    ...browserState,
    openingActionObserved:
      browserState.linkedResourceOpened ||
      observedTabOpeningAction(input.turns),
  };
}

/**
 * Bind the case to the scenario target tab by origin, not to whatever happens
 * to be focused. The harness keeps a chrome-extension:// helper page open for
 * the whole run, and an active-tab lookup could bind a case to it -- content
 * scripts cannot be injected there, so every page tool then fails permanently
 * and no reload can recover it.
 */
export async function resolveTargetTabId(
  worker: Parameters<typeof getActiveTabId>[0],
  targetOrigin: string,
): Promise<number> {
  const byOrigin = await worker.evaluate(async (origin: string) => {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const match =
      tabs.find(
        (tab) =>
          tab.active && typeof tab.url === "string" && tab.url.startsWith(origin),
      ) ??
      tabs.find(
        (tab) => typeof tab.url === "string" && tab.url.startsWith(origin),
      );
    return match?.id ?? -1;
  }, targetOrigin);
  if (byOrigin > 0) return byOrigin;
  // Fall back to the previous behavior rather than failing outright.
  return getActiveTabId(worker);
}

async function createGroupedWorkspace(
  harness: ReturnType<typeof createE2EHarness>,
  tabId: number,
): Promise<string> {
  const workspaceId = `modelbench-${crypto.randomUUID()}`;
  const helperPage = await openHelperPage(harness.ctx);
  const response = await helperPage.evaluate(
    async (input) => {
      await chrome.storage.local.set({ [input.enabledKey]: true });
      return chrome.runtime.sendMessage({
        type: input.messageType,
        payload: {
          tabId: input.tabId,
          workspaceId: input.workspaceId,
          name: "ModelBench",
        },
      });
    },
    {
      enabledKey: E2E_TEST_API_ENABLED_STORAGE_KEY,
      messageType: E2E_CREATE_WORKSPACE_MESSAGE_TYPE,
      tabId,
      workspaceId,
    },
  );
  if (!response?.ok || response.workspaceId !== workspaceId) {
    throw new Error(
      response?.detail ?? "Could not create the MB-101 source workspace group.",
    );
  }
  return workspaceId;
}

const E2E_ENV_NAMES = [
  "E2E_PROFILE",
  "E2E_PROVIDER",
  "E2E_MODEL",
  "E2E_PLANNER_MODEL",
  "E2E_JUDGE_MODEL",
  "E2E_EXECUTOR_PROVIDER_PIN",
  "E2E_PLANNER_PROVIDER_PIN",
  "E2E_JUDGE_PROVIDER_PIN",
  "E2E_PERCEPTION_MODE",
] as const;

function configureEnvironment(input: ModelBenchDriverInput): () => void {
  const previous = new Map<string, string | undefined>();
  for (const name of E2E_ENV_NAMES) previous.set(name, process.env[name]);
  const seats = input.configuration.seats;
  const values: Partial<Record<(typeof E2E_ENV_NAMES)[number], string>> = {
    E2E_PROFILE: process.env.MODEL_BENCH_E2E_PROFILE ?? "ci",
    E2E_PROVIDER: input.configuration.provider,
    E2E_MODEL: seats.executor?.model,
    E2E_PLANNER_MODEL: seats.planner?.model,
    E2E_JUDGE_MODEL: seats.judge?.model,
    E2E_EXECUTOR_PROVIDER_PIN: seats.executor?.providerPin,
    E2E_PLANNER_PROVIDER_PIN: seats.planner?.providerPin,
    E2E_JUDGE_PROVIDER_PIN: seats.judge?.providerPin,
    E2E_PERCEPTION_MODE: input.configuration.perceptionMode,
  };
  for (const name of E2E_ENV_NAMES) {
    const value = values[name];
    if (value) process.env[name] = value;
    else delete process.env[name];
  }
  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

export function modelBenchSettingsPatch(
  input: ModelBenchDriverInput,
): Record<string, string | boolean> {
  const seats = input.configuration.seats;
  return {
    providerMode: input.configuration.provider,
    strictModelRouting: true,
    useNitro: false,
    ...(seats.executor?.model ? { executorModel: seats.executor.model } : {}),
    ...(seats.planner?.model ? { plannerModel: seats.planner.model } : {}),
    ...(seats.judge?.model ? { judgeModel: seats.judge.model } : {}),
    ...(seats.executor?.providerPin
      ? { executorProviderPin: seats.executor.providerPin }
      : {}),
    ...(seats.planner?.providerPin
      ? { plannerProviderPin: seats.planner.providerPin }
      : {}),
    ...(seats.judge?.providerPin
      ? { judgeProviderPin: seats.judge.providerPin }
      : {}),
    ...(input.configuration.perceptionMode
      ? { perceptionMode: input.configuration.perceptionMode }
      : {}),
  };
}

async function applyModelBenchSettings(
  ctx: Parameters<typeof openHelperPage>[0],
  input: ModelBenchDriverInput,
): Promise<Record<string, string>> {
  const expected = modelBenchSettingsPatch(input);
  const helper = await openHelperPage(ctx);
  const applied = await helper.evaluate(async (patch) => {
    const stored = await chrome.storage.sync.get("userSettings");
    const current =
      stored.userSettings && typeof stored.userSettings === "object"
        ? stored.userSettings
        : {};
    await chrome.storage.sync.set({ userSettings: { ...current, ...patch } });
    const verified = await chrome.storage.sync.get("userSettings");
    const settings = (verified.userSettings ?? {}) as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(patch).map((key) => [key, String(settings[key] ?? "")]),
    );
  }, expected);
  for (const [key, value] of Object.entries(expected)) {
    if (applied[key] !== String(value)) {
      throw new Error(
        `ModelBench setting '${key}' did not apply: expected '${value}', received '${applied[key] ?? ""}'.`,
      );
    }
  }
  return applied;
}

function workspaceEvents(events: EventRecord[], workspaceId: string): EventRecord[] {
  return events.filter(
    (event) => event.workspaceId == null || event.workspaceId === workspaceId,
  );
}

function eventStatus(event: EventRecord): string {
  return String(event.status ?? event.payload?.status ?? "");
}

export function extractModelBenchOutcome(events: EventRecord[]): DriverOutcome | null {
  const clarification = [...events]
    .reverse()
    .find(
      (event) =>
        event.type === "CLARIFICATION_REQUEST" &&
        (event.clarificationId ?? event.payload?.clarificationId),
    );
  if (clarification) return { kind: "clarification", event: clarification, events };
  const completion = [...events].reverse().find(
    (event) =>
      event.type === "TASK_COMPLETION" &&
      ["completed", "partial", "failed", "stopped"].includes(eventStatus(event)),
  );
  if (completion) return { kind: "completion", event: completion, events };
  const terminalStatus = [...events].reverse().find(
    (event) => event.type === "AGENT_STATUS" && eventStatus(event) === "ERROR",
  );
  return terminalStatus
    ? { kind: "completion", event: terminalStatus, events }
    : null;
}

/** Preserve user-visible terminal evidence even when the trace transport fails. */
export function terminalInteractionEvidence(outcome: DriverOutcome) {
  const event = outcome.event;
  if (!event) return undefined;
  const payload = event.payload ?? event;
  return {
    type: event.type,
    status: eventStatus(event),
    ...(outcome.kind === "clarification" ? {
      clarificationId: payload.clarificationId,
      question: typeof payload.question === "string" ? payload.question : undefined,
      suggestions: Array.isArray(payload.suggestions)
        ? payload.suggestions.filter((value: unknown) => typeof value === "string")
        : [],
    } : {
      summary: typeof payload.summary === "string" ? payload.summary : undefined,
      terminationReason: payload.terminationReason,
    }),
  };
}

export function extractStoredModelBenchOutcome(
  messages: unknown,
  workspaceId: string,
): DriverOutcome | null {
  if (!Array.isArray(messages)) return null;
  const message = [...messages].reverse().find((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return false;
    }
    const completionData = (candidate as EventRecord).completionData;
    return (
      completionData &&
      typeof completionData === "object" &&
      ["completed", "partial", "failed", "stopped"].includes(
        String(completionData.status),
      )
    );
  }) as EventRecord | undefined;
  if (!message) return null;
  const event: EventRecord = {
    type: "TASK_COMPLETION",
    workspaceId,
    timestamp: message.timestamp ?? Date.now(),
    payload: message.completionData,
  };
  return extractModelBenchOutcome([event]);
}

async function readStoredOutcome(
  worker: Parameters<typeof getMonitoredEventsWithControlLane>[0],
  workspaceId: string,
): Promise<DriverOutcome | null> {
  try {
    const messages = await worker.evaluate(async (storageKey: string) => {
      const stored = await chrome.storage.local.get(storageKey);
      return stored[storageKey] ?? null;
    }, `chatMessages:${workspaceId}`);
    return extractStoredModelBenchOutcome(messages, workspaceId);
  } catch {
    return null;
  }
}

async function waitForOutcome(
  worker: Parameters<typeof getMonitoredEventsWithControlLane>[0],
  workspaceId: string,
  timeoutMs: number,
): Promise<DriverOutcome> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const events = workspaceEvents(
      await getMonitoredEventsWithControlLane(worker, 160),
      workspaceId,
    );
    const outcome = extractModelBenchOutcome(events) ??
      await readStoredOutcome(worker, workspaceId);
    if (outcome) {
      return outcome.events === events
        ? outcome
        : { ...outcome, events: [...events, ...outcome.events] };
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  const events = workspaceEvents(
    await getMonitoredEventsWithControlLane(worker, 160),
    workspaceId,
  );
  const stored = await readStoredOutcome(worker, workspaceId);
  return stored
    ? { ...stored, events: [...events, ...stored.events] }
    : { kind: "timeout", events };
}

function terminalSummary(outcome: DriverOutcome): string | undefined {
  const value =
    outcome.event?.payload?.summary ??
    outcome.event?.summary ??
    outcome.event?.detail ??
    outcome.event?.payload?.detail;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function finalAnswer(outcome: DriverOutcome): string | undefined {
  // Failed/partial/stopped summaries and status details are diagnostic prose:
  // they may quote a rejected answer without actually delivering that answer.
  // State-based and clarification verdicts remain independent of this field.
  if (
    outcome.kind !== "completion" ||
    outcome.event?.type !== "TASK_COMPLETION" ||
    eventStatus(outcome.event) !== "completed"
  ) return undefined;
  const value = outcome.event.payload?.summary ?? outcome.event.summary;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function terminalOutcome(outcome: DriverOutcome, run: ScenarioRunV2): string | undefined {
  const caseState = run.state.data.public;
  const structured =
    caseState && typeof caseState === "object" && !Array.isArray(caseState) &&
    caseState.case && typeof caseState.case === "object" && !Array.isArray(caseState.case)
      ? caseState.case.outcome
      : undefined;
  if (typeof structured === "string" && structured.trim()) return structured.trim();
  if (outcome.kind === "clarification") return "clarification";
  const value = outcome.event?.outcome ?? outcome.event?.payload?.outcome;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function providerError(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : String(error);
  return /api key|provider|rate limit|(?:http(?: status)?|status|error|response)\b[^\r\n]{0,12}\b429\b|\b429\s+(?:too many requests|rate limit)|quota|model unavailable|failed to fetch/i.test(
    detail,
  );
}

export function providerFailureReason(outcome: DriverOutcome): string | undefined {
  const answer = terminalSummary(outcome);
  return answer && providerError(answer) ? answer : undefined;
}

export function harnessFailureReason(outcome: DriverOutcome): string | undefined {
  if (eventStatus(outcome.event ?? {}) === "completed") return undefined;
  const answer = terminalSummary(outcome);
  return answer &&
    /content script disconnected|reinjection failed|extension context invalidated|receiving end does not exist|message port closed/i.test(
      answer,
    )
    ? answer
    : undefined;
}

async function preflightProviderNetwork(
  provider: string,
  ctx: Parameters<typeof openHelperPage>[0],
  calls: ProviderCallEvidence[],
): Promise<Record<string, string>> {
  if (provider !== "openrouter") return {};
  const page = await openHelperPage(ctx);
  await page.exposeFunction("recordModelBenchProviderCall", (request: string, response: string, status: number, durationMs: number) => {
    calls.push(observeProviderCall(request, response, status, durationMs));
  });
  const result = await page.evaluate(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch("https://openrouter.ai/api/v1/providers", {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Provider catalog HTTP ${response.status}`);
      const catalog = await response.json();
      if (!Array.isArray(catalog.data)) throw new Error("Invalid provider catalog response");
      return { ok: true, providers: catalog.data };
    } catch (error) {
      return {
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  });
  if (!result.ok) {
    throw new Error(`OpenRouter network preflight failed: ${result.detail}`);
  }

  // Chrome for Testing can indefinitely suspend external fetches made by an
  // attached MV3 service worker even though the same extension-origin request
  // succeeds in a page. Keep this workaround in the E2E driver: it transports
  // the unchanged HTTP request through the helper page and reconstructs the
  // response in the worker. No benchmark state or task data is involved.
  await page.evaluate(() => {
    const marker = "__openSidebarE2ENetworkProxyInstalled";
    const scope = globalThis as typeof globalThis & Record<string, unknown>;
    if (scope[marker]) return;
    scope[marker] = true;
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type !== "E2E_NETWORK_PROXY_FETCH") return false;
      void (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120_000);
        const startedAt = Date.now();
        try {
          const response = await fetch(message.url, {
            method: message.method,
            headers: message.headers,
            body: message.body,
            cache: "no-store",
            signal: controller.signal,
          });
          const responseBody = await response.text();
          const recordCall = scope.recordModelBenchProviderCall as (request: string, response: string, status: number, durationMs: number) => Promise<void>;
          await recordCall(message.body, responseBody, response.status, Date.now() - startedAt);
          sendResponse({
            ok: true,
            status: response.status,
            statusText: response.statusText,
            headers: [...response.headers.entries()],
            body: responseBody,
          });
        } catch (error) {
          sendResponse({
            ok: false,
            detail: error instanceof Error ? error.message : String(error),
          });
        } finally {
          clearTimeout(timer);
        }
      })();
      return true;
    });
  });

  await withLiveServiceWorker(ctx, (worker) =>
    worker.evaluate(() => {
      const marker = "__openSidebarE2ENetworkProxyInstalled";
      const scope = globalThis as typeof globalThis & Record<string, unknown>;
      if (scope[marker]) return;
      scope[marker] = true;
      const nativeFetch = globalThis.fetch.bind(globalThis);
      globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        if (new URL(request.url).origin !== "https://openrouter.ai") {
          return nativeFetch(input, init);
        }
        const body = ["GET", "HEAD"].includes(request.method)
          ? undefined
          : await request.text();
        const result = await chrome.runtime.sendMessage({
          type: "E2E_NETWORK_PROXY_FETCH",
          url: request.url,
          method: request.method,
          headers: Object.fromEntries(request.headers.entries()),
          body,
        });
        if (!result?.ok) {
          throw new TypeError(result?.detail || "E2E network proxy failed.");
        }
        return new Response(result.body, {
          status: result.status,
          statusText: result.statusText,
          headers: result.headers,
        });
      };
    }),
  );
  return providerSlugsFromCatalog(result.providers);
}

async function readRun(origin: string, runId: string): Promise<ScenarioRunV2> {
  const response = await fetch(`${origin}/api/v2/modelbench/runs/${encodeURIComponent(runId)}`);
  if (!response.ok) throw new Error(`ModelBench run read failed (${response.status}).`);
  return (await response.json() as { run: ScenarioRunV2 }).run;
}

export async function createModelBenchDriver(): Promise<ModelBenchDriver> {
  if (process.env.MODEL_BENCH_SKIP_TARGET_BUILD !== "1") {
    const { build } = await import("vite");
    await build({ configFile: resolve("apps/sandbox/vite.config.ts") });
  }
  if (process.env.MODEL_BENCH_SKIP_EXTENSION_BUILD !== "1") {
    for (const args of [
      ["node_modules/tsx/dist/cli.mjs", "scripts/build-prompts.ts"],
      ["node_modules/tsx/dist/cli.mjs", "scripts/check-inline-prompts.ts"],
      ["node_modules/tsx/dist/cli.mjs", "scripts/vite-clean.ts", "build", "--mode", "e2e"],
    ]) {
      execFileSync(process.execPath, args, { stdio: "inherit" });
    }
  }
  const target = await startModelBenchTargetServer();
  let closed = false;
  return {
    async execute(input): Promise<ModelBenchDriverResult> {
      const startedAt = Date.now();
      const restoreEnvironment = configureEnvironment(input);
      const harness = createE2EHarness({
        maxTurns: input.definition.contract.maxTurns,
        testLabel: `modelbench-${input.definition.contract.id}`,
        videoStart: "manual",
      });
      let beforeAllComplete = false;
      let beforeEachComplete = false;
      let workspaceId: string | null = null;
      let appliedSettings: Record<string, string> = {};
      const providerCalls: ProviderCallEvidence[] = [];
      let providerSlugs: Record<string, string> = {};
      let approvals: { stop(): Promise<void> } | null = null;
      try {
        const create = await fetch(`${target.origin}/api/v2/modelbench/runs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ caseId: input.definition.contract.id }),
        });
        if (!create.ok) throw new Error(`ModelBench run creation failed (${create.status}).`);
        const created = await create.json() as { runId: string; launchUrl: string };

        await harness.beforeAllHook();
        beforeAllComplete = true;
        if (!harness.apiKey) {
          throw new Error(`API key for E2E provider '${harness.providerMode}' is missing.`);
        }
        await harness.beforeEachHook();
        beforeEachComplete = true;
        appliedSettings = await applyModelBenchSettings(harness.ctx, input);
        providerSlugs = await preflightProviderNetwork(input.configuration.provider, harness.ctx, providerCalls);
        await navigateAndWait(harness.page, created.launchUrl);
        const tabId = await withLiveServiceWorker(harness.ctx, (worker) =>
          resolveTargetTabId(worker, target.origin),
        );
        if (tabId <= 0) {
          throw new Error(
            `ModelBench target tab (${target.origin}) was not found.`,
          );
        }
        workspaceId = await createGroupedWorkspace(harness, tabId);
        workspaceId = await sendUserChat(
          harness.ctx,
          input.definition.contract.prompt,
          tabId,
          workspaceId,
        );
        if (input.definition.contract.approvalPolicy === "confirm-consequential") {
          approvals = startApprovalAutoResponder(
            harness.ctx,
            harness.ctx.serviceWorker,
            workspaceId,
          );
        }

        const timeoutMs = Number(process.env.MODEL_BENCH_CASE_TIMEOUT_MS ?? 300_000);
        // A case can outlive the MV3 idle timer, so re-attach to a restarted
        // worker and read the run's real outcome instead of failing the case.
        const outcome = await withLiveServiceWorker(harness.ctx, (worker) =>
          waitForOutcome(
            worker,
            workspaceId,
            Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 300_000,
          ),
        );
        await approvals?.stop();
        approvals = null;
        const traceSummary = await harness.printTraceSummary(workspaceId);
        const evidence = collectModelBenchTraceEvidence({
          traceFiles: traceSummary.traceFiles,
          requestedSeats: input.configuration.seats,
        });
        const run = await readRun(target.origin, created.runId);
        const driverEvidence = await withLiveServiceWorker(
          harness.ctx,
          (worker) =>
            collectBrowserDriverEvidence({
              worker,
              sourceTabId: tabId,
              targetOrigin: target.origin,
              turns: traceSummary.turns,
            }),
        );
        const providerFailure = providerFailureReason(outcome);
        const harnessFailure = harnessFailureReason(outcome);
        const routing = input.configuration.provider === "openrouter"
          ? summarizeProviderCalls(providerCalls, input.configuration.seats, providerSlugs)
          : { ...evidence, issues: [], providerFailures: [] };
        return {
          durationMs: Date.now() - startedAt,
          finalState: run.state,
          finalAnswer: finalAnswer(outcome),
          terminalOutcome: terminalOutcome(outcome, run),
          driverEvidence,
          resolvedSeats: routing.resolvedSeats,
          usageByRole: routing.usageByRole,
          telemetry: evidence.telemetry,
          artifactRefs: evidence.artifactRefs,
          ...(providerFailure || routing.providerFailures.length > 0
            ? {
                failure: {
                  kind: "provider" as const,
                  reason: providerFailure || routing.providerFailures.join("; "),
                },
              }
            : harnessFailure
            ? {
                failure: {
                  kind: "harness" as const,
                  reason: harnessFailure,
                },
              }
            : traceSummary.traceFiles.length === 0
            ? { failure: { kind: "harness" as const, reason: "No agent trace was captured; terminal evidence alone is not an auditable trajectory." } }
            : routing.issues.length > 0
            ? { failure: { kind: "indeterminate" as const, reason: routing.issues.join("; ") } }
            : {}),
          diagnostics: {
            providerCalls: providerCalls.map((call) => ({ ...call, usage: { ...call.usage } })),
            providerSlugs,
            routingIssues: routing.issues,
            runId: created.runId,
            workspaceId,
            outcome: outcome.kind,
            terminalInteraction: terminalInteractionEvidence(outcome),
            agentTraceCaptured: traceSummary.traceFiles.length > 0,
            completionStatus: eventStatus(outcome.event ?? {}),
            runIds: evidence.runIds,
            ambiguousSeats: evidence.ambiguousSeats,
            imageArtifacts: evidence.imageArtifacts,
            pageUrls: evidence.pageUrls,
            canvasObserved: evidence.canvasObserved,
            appliedSettings,
            driverEvidence,
          },
        };
      } catch (error) {
        const partialRouting = input.configuration.provider === "openrouter"
          ? summarizeProviderCalls(providerCalls, input.configuration.seats, providerSlugs)
          : undefined;
        return {
          durationMs: Date.now() - startedAt,
          resolvedSeats: partialRouting?.resolvedSeats ?? {},
          usageByRole: partialRouting?.usageByRole ?? {},
          artifactRefs: [],
          failure: {
            kind: providerError(error) ? "provider" : "harness",
            reason: error instanceof Error ? error.message : String(error),
          },
          diagnostics: { workspaceId, providerCalls, providerSlugs, routingIssues: partialRouting?.issues ?? [] },
        };
      } finally {
        await approvals?.stop().catch(() => {});
        if (beforeEachComplete) {
          await harness.afterEachHook(
            `modelbench-${input.definition.contract.id}`,
          ).catch(() => {});
        }
        if (beforeAllComplete) {
          // Each attempt owns a fresh browser; resetting for a next test would
          // open another page and can stall delivery of the completed verdict.
          await harness.afterAllHook().catch(() => {});
        }
        restoreEnvironment();
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      await target.close();
    },
  };
}
