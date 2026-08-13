import type { ScenarioRunV2 } from "@opensidebar/scenario-contracts";
import { createE2EHarness } from "../apps/extension/tests/e2e/helpers/harness.js";
import {
  getActiveTabId,
  getMonitoredEventsWithControlLane,
  navigateAndWait,
  resetExtensionState,
  sendUserChat,
  startApprovalAutoResponder,
} from "../apps/extension/tests/e2e/helpers/utils.js";
import type {
  ModelBenchDriver,
  ModelBenchDriverInput,
  ModelBenchDriverResult,
} from "./modelbench-runner-lib.js";
import { startModelBenchTargetServer } from "./modelbench-target-server.js";
import { collectModelBenchTraceEvidence } from "./modelbench-trace-evidence.js";

type EventRecord = Record<string, any>;

interface DriverOutcome {
  kind: "completion" | "clarification" | "timeout";
  events: EventRecord[];
  event?: EventRecord;
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

function workspaceEvents(events: EventRecord[], workspaceId: string): EventRecord[] {
  return events.filter(
    (event) => event.workspaceId == null || event.workspaceId === workspaceId,
  );
}

export function extractModelBenchOutcome(events: EventRecord[]): DriverOutcome | null {
  const clarification = [...events]
    .reverse()
    .find((event) => event.type === "CLARIFICATION_REQUEST" && event.clarificationId);
  if (clarification) return { kind: "clarification", event: clarification, events };
  const completion = [...events].reverse().find(
    (event) =>
      event.type === "TASK_COMPLETION" &&
      ["completed", "partial", "failed", "stopped"].includes(String(event.status)),
  );
  if (completion) return { kind: "completion", event: completion, events };
  const terminalStatus = [...events].reverse().find(
    (event) =>
      event.type === "AGENT_STATUS" &&
      (event.status === "ERROR" ||
        (event.status === "IDLE" &&
          ["completed", "partial", "failed", "stopped"].includes(
            String(event.completionStatus),
          ))),
  );
  return terminalStatus
    ? { kind: "completion", event: terminalStatus, events }
    : null;
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
    const outcome = extractModelBenchOutcome(events);
    if (outcome) return outcome;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return {
    kind: "timeout",
    events: workspaceEvents(
      await getMonitoredEventsWithControlLane(worker, 160),
      workspaceId,
    ),
  };
}

function finalAnswer(outcome: DriverOutcome): string | undefined {
  const value =
    outcome.event?.payload?.summary ??
    outcome.event?.summary ??
    outcome.event?.detail ??
    outcome.event?.payload?.detail;
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
  return /api key|provider|rate limit|429|quota|model unavailable|failed to fetch/i.test(detail);
}

async function readRun(origin: string, runId: string): Promise<ScenarioRunV2> {
  const response = await fetch(`${origin}/api/v2/modelbench/runs/${encodeURIComponent(runId)}`);
  if (!response.ok) throw new Error(`ModelBench run read failed (${response.status}).`);
  return (await response.json() as { run: ScenarioRunV2 }).run;
}

export async function createModelBenchDriver(): Promise<ModelBenchDriver> {
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
        await navigateAndWait(harness.page, created.launchUrl);
        const tabId = await getActiveTabId(harness.ctx.serviceWorker);
        if (tabId <= 0) throw new Error("ModelBench target tab was not active.");
        workspaceId = await sendUserChat(
          harness.ctx,
          input.definition.contract.prompt,
          tabId,
        );
        if (input.definition.contract.approvalPolicy === "confirm-consequential") {
          approvals = startApprovalAutoResponder(
            harness.ctx,
            harness.ctx.serviceWorker,
            workspaceId,
          );
        }

        const timeoutMs = Number(process.env.MODEL_BENCH_CASE_TIMEOUT_MS ?? 300_000);
        const outcome = await waitForOutcome(
          harness.ctx.serviceWorker,
          workspaceId,
          Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 300_000,
        );
        await approvals?.stop();
        approvals = null;
        const traceSummary = await harness.printTraceSummary(workspaceId);
        const evidence = collectModelBenchTraceEvidence({
          traceFiles: traceSummary.traceFiles,
          requestedSeats: input.configuration.seats,
        });
        const run = await readRun(target.origin, created.runId);
        return {
          durationMs: Date.now() - startedAt,
          finalState: run.state,
          finalAnswer: finalAnswer(outcome),
          terminalOutcome: terminalOutcome(outcome, run),
          resolvedSeats: evidence.resolvedSeats,
          usageByRole: evidence.usageByRole,
          telemetry: evidence.telemetry,
          artifactRefs: evidence.artifactRefs,
          diagnostics: {
            runId: created.runId,
            workspaceId,
            outcome: outcome.kind,
            runIds: evidence.runIds,
            ambiguousSeats: evidence.ambiguousSeats,
          },
        };
      } catch (error) {
        return {
          durationMs: Date.now() - startedAt,
          resolvedSeats: {},
          usageByRole: {},
          artifactRefs: [],
          failure: {
            kind: providerError(error) ? "provider" : "harness",
            reason: error instanceof Error ? error.message : String(error),
          },
          diagnostics: { workspaceId },
        };
      } finally {
        await approvals?.stop().catch(() => {});
        if (beforeEachComplete) {
          await harness.afterEachHook(
            `modelbench-${input.definition.contract.id}`,
          ).catch(() => {});
        }
        if (beforeAllComplete) {
          await resetExtensionState(harness.ctx).catch(() => {});
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
