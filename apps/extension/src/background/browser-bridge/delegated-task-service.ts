import type {
  BrowserTaskResult,
  BrowserTaskTraceEvent,
  BrowserToolRequest,
  DelegateBrowserTaskInput,
  DelegatedBrowserTask,
  DelegatedBrowserTaskTrace,
} from "@shared-types/browser-bridge";

import type { AgentRunOutcome, AgentRunner, AgentTask } from "./handler";

interface TaskRecord {
  snapshot: DelegatedBrowserTask;
  input: DelegateBrowserTaskInput;
  controller: AbortController;
  events: BrowserTaskTraceEvent[];
  timer?: ReturnType<typeof setTimeout>;
}

export interface PersistedTaskRecord {
  snapshot: DelegatedBrowserTask;
  input: DelegateBrowserTaskInput;
  events: BrowserTaskTraceEvent[];
}

export interface DelegatedTaskPersistence {
  load(): Promise<PersistedTaskRecord[]>;
  save(records: PersistedTaskRecord[]): Promise<void>;
}

export interface DelegatedTaskServiceOptions {
  now?: () => number;
  createId?: () => string;
  persistence?: DelegatedTaskPersistence;
  onUpdate?: (task: DelegatedBrowserTask) => void;
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const DOMAIN_PATTERN =
  /^(?:\*\.)?(?:localhost|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)(?::\d{1,5})?$/i;

function copy<T>(value: T): T {
  return structuredClone(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function parseDelegateInput(args: Record<string, unknown>): DelegateBrowserTaskInput {
  const goal = typeof args.goal === "string" ? args.goal.trim() : "";
  if (!goal) throw new Error("delegate_browser_task needs a non-empty goal");
  const allowedDomains = stringArray(args.allowed_domains).map((item) =>
    item.trim().toLowerCase(),
  );
  if (allowedDomains.length === 0 || allowedDomains.some((item) => !DOMAIN_PATTERN.test(item))) {
    throw new Error("allowed_domains must contain valid hostnames");
  }
  const maxSteps = positiveNumber(args.max_steps);
  const maxCostUsd = positiveNumber(args.max_cost_usd);
  const timeoutSeconds = positiveNumber(args.timeout_seconds);
  if (maxSteps !== undefined && !Number.isInteger(maxSteps)) {
    throw new Error("max_steps must be a positive integer");
  }
  const approval = args.approval_policy;
  if (!approval || typeof approval !== "object") {
    throw new Error("approval_policy is required");
  }
  const approvalPolicy = approval as Record<string, unknown>;
  if (
    approvalPolicy.mode !== undefined &&
    approvalPolicy.mode !== "mandatory_checkpoints"
  ) {
    throw new Error("approval_policy.mode must be mandatory_checkpoints");
  }
  const allowedRoles = stringArray(args.allowed_model_roles);
  const validRoles = new Set(["planner", "executor", "verifier", "judge", "observation"]);
  if (allowedRoles.some((role) => !validRoles.has(role))) {
    throw new Error("allowed_model_roles contains an unknown role");
  }
  if (
    allowedRoles.length > 0 &&
    ["planner", "executor", "verifier"].some((role) => !allowedRoles.includes(role))
  ) {
    throw new Error(
      "allowed_model_roles must include planner, executor, and verifier for the existing runtime",
    );
  }
  return {
    goal,
    ...(typeof args.context === "string" && args.context.trim()
      ? { context: args.context.trim() }
      : {}),
    constraints: stringArray(args.constraints),
    ...(typeof args.preferred_tab_id === "number" &&
    Number.isInteger(args.preferred_tab_id) &&
    args.preferred_tab_id >= 0
      ? { preferredTabId: args.preferred_tab_id }
      : {}),
    policy: {
      allowedDomains,
      approvalPolicy: {
        mode: "mandatory_checkpoints",
        allowSupervisorRelay: approvalPolicy.allow_supervisor_relay === true,
      },
      ...(maxSteps === undefined ? {} : { maxSteps }),
      ...(maxCostUsd === undefined ? {} : { maxCostUsd }),
      ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
      ...(allowedRoles.length === 0
        ? {}
        : {
            allowedModelRoles:
              allowedRoles as DelegateBrowserTaskInput["policy"]["allowedModelRoles"],
          }),
    },
  };
}

function instructionFor(input: DelegateBrowserTaskInput): string {
  const parts = [
    input.goal,
    `Allowed navigation domains: ${input.policy.allowedDomains.join(", ")}.`,
    "Stop and ask before navigating outside those domains.",
  ];
  if (input.context) parts.push(`Context: ${input.context}`);
  if (input.constraints?.length) {
    parts.push(`Constraints:\n- ${input.constraints.join("\n- ")}`);
  }
  return parts.join("\n\n");
}

export class DelegatedTaskService {
  private readonly records = new Map<string, TaskRecord>();
  private readonly queue: string[] = [];
  private activeTaskId: string | null = null;
  private readonly now: () => number;
  private readonly createId: () => string;
  private readonly persistence?: DelegatedTaskPersistence;
  private readonly onUpdate?: (task: DelegatedBrowserTask) => void;
  private loadPromise?: Promise<void>;
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly runner: AgentRunner,
    options: DelegatedTaskServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.createId =
      options.createId ??
      (() => `browser-task-${crypto.randomUUID()}`);
    this.persistence = options.persistence;
    this.onUpdate = options.onUpdate;
  }

  async handle(req: BrowserToolRequest): Promise<unknown> {
    await this.ensureLoaded();
    switch (req.tool) {
      case "delegate_browser_task":
        return this.delegate(parseDelegateInput(req.args));
      case "get_browser_task":
        return this.get(this.taskId(req.args));
      case "list_browser_tasks":
        return this.list(req.args);
      case "cancel_browser_task":
        return this.cancel(this.taskId(req.args));
      case "approve_browser_checkpoint":
        return this.approve(req.args);
      case "continue_browser_task":
        return this.continue(req.args);
      case "get_browser_task_trace":
        return this.trace(this.taskId(req.args));
      case "browser_bridge_status":
        return {
          connected: true,
          taskFirst: true,
          activeTaskId: this.activeTaskId,
          queuedTasks: this.queue.length,
          capacity: 1,
          providerCheckRequired: false,
        };
      default:
        throw new Error(`not a task-first browser tool: ${req.tool}`);
    }
  }

  private taskId(args: Record<string, unknown>): string {
    if (typeof args.task_id !== "string" || !args.task_id) {
      throw new Error("task_id is required");
    }
    return args.task_id;
  }

  private delegate(input: DelegateBrowserTaskInput): DelegatedBrowserTask {
    const now = this.now();
    const taskId = this.createId();
    const traceId = `bridge-trace-${taskId}`;
    const record: TaskRecord = {
      input,
      controller: new AbortController(),
      events: [{ at: now, type: "delegated" }],
      snapshot: {
        taskId,
        status: "queued",
        goal: input.goal,
        createdAt: now,
        updatedAt: now,
        currentPlan: [],
        completedSteps: [],
        providerUsage: { models: [], estimatedCostUsd: 0 },
        evidence: [],
        traceId,
      },
    };
    this.records.set(taskId, record);
    this.queue.push(taskId);
    this.notify(record);
    queueMicrotask(() => this.pump());
    return copy(record.snapshot);
  }

  private get(taskId: string): DelegatedBrowserTask {
    const record = this.records.get(taskId);
    if (!record) throw new Error(`unknown browser task: ${taskId}`);
    return copy(record.snapshot);
  }

  private list(args: Record<string, unknown>): DelegatedBrowserTask[] {
    const status = typeof args.status === "string" ? args.status : undefined;
    const limit = Math.min(
      100,
      Math.max(1, positiveNumber(args.limit) ?? 20),
    );
    return [...this.records.values()]
      .map((record) => record.snapshot)
      .filter((task) => !status || task.status === status)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map(copy);
  }

  private async cancel(taskId: string): Promise<DelegatedBrowserTask> {
    const record = this.records.get(taskId);
    if (!record) throw new Error(`unknown browser task: ${taskId}`);
    if (TERMINAL.has(record.snapshot.status)) return copy(record.snapshot);
    record.controller.abort();
    if (record.timer) clearTimeout(record.timer);
    const queued = this.queue.indexOf(taskId);
    if (queued >= 0) this.queue.splice(queued, 1);
    this.update(record, "cancelled", "cancelled by caller");
    this.addEvent(record, { at: this.now(), type: "cancelled" });
    if (this.activeTaskId === taskId) {
      await this.runner
        .cancel?.({ instruction: record.input.goal, session: taskId })
        .catch(() => {});
      this.activeTaskId = null;
    }
    queueMicrotask(() => this.pump());
    return copy(record.snapshot);
  }

  private async approve(args: Record<string, unknown>): Promise<DelegatedBrowserTask> {
    const taskId = this.taskId(args);
    const record = this.records.get(taskId);
    if (!record) throw new Error(`unknown browser task: ${taskId}`);
    if (record.snapshot.status !== "waiting_for_approval" || !record.snapshot.approval) {
      throw new Error("task has no pending approval");
    }
    if (args.checkpoint_id !== record.snapshot.approval.approvalId) {
      throw new Error("checkpoint does not match the exact pending action");
    }
    if (typeof args.approved !== "boolean") throw new Error("approved must be boolean");
    if (!record.input.policy.approvalPolicy.allowSupervisorRelay) {
      throw new Error("this task policy does not allow supervisor-relayed approval");
    }
    if (!this.runner.respondApproval) {
      throw new Error("this runtime cannot answer approvals");
    }
    const approvalId = record.snapshot.approval.approvalId;
    this.addEvent(record, {
      at: this.now(),
      type: "approval_answered",
      detail: `${approvalId}:${args.approved ? "approved" : "denied"}`,
    });
    delete record.snapshot.approval;
    this.update(record, "running");
    void this.settle(
      record,
      this.runner.respondApproval(
        {
          tool: "browser_respond_approval",
          args: { approvalId, approved: args.approved },
          session: taskId,
        },
        { signal: record.controller.signal },
      ),
    );
    return copy(record.snapshot);
  }

  private async continue(args: Record<string, unknown>): Promise<DelegatedBrowserTask> {
    const taskId = this.taskId(args);
    const record = this.records.get(taskId);
    if (!record) throw new Error(`unknown browser task: ${taskId}`);
    const clarification = record.snapshot.clarification;
    if (record.snapshot.status !== "waiting_for_clarification" || !clarification) {
      throw new Error("task has no pending clarification");
    }
    if (typeof args.response !== "string" || !args.response.trim()) {
      throw new Error("response must be a non-empty string");
    }
    if (!this.runner.respondClarification) {
      throw new Error("this runtime cannot answer clarifications");
    }
    this.addEvent(record, {
      at: this.now(),
      type: "clarification_answered",
      detail: clarification.clarificationId,
    });
    delete record.snapshot.clarification;
    this.update(record, "running");
    void this.settle(
      record,
      this.runner.respondClarification(
        {
          tool: "browser_respond_clarification",
          args: {
            clarificationId: clarification.clarificationId,
            answer: args.response.trim(),
          },
          session: taskId,
        },
        { signal: record.controller.signal },
      ),
    );
    return copy(record.snapshot);
  }

  private trace(taskId: string): DelegatedBrowserTaskTrace {
    const record = this.records.get(taskId);
    if (!record) throw new Error(`unknown browser task: ${taskId}`);
    return {
      taskId,
      traceId: record.snapshot.traceId,
      goal: record.snapshot.goal,
      events: copy(record.events),
      providerUsage: copy(record.snapshot.providerUsage),
      finalStatus: record.snapshot.status,
    };
  }

  private pump(): void {
    if (this.activeTaskId) return;
    const taskId = this.queue.shift();
    if (!taskId) return;
    const record = this.records.get(taskId);
    if (!record || record.snapshot.status !== "queued") {
      queueMicrotask(() => this.pump());
      return;
    }
    this.activeTaskId = taskId;
    this.update(record, "planning");
    this.addEvent(record, { at: this.now(), type: "started" });
    const timeout = record.input.policy.timeoutSeconds;
    if (timeout) {
      record.timer = setTimeout(() => void this.cancel(taskId), timeout * 1000);
    }
    const task: AgentTask = {
      instruction: instructionFor(record.input),
      session: taskId,
      preferredTabId: record.input.preferredTabId,
      maxSteps: record.input.policy.maxSteps,
      allowedDomains: record.input.policy.allowedDomains,
    };
    this.update(record, "running");
    void this.settle(
      record,
      this.runner.run(task, { signal: record.controller.signal }),
    );
  }

  private async settle(
    record: TaskRecord,
    outcomePromise: Promise<AgentRunOutcome>,
  ): Promise<void> {
    try {
      const outcome = await outcomePromise;
      if (record.snapshot.status === "cancelled") return;
      if (outcome.status === "needs_human" && outcome.approval) {
        record.snapshot.approval = outcome.approval;
        this.update(record, "waiting_for_approval");
        this.addEvent(record, {
          at: this.now(),
          type: "approval_requested",
          detail: outcome.approval.context,
        });
        return;
      }
      if (outcome.status === "needs_human" && outcome.clarification) {
        record.snapshot.clarification = {
          clarificationId: outcome.clarification.clarificationId,
          question: outcome.clarification.question,
          reason: outcome.reason ?? "additional context is required",
          availableOptions: outcome.clarification.suggestions ?? [],
        };
        this.update(record, "waiting_for_clarification");
        this.addEvent(record, {
          at: this.now(),
          type: "clarification_requested",
          detail: outcome.clarification.question,
        });
        return;
      }
      if (outcome.status === "completed") {
        if (outcome.metrics) {
          record.snapshot.providerUsage = {
            models: Object.keys(outcome.metrics.modelBreakdown),
            estimatedCostUsd:
              outcome.metrics.totalCostEstimated ?? outcome.metrics.totalCost,
            ...(outcome.metrics.totalCostActual === undefined
              ? {}
              : { actualCostUsd: outcome.metrics.totalCostActual }),
          };
        }
        record.snapshot.currentPlan =
          outcome.subtaskResults?.map((item) => item.description) ?? [];
        record.snapshot.completedSteps =
          outcome.subtaskResults
            ?.filter((item) => item.status === "completed")
            .map((item) => item.result || item.description) ?? [];
        record.snapshot.currentUrl = outcome.urlHistory?.at(-1);
        if (outcome.runtimeTaskId) {
          record.snapshot.traceId = outcome.runtimeTaskId;
        }
        const result = this.result(record, outcome);
        record.snapshot.finalResult = result;
        if (record.snapshot.completedSteps.length === 0) {
          record.snapshot.completedSteps =
            outcome.handoff?.completed.map((item) => item.text) ?? [];
        }
        record.snapshot.evidence =
          outcome.handoff?.evidence.map((item) => ({
            ...(item.url ? { url: item.url } : {}),
            visibleText: `${item.label}: ${item.value}`,
          })) ?? [];
        this.update(record, "completed");
        this.addEvent(record, {
          at: this.now(),
          type: "completed",
          detail: result.summary,
        });
      } else {
        this.update(record, "failed", outcome.reason ?? "agent run failed");
        this.addEvent(record, {
          at: this.now(),
          type: "failed",
          detail: record.snapshot.failureReason,
        });
      }
    } catch (error) {
      if (record.snapshot.status !== "cancelled") {
        this.update(record, "failed", (error as Error).message);
        this.addEvent(record, {
          at: this.now(),
          type: "failed",
          detail: (error as Error).message,
        });
      }
    } finally {
      if (record.timer && TERMINAL.has(record.snapshot.status)) {
        clearTimeout(record.timer);
      }
      if (
        this.activeTaskId === record.snapshot.taskId &&
        !["waiting_for_approval", "waiting_for_clarification"].includes(
          record.snapshot.status,
        )
      ) {
        this.activeTaskId = null;
        queueMicrotask(() => this.pump());
      }
    }
  }

  private result(record: TaskRecord, outcome: AgentRunOutcome): BrowserTaskResult {
    const summary = outcome.summary ?? "Browser task completed and was verified.";
    return {
      taskId: record.snapshot.taskId,
      status: "completed",
      summary,
      verifiedOutcomes: outcome.handoff?.evidence.map((item) => ({
        claim: `${item.label}: ${item.value}`,
        evidence: {
          ...(item.url ? { url: item.url } : {}),
          visibleText: item.value,
        },
      })) ?? [{ claim: summary }],
      changesMade: outcome.handoff?.completed.map((item) => item.text) ?? [],
      approvalsUsed: record.events
        .filter((event) => event.type === "approval_answered")
        .map((event) => event.detail ?? ""),
      warnings: record.input.policy.maxCostUsd
        ? ["Cost budget is reported but hard pre-call enforcement is not available yet."]
        : [],
      providerUsage: copy(record.snapshot.providerUsage),
      traceId: record.snapshot.traceId,
    };
  }

  private update(
    record: TaskRecord,
    status: DelegatedBrowserTask["status"],
    failureReason?: string,
  ): void {
    record.snapshot.status = status;
    record.snapshot.updatedAt = this.now();
    if (failureReason) record.snapshot.failureReason = failureReason;
    this.notify(record);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.loadPersisted();
    return this.loadPromise;
  }

  private async loadPersisted(): Promise<void> {
    if (!this.persistence) return;
    const persisted = await this.persistence.load().catch(() => []);
    for (const item of persisted) {
      const record: TaskRecord = {
        snapshot: copy(item.snapshot),
        input: copy(item.input),
        events: copy(item.events),
        controller: new AbortController(),
      };
      if (!TERMINAL.has(record.snapshot.status)) {
        record.snapshot.status = "failed";
        record.snapshot.failureReason =
          "Delegated task was interrupted by a browser runtime restart.";
        record.snapshot.updatedAt = this.now();
        this.addEvent(record, {
          at: this.now(),
          type: "failed",
          detail: record.snapshot.failureReason,
        });
      }
      this.records.set(record.snapshot.taskId, record);
    }
    await this.persist();
  }

  private notify(record: TaskRecord): void {
    this.onUpdate?.(copy(record.snapshot));
    void this.persist();
  }

  private addEvent(record: TaskRecord, event: BrowserTaskTraceEvent): void {
    record.events.push(event);
    this.notify(record);
  }

  private async persist(): Promise<void> {
    if (!this.persistence) return;
    const records = [...this.records.values()].map((record) => ({
      snapshot: copy(record.snapshot),
      input: copy(record.input),
      events: copy(record.events),
    }));
    this.persistQueue = this.persistQueue
      .then(() => this.persistence?.save(records))
      .then(() => undefined)
      .catch(() => {});
    await this.persistQueue;
  }
}

export const TASK_FIRST_BROWSER_TOOLS = new Set([
  "delegate_browser_task",
  "get_browser_task",
  "continue_browser_task",
  "approve_browser_checkpoint",
  "cancel_browser_task",
  "list_browser_tasks",
  "get_browser_task_trace",
  "browser_bridge_status",
]);
