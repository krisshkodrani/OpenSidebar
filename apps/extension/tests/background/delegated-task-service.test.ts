import { describe, expect, test, vi } from "vitest";

import {
  DelegatedTaskService,
  type DelegatedTaskServiceOptions,
} from "../../src/background/browser-bridge/delegated-task-service";
import type {
  AgentRunOutcome,
  AgentRunner,
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

function delegate(service: DelegatedTaskService, extra: Record<string, unknown> = {}) {
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
    const accepted = (await delegate(tasks, { max_steps: 7 })) as {
      taskId: string;
      status: string;
    };
    expect(accepted).toMatchObject({ taskId: "task-1", status: "queued" });
    await vi.waitFor(() => expect(seen).toBeDefined());
    expect(seen?.instruction).toContain("Allowed navigation domains: localhost:4173");
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
      { async run() { return { status: "completed" }; } },
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
});
