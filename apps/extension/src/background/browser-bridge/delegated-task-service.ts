import type {
  BrowserTaskResult,
  BrowserTaskTraceEvent,
  BrowserToolRequest,
  DelegateBrowserTaskInput,
  DelegatedBrowserTask,
  DelegatedBrowserTaskTrace,
} from "@shared-types/browser-bridge";

import type { AgentRunOutcome, AgentRunner, AgentTask } from "./handler";
import type { AgentProgressUpdate } from "./handler";
import { redactTracePayload } from "../../utils/trace-protection";
import { isUrlAllowedByDelegatedPolicy } from "../infrastructure/delegated-navigation-policy";

interface TaskRecord {
  snapshot: DelegatedBrowserTask;
  input: DelegateBrowserTaskInput;
  controller: AbortController;
  events: BrowserTaskTraceEvent[];
  timer?: ReturnType<typeof setTimeout>;
  fileUploadTimer?: ReturnType<typeof setTimeout>;
  pendingFileUpload?: PendingFileUpload;
}

interface PendingFileUpload {
  checkpointId: string;
  tabId: number;
  origin: string;
  inputId: number;
  filename: string;
  size: number;
  sha256: string;
  mimeType: string;
  dataBase64: string;
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
  onActiveStateChange?: (active: boolean) => void;
  activeTabReader?: () => Promise<{
    tabId: number;
    url: string;
    title: string;
    windowId: number;
  }>;
  fileUploader?: {
    getTabUrl(tabId: number): Promise<string>;
    upload(input: {
      tabId: number;
      inputId: number;
      filename: string;
      mimeType: string;
      dataBase64: string;
    }): Promise<string>;
  };
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

function parseDelegateInput(
  args: Record<string, unknown>,
): DelegateBrowserTaskInput {
  const goal = typeof args.goal === "string" ? args.goal.trim() : "";
  if (!goal) throw new Error("delegate_browser_task needs a non-empty goal");
  const allowedDomains = stringArray(args.allowed_domains).map((item) =>
    item.trim().toLowerCase(),
  );
  if (
    allowedDomains.length === 0 ||
    allowedDomains.some((item) => !DOMAIN_PATTERN.test(item))
  ) {
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
  const validRoles = new Set([
    "planner",
    "executor",
    "verifier",
    "writer",
    "judge",
    "observation",
  ]);
  if (allowedRoles.some((role) => !validRoles.has(role))) {
    throw new Error("allowed_model_roles contains an unknown role");
  }
  if (
    allowedRoles.length > 0 &&
    ["planner", "executor", "verifier"].some(
      (role) => !allowedRoles.includes(role),
    )
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
  private readonly onActiveStateChange?: (active: boolean) => void;
  private readonly activeTabReader?: DelegatedTaskServiceOptions["activeTabReader"];
  private readonly fileUploader?: DelegatedTaskServiceOptions["fileUploader"];
  private loadPromise?: Promise<void>;
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly runner: AgentRunner,
    options: DelegatedTaskServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.createId =
      options.createId ?? (() => `browser-task-${crypto.randomUUID()}`);
    this.persistence = options.persistence;
    this.onUpdate = options.onUpdate;
    this.onActiveStateChange = options.onActiveStateChange;
    this.activeTabReader = options.activeTabReader;
    this.fileUploader = options.fileUploader;
  }

  async handle(req: BrowserToolRequest): Promise<unknown> {
    await this.ensureLoaded();
    switch (req.tool) {
      case "get_active_browser_tab":
        if (!this.activeTabReader) {
          throw new Error("active browser tab inspection is not configured");
        }
        return this.activeTabReader();
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
          ...(this.activeTabReader
            ? {
                activeTab: await this.activeTabReader().catch(() => null),
              }
            : {}),
        };
      case "request_browser_file_upload":
        return this.requestFileUpload(req.args);
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
    const limit = Math.min(100, Math.max(1, positiveNumber(args.limit) ?? 20));
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
    if (record.fileUploadTimer) clearTimeout(record.fileUploadTimer);
    delete record.pendingFileUpload;
    const queued = this.queue.indexOf(taskId);
    if (queued >= 0) this.queue.splice(queued, 1);
    this.update(record, "cancelled", "cancelled by caller");
    this.addEvent(record, { at: this.now(), type: "cancelled" });
    if (this.activeTaskId === taskId) {
      await this.runner
        .cancel?.({ instruction: record.input.goal, session: taskId })
        .catch(() => {});
      this.activeTaskId = null;
      if (this.queue.length === 0) this.onActiveStateChange?.(false);
    }
    queueMicrotask(() => this.pump());
    return copy(record.snapshot);
  }

  private async approve(
    args: Record<string, unknown>,
  ): Promise<DelegatedBrowserTask> {
    const taskId = this.taskId(args);
    const record = this.records.get(taskId);
    if (!record) throw new Error(`unknown browser task: ${taskId}`);
    if (
      record.snapshot.status !== "waiting_for_approval" ||
      !record.snapshot.approval
    ) {
      throw new Error("task has no pending approval");
    }
    if (args.checkpoint_id !== record.snapshot.approval.approvalId) {
      throw new Error("checkpoint does not match the exact pending action");
    }
    if (typeof args.approved !== "boolean")
      throw new Error("approved must be boolean");
    if (!record.input.policy.approvalPolicy.allowSupervisorRelay) {
      throw new Error(
        "this task policy does not allow supervisor-relayed approval",
      );
    }
    if (!this.runner.respondApproval) {
      if (!record.pendingFileUpload) {
        throw new Error("this runtime cannot answer approvals");
      }
    }
    if (
      record.pendingFileUpload &&
      record.snapshot.approval.expiresAt <= this.now()
    ) {
      if (record.fileUploadTimer) clearTimeout(record.fileUploadTimer);
      delete record.fileUploadTimer;
      delete record.pendingFileUpload;
      delete record.snapshot.approval;
      this.update(record, "waiting_for_clarification");
      throw new Error("local file upload approval expired");
    }
    const approvalId = record.snapshot.approval.approvalId;
    this.addEvent(record, {
      at: this.now(),
      type: "approval_answered",
      detail: `${approvalId}:${args.approved ? "approved" : "denied"}`,
    });
    delete record.snapshot.approval;
    if (record.pendingFileUpload) {
      const pending = record.pendingFileUpload;
      if (record.fileUploadTimer) clearTimeout(record.fileUploadTimer);
      delete record.fileUploadTimer;
      delete record.pendingFileUpload;
      try {
        if (args.approved) {
          if (!this.fileUploader) {
            throw new Error("local file upload is not configured");
          }
          const actualUrl = await this.fileUploader.getTabUrl(pending.tabId);
          if (new URL(actualUrl).origin !== pending.origin) {
            throw new Error(
              `upload origin changed before approval: expected ${pending.origin}`,
            );
          }
          const result = await this.fileUploader.upload({
            tabId: pending.tabId,
            inputId: pending.inputId,
            filename: pending.filename,
            mimeType: pending.mimeType,
            dataBase64: pending.dataBase64,
          });
          record.snapshot.evidence.push({
            url: actualUrl,
            visibleText: `Attached ${pending.filename} (${pending.size} bytes, sha256 ${pending.sha256}) to input ${pending.inputId}. ${result}`,
          });
        }
      } finally {
        // The byte payload is single-use even if the live page changed or the
        // content action failed. A retry requires a freshly hashed request.
        this.update(record, "waiting_for_clarification");
      }
      return copy(record.snapshot);
    }
    this.update(record, "running");
    void this.settle(
      record,
      this.runner.respondApproval!(
        {
          tool: "browser_respond_approval",
          args: { approvalId, approved: args.approved },
          session: taskId,
        },
        {
          signal: record.controller.signal,
          onProgress: (update) => this.applyProgress(record, update),
        },
      ),
    );
    return copy(record.snapshot);
  }

  private async continue(
    args: Record<string, unknown>,
  ): Promise<DelegatedBrowserTask> {
    const taskId = this.taskId(args);
    const record = this.records.get(taskId);
    if (!record) throw new Error(`unknown browser task: ${taskId}`);
    const clarification = record.snapshot.clarification;
    if (
      record.snapshot.status !== "waiting_for_clarification" ||
      !clarification
    ) {
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
        {
          signal: record.controller.signal,
          onProgress: (update) => this.applyProgress(record, update),
        },
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

  private async requestFileUpload(
    args: Record<string, unknown>,
  ): Promise<DelegatedBrowserTask> {
    const taskId = this.taskId(args);
    const record = this.records.get(taskId);
    if (!record) throw new Error(`unknown browser task: ${taskId}`);
    if (
      record.snapshot.status !== "waiting_for_clarification" ||
      !record.snapshot.clarification
    ) {
      throw new Error(
        "local upload is allowed only while the task is paused for clarification",
      );
    }
    if (!record.input.policy.approvalPolicy.allowSupervisorRelay) {
      throw new Error(
        "this task policy does not allow supervisor-relayed approval",
      );
    }
    const tabId = args.tab_id;
    const inputId = args.input_id;
    const origin = typeof args.origin === "string" ? args.origin : "";
    const file = args._validated_local_file;
    if (
      typeof tabId !== "number" ||
      !Number.isInteger(tabId) ||
      tabId < 0 ||
      typeof inputId !== "number" ||
      !Number.isInteger(inputId) ||
      inputId < 0 ||
      !origin ||
      !file ||
      typeof file !== "object"
    ) {
      throw new Error("invalid local upload target");
    }
    if (record.snapshot.currentTabId !== tabId) {
      throw new Error(
        "upload tab does not match the delegated task's current tab",
      );
    }
    const actualUrl = await this.fileUploader?.getTabUrl(tabId);
    if (!actualUrl || new URL(actualUrl).origin !== new URL(origin).origin) {
      throw new Error("upload target origin does not match the live tab");
    }
    if (
      !isUrlAllowedByDelegatedPolicy(actualUrl, {
        allowedDomains: record.input.policy.allowedDomains,
      })
    ) {
      throw new Error("upload target is outside the delegated domain policy");
    }
    const metadata = file as Record<string, unknown>;
    const requiredStrings = [
      "filename",
      "sha256",
      "mimeType",
      "dataBase64",
    ] as const;
    if (
      requiredStrings.some((key) => typeof metadata[key] !== "string") ||
      typeof metadata.size !== "number" ||
      metadata.size <= 0 ||
      metadata.size > 10 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/u.test(String(metadata.sha256))
    ) {
      throw new Error("host did not provide valid file metadata");
    }
    const decoded = Uint8Array.from(
      atob(String(metadata.dataBase64)),
      (character) => character.charCodeAt(0),
    );
    if (decoded.byteLength !== metadata.size) {
      throw new Error("local upload byte length does not match metadata");
    }
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", decoded),
    );
    const digestHex = [...digest]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    if (digestHex !== metadata.sha256) {
      throw new Error("local upload sha256 does not match metadata");
    }
    const checkpointId = `file-upload-${crypto.randomUUID()}`;
    record.pendingFileUpload = {
      checkpointId,
      tabId,
      origin: new URL(origin).origin,
      inputId,
      filename: String(metadata.filename),
      size: metadata.size,
      sha256: String(metadata.sha256),
      mimeType: String(metadata.mimeType),
      dataBase64: String(metadata.dataBase64),
    };
    const approvalTimeoutMs = 10 * 60 * 1000;
    record.snapshot.approval = {
      approvalId: checkpointId,
      toolName: "local_file_upload",
      args: {
        tabId,
        origin: new URL(origin).origin,
        inputId,
        filename: metadata.filename,
        size: metadata.size,
        sha256: metadata.sha256,
      },
      context:
        `Attach local file ${String(metadata.filename)} to input ${inputId} ` +
        `on ${new URL(origin).origin}?`,
      requestedAt: this.now(),
      timeoutMs: approvalTimeoutMs,
      expiresAt: this.now() + approvalTimeoutMs,
    };
    record.fileUploadTimer = setTimeout(() => {
      if (
        record.pendingFileUpload?.checkpointId !== checkpointId ||
        record.snapshot.approval?.approvalId !== checkpointId
      ) {
        return;
      }
      delete record.pendingFileUpload;
      delete record.fileUploadTimer;
      delete record.snapshot.approval;
      this.update(record, "waiting_for_clarification");
      this.addEvent(record, {
        at: this.now(),
        type: "approval_answered",
        detail: `${checkpointId}:expired`,
      });
    }, approvalTimeoutMs);
    this.update(record, "waiting_for_approval");
    this.addEvent(record, {
      at: this.now(),
      type: "approval_requested",
      detail: `local file ${String(metadata.filename)} sha256 ${String(metadata.sha256)}`,
    });
    return copy(record.snapshot);
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
    this.onActiveStateChange?.(true);
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
      maxCostUsd: record.input.policy.maxCostUsd,
      allowedDomains: record.input.policy.allowedDomains,
      allowedModelRoles: record.input.policy.allowedModelRoles,
    };
    this.update(record, "running");
    void this.settle(
      record,
      this.runner.run(task, {
        signal: record.controller.signal,
        onProgress: (update) => this.applyProgress(record, update),
      }),
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
        if (this.queue.length === 0) this.onActiveStateChange?.(false);
        queueMicrotask(() => this.pump());
      }
    }
  }

  private result(
    record: TaskRecord,
    outcome: AgentRunOutcome,
  ): BrowserTaskResult {
    const summary =
      outcome.summary ?? "Browser task completed and was verified.";
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
      warnings: [],
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

  private applyProgress(
    record: TaskRecord,
    progress: AgentProgressUpdate,
  ): void {
    if (TERMINAL.has(record.snapshot.status)) return;
    if (progress.metrics) {
      record.snapshot.providerUsage = {
        models: Object.keys(progress.metrics.modelBreakdown),
        estimatedCostUsd:
          progress.metrics.totalCostEstimated ?? progress.metrics.totalCost,
        ...(progress.metrics.totalCostActual === undefined
          ? {}
          : { actualCostUsd: progress.metrics.totalCostActual }),
      };
    }
    if (progress.subtasks) {
      record.snapshot.currentPlan = progress.subtasks.map(
        (item) => item.description,
      );
      record.snapshot.completedSteps = progress.subtasks
        .filter((item) => item.status === "completed")
        .map((item) => item.result || item.description);
      const active = progress.subtasks[progress.currentIndex ?? -1];
      if (active?.completedAtUrl) {
        record.snapshot.currentUrl = active.completedAtUrl;
      }
    }
    if (progress.currentUrl) record.snapshot.currentUrl = progress.currentUrl;
    if (progress.currentTabId !== undefined) {
      record.snapshot.currentTabId = progress.currentTabId;
    }
    record.snapshot.updatedAt = this.now();
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
    const records = [...this.records.values()]
      .sort((a, b) => b.snapshot.updatedAt - a.snapshot.updatedAt)
      .slice(0, 100)
      .map((record) => this.persistedRecord(record));
    this.persistQueue = this.persistQueue
      .then(() => this.persistence?.save(records))
      .then(() => undefined)
      .catch(() => {});
    await this.persistQueue;
  }

  private persistedRecord(record: TaskRecord): PersistedTaskRecord {
    const snapshot = redactTracePayload(copy(record.snapshot), {
      mode: "export",
      maxStringLength: 1_000,
    });
    snapshot.goal = redactTracePayload(record.snapshot.goal, {
      mode: "export",
      maxStringLength: 500,
    });
    const input: DelegateBrowserTaskInput = {
      goal: snapshot.goal,
      policy: copy(record.input.policy),
      ...(record.input.preferredTabId === undefined
        ? {}
        : { preferredTabId: record.input.preferredTabId }),
      ...(record.input.context
        ? { context: "[REDACTED: runtime-only task context]" }
        : {}),
      ...(record.input.constraints?.length
        ? {
            constraints: record.input.constraints.map((value) =>
              redactTracePayload(value, {
                mode: "export",
                maxStringLength: 300,
              }),
            ),
          }
        : {}),
    };
    const events = redactTracePayload(copy(record.events), {
      mode: "export",
      maxStringLength: 500,
    });
    return { snapshot, input, events };
  }
}

export const TASK_FIRST_BROWSER_TOOLS = new Set([
  "get_active_browser_tab",
  "delegate_browser_task",
  "get_browser_task",
  "continue_browser_task",
  "approve_browser_checkpoint",
  "cancel_browser_task",
  "list_browser_tasks",
  "get_browser_task_trace",
  "browser_bridge_status",
  "request_browser_file_upload",
]);
