import { describe, expect, test, vi } from "vitest";

import {
  DelegatedTaskService,
  type DelegatedTaskServiceOptions,
  type PersistedTaskRecord,
} from "../../src/background/browser-bridge/delegated-task-service";
import type {
  AgentRunOutcome,
  AgentRunner,
  AgentProgressUpdate,
  AgentTask,
} from "../../src/background/browser-bridge/handler";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function request(
  service: DelegatedTaskService,
  tool: string,
  args: Record<string, unknown>,
) {
  return service.handle({ tool, args });
}

function delegate(
  service: DelegatedTaskService,
  extra: Record<string, unknown> = {},
) {
  return request(service, "delegate_browser_task", {
    goal: "Fill the local form and stop before submission",
    allowed_domains: ["localhost:4173"],
    approval_policy: {
      mode: "mandatory_checkpoints",
      allow_supervisor_relay: true,
    },
    ...extra,
  });
}

function service(
  runner: AgentRunner,
  options: DelegatedTaskServiceOptions = {},
): DelegatedTaskService {
  let id = 0;
  return new DelegatedTaskService(runner, {
    createId: () => `task-${++id}`,
    now: () => 100,
    ...options,
  });
}

describe("DelegatedTaskService", () => {
  test("reads the active tab mechanically without invoking the agent", async () => {
    const run = vi.fn(async () => ({ status: "completed" as const }));
    const tasks = service(
      { run },
      {
        activeTabReader: async () => ({
          tabId: 42,
          url: "https://play.google.com/console",
          title: "Google Play Console",
          windowId: 7,
        }),
      },
    );

    await expect(request(tasks, "get_active_browser_tab", {})).resolves.toEqual(
      {
        tabId: 42,
        url: "https://play.google.com/console",
        title: "Google Play Console",
        windowId: 7,
      },
    );
    expect(run).not.toHaveBeenCalled();
  });

  test("holds the active lifecycle until a delegated run settles", async () => {
    const run = deferred<AgentRunOutcome>();
    const activeStates: boolean[] = [];
    const tasks = service(
      {
        async run() {
          return run.promise;
        },
      },
      {
        onActiveStateChange: (active) => activeStates.push(active),
      },
    );

    await delegate(tasks);
    await vi.waitFor(() => expect(activeStates).toEqual([true]));

    run.resolve({ status: "completed" });
    await vi.waitFor(() => expect(activeStates).toEqual([true, false]));
  });

  test("accepts asynchronously and runs through the injected agent runtime", async () => {
    const run = deferred<AgentRunOutcome>();
    let seen: AgentTask | undefined;
    const runner: AgentRunner = {
      async run(task) {
        seen = task;
        return run.promise;
      },
    };
    const tasks = service(runner);
    const accepted = (await delegate(tasks, {
      max_steps: 7,
      preferred_tab_id: 77,
    })) as {
      taskId: string;
      status: string;
      currentTabId?: number;
    };
    expect(accepted).toMatchObject({
      taskId: "task-1",
      status: "queued",
      currentTabId: 77,
    });
    await vi.waitFor(() => expect(seen).toBeDefined());
    expect(seen?.instruction).toContain(
      "Allowed navigation domains: localhost:4173",
    );
    expect(seen?.maxSteps).toBe(7);

    run.resolve({ status: "completed", summary: "Form values verified" });
    await vi.waitFor(async () =>
      expect(
        (await request(tasks, "get_browser_task", { task_id: "task-1" })) as {
          status: string;
        },
      ).toMatchObject({ status: "completed" }),
    );
    const completed = (await request(tasks, "get_browser_task", {
      task_id: "task-1",
    })) as { finalResult: { summary: string; traceId: string } };
    expect(completed.finalResult.summary).toBe("Form values verified");
    expect(completed.finalResult.traceId).toContain("task-1");
  });

  test("threads cost/model policy and publishes live progress", async () => {
    const run = deferred<AgentRunOutcome>();
    let seen: AgentTask | undefined;
    let pushProgress: ((update: AgentProgressUpdate) => void) | undefined;
    const tasks = service({
      async run(task, options) {
        seen = task;
        pushProgress = options?.onProgress;
        return run.promise;
      },
    });
    await delegate(tasks, {
      max_cost_usd: 0.25,
      allowed_model_roles: ["planner", "executor", "verifier"],
    });
    await vi.waitFor(() => expect(seen).toBeDefined());
    expect(seen).toMatchObject({
      maxCostUsd: 0.25,
      allowedModelRoles: ["planner", "executor", "verifier"],
    });
    pushProgress?.({
      currentUrl: "http://localhost:4173/form",
      currentTabId: 44,
      subtasks: [
        { description: "Open form", status: "completed", result: "Opened" },
        { description: "Fill fields", status: "running" },
      ],
      currentIndex: 1,
      metrics: {
        totalCost: 0.01,
        totalCostEstimated: 0.01,
        modelBreakdown: { "test/model": {} },
      },
    });
    const live = await request(tasks, "get_browser_task", {
      task_id: "task-1",
    });
    expect(live).toMatchObject({
      currentUrl: "http://localhost:4173/form",
      currentTabId: 44,
      currentPlan: ["Open form", "Fill fields"],
      completedSteps: ["Opened"],
      providerUsage: {
        models: ["test/model"],
        estimatedCostUsd: 0.01,
      },
    });
    run.resolve({ status: "completed", summary: "done" });
  });

  test("preserves terminal usage for failed and paused outcomes", async () => {
    const metrics = {
      totalCost: 0.037,
      totalCostEstimated: 0.037,
      totalCostActual: 0,
      modelBreakdown: {
        "openai/gpt-5.6-terra": {
          promptTokens: 120,
          completionTokens: 40,
          cost: 0.037,
          calls: 2,
        },
      },
    };
    const failed = service({
      async run() {
        return {
          status: "error",
          reason: "verification failed",
          metrics,
        };
      },
    });
    await delegate(failed);
    await vi.waitFor(async () =>
      expect(
        await request(failed, "get_browser_task", { task_id: "task-1" }),
      ).toMatchObject({
        status: "failed",
        providerUsage: {
          models: ["openai/gpt-5.6-terra"],
          estimatedCostUsd: 0.037,
          actualCostUsd: 0,
        },
      }),
    );

    const paused = service({
      async run() {
        return {
          status: "needs_human",
          reason: "tab choice required",
          clarification: {
            clarificationId: "clarify-usage",
            question: "Which tab?",
            requestedAt: 1,
            timeoutMs: 1000,
            expiresAt: 1001,
          },
          metrics,
        };
      },
    });
    await delegate(paused);
    await vi.waitFor(async () =>
      expect(
        await request(paused, "get_browser_task", { task_id: "task-1" }),
      ).toMatchObject({
        status: "waiting_for_clarification",
        providerUsage: {
          models: ["openai/gpt-5.6-terra"],
          estimatedCostUsd: 0.037,
        },
      }),
    );
  });

  test("admits only one active task and starts the next after completion", async () => {
    const first = deferred<AgentRunOutcome>();
    const second = deferred<AgentRunOutcome>();
    const run = vi
      .fn<AgentRunner["run"]>()
      .mockImplementationOnce(async () => first.promise)
      .mockImplementationOnce(async () => second.promise);
    const tasks = service({ run });
    await delegate(tasks);
    await delegate(tasks);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(
      await request(tasks, "get_browser_task", { task_id: "task-2" }),
    ).toMatchObject({ status: "queued" });
    first.resolve({ status: "completed", summary: "first" });
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    second.resolve({ status: "completed", summary: "second" });
  });

  test("cancels the exact running task and aborts its runtime signal", async () => {
    let signal: AbortSignal | undefined;
    const never = deferred<AgentRunOutcome>();
    const cancel = vi.fn(async () => {});
    const tasks = service({
      async run(_task, opts) {
        signal = opts?.signal;
        return never.promise;
      },
      cancel,
    });
    await delegate(tasks);
    await vi.waitFor(() => expect(signal).toBeDefined());
    expect(
      await request(tasks, "cancel_browser_task", { task_id: "task-1" }),
    ).toMatchObject({ status: "cancelled" });
    expect(signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledWith(
      expect.objectContaining({ session: "task-1" }),
    );
  });

  test("binds supervisor approval to the exact pending checkpoint", async () => {
    const resume = deferred<AgentRunOutcome>();
    const respondApproval = vi.fn(async () => resume.promise);
    const tasks = service({
      async run() {
        return {
          status: "needs_human",
          approval: {
            approvalId: "checkpoint-1",
            toolName: "click_element",
            args: { id: 4 },
            context: "Submit form",
            requestedAt: 1,
            timeoutMs: 1000,
            expiresAt: 1001,
          },
        };
      },
      respondApproval,
    });
    await delegate(tasks);
    await vi.waitFor(async () =>
      expect(
        await request(tasks, "get_browser_task", { task_id: "task-1" }),
      ).toMatchObject({ status: "waiting_for_approval" }),
    );
    await expect(
      request(tasks, "approve_browser_checkpoint", {
        task_id: "task-1",
        checkpoint_id: "wrong",
        approved: true,
      }),
    ).rejects.toThrow(/exact pending action/);
    expect(
      await request(tasks, "approve_browser_checkpoint", {
        task_id: "task-1",
        checkpoint_id: "checkpoint-1",
        approved: true,
      }),
    ).toMatchObject({ status: "running" });
    expect(respondApproval).toHaveBeenCalledOnce();
    resume.resolve({ status: "completed", summary: "submitted and verified" });
  });

  test("forwards clarification and resumes the same task", async () => {
    const resume = deferred<AgentRunOutcome>();
    const respondClarification = vi.fn(async () => resume.promise);
    const tasks = service({
      async run() {
        return {
          status: "needs_human",
          reason: "track is ambiguous",
          clarification: {
            clarificationId: "clarify-1",
            question: "Which track?",
            suggestions: ["Internal", "Closed"],
            requestedAt: 1,
            timeoutMs: 1000,
            expiresAt: 1001,
          },
        };
      },
      respondClarification,
    });
    await delegate(tasks);
    await vi.waitFor(async () =>
      expect(
        await request(tasks, "get_browser_task", { task_id: "task-1" }),
      ).toMatchObject({
        status: "waiting_for_clarification",
        clarification: { question: "Which track?" },
      }),
    );
    await request(tasks, "continue_browser_task", {
      task_id: "task-1",
      response: "Internal",
    });
    expect(respondClarification).toHaveBeenCalledOnce();
    resume.resolve({ status: "completed", summary: "continued" });
  });

  test("uploads a validated local file only after exact one-time approval", async () => {
    let now = 100;
    const upload = vi.fn(async () => "File attached");
    const tasks = service(
      {
        async run(_task, options) {
          options?.onProgress?.({ currentTabId: 44 });
          return {
            status: "needs_human",
            reason: "need the release bundle",
            clarification: {
              clarificationId: "clarify-file",
              question: "Which file should I attach?",
              requestedAt: 1,
              timeoutMs: 1000,
              expiresAt: 1001,
            },
          };
        },
      },
      {
        now: () => now,
        fileUploader: {
          async getTabUrl() {
            return "https://play.google.com/console/app";
          },
          upload,
        },
      },
    );
    await delegate(tasks, { allowed_domains: ["play.google.com"] });
    await vi.waitFor(async () =>
      expect(
        await request(tasks, "get_browser_task", { task_id: "task-1" }),
      ).toMatchObject({ status: "waiting_for_clarification" }),
    );
    const uploadRequest = {
      task_id: "task-1",
      tab_id: 44,
      origin: "https://play.google.com",
      input_id: 9,
      _validated_local_file: {
        filename: "app.aab",
        size: 5,
        sha256:
          "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        mimeType: "application/octet-stream",
        dataBase64: "aGVsbG8=",
      },
    };
    const pending = (await request(
      tasks,
      "request_browser_file_upload",
      uploadRequest,
    )) as {
      status: string;
      approval: { approvalId: string; args: Record<string, unknown> };
    };
    expect(pending).toMatchObject({
      status: "waiting_for_approval",
      approval: {
        args: {
          tabId: 44,
          origin: "https://play.google.com",
          inputId: 9,
          filename: "app.aab",
        },
      },
    });
    expect(JSON.stringify(pending.approval)).not.toContain("canonicalPath");
    expect(JSON.stringify(pending.approval)).not.toContain("aGVsbG8");

    const resumed = await request(tasks, "approve_browser_checkpoint", {
      task_id: "task-1",
      checkpoint_id: pending.approval.approvalId,
      approved: true,
    });
    expect(resumed).toMatchObject({ status: "waiting_for_clarification" });
    expect(upload).toHaveBeenCalledWith({
      tabId: 44,
      inputId: 9,
      filename: "app.aab",
      mimeType: "application/octet-stream",
      dataBase64: "aGVsbG8=",
    });
    await expect(
      request(tasks, "approve_browser_checkpoint", {
        task_id: "task-1",
        checkpoint_id: pending.approval.approvalId,
        approved: true,
      }),
    ).rejects.toThrow(/no pending approval/);

    const expiring = (await request(
      tasks,
      "request_browser_file_upload",
      uploadRequest,
    )) as { approval: { approvalId: string; expiresAt: number } };
    now = expiring.approval.expiresAt;
    await expect(
      request(tasks, "approve_browser_checkpoint", {
        task_id: "task-1",
        checkpoint_id: expiring.approval.approvalId,
        approved: true,
      }),
    ).rejects.toThrow(/approval expired/);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  test("rejects malformed policy and reports status without provider calls", async () => {
    const run = vi.fn(async () => ({ status: "completed" as const }));
    const tasks = service({ run });
    await expect(
      delegate(tasks, { allowed_domains: ["https://example.com/path"] }),
    ).rejects.toThrow(/valid hostnames/);
    expect(await request(tasks, "browser_bridge_status", {})).toMatchObject({
      connected: true,
      taskFirst: true,
      providerCheckRequired: false,
    });
    expect(run).not.toHaveBeenCalled();
  });

  test("restores history and fails interrupted work closed after a runtime restart", async () => {
    const saved: unknown[] = [];
    const persistence = {
      async load() {
        return [
          {
            snapshot: {
              taskId: "persisted-1",
              status: "running" as const,
              goal: "unfinished",
              createdAt: 1,
              updatedAt: 1,
              currentPlan: [],
              completedSteps: [],
              providerUsage: { models: [], estimatedCostUsd: 0 },
              evidence: [],
              traceId: "trace-1",
            },
            input: {
              goal: "unfinished",
              policy: {
                allowedDomains: ["example.com"],
                approvalPolicy: {
                  mode: "mandatory_checkpoints" as const,
                  allowSupervisorRelay: false,
                },
              },
            },
            events: [],
          },
        ];
      },
      async save(records: unknown[]) {
        saved.push(records);
      },
    };
    const tasks = service(
      {
        async run() {
          return { status: "completed" };
        },
      },
      { persistence },
    );
    expect(
      await request(tasks, "get_browser_task", { task_id: "persisted-1" }),
    ).toMatchObject({
      status: "failed",
      failureReason: expect.stringMatching(/runtime restart/),
    });
    expect(saved.length).toBeGreaterThan(0);
  });

  test("redacts and bounds persisted bridge history", async () => {
    let latest: PersistedTaskRecord[] = [];
    const tasks = service(
      {
        async run() {
          return { status: "completed", summary: "done" };
        },
      },
      {
        persistence: {
          async load() {
            return [];
          },
          async save(records) {
            latest = records;
          },
        },
      },
    );
    await delegate(tasks, {
      context: "contact person@example.com with Bearer super-secret-token",
      constraints: ["API key sk-1234567890abcdefghijklmnop"],
    });
    await vi.waitFor(() => expect(latest.length).toBe(1));
    const serialized = JSON.stringify(latest);
    expect(serialized).not.toContain("person@example.com");
    expect(serialized).not.toContain("super-secret-token");
    expect(serialized).not.toContain("1234567890abcdefghijklmnop");
    expect(serialized).toContain("runtime-only task context");
  });
});
