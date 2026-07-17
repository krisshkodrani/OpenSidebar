import { describe, expect, test, vi } from "vitest";
import {
  handleBrowserToolRequest,
  toAgentTask,
  type AgentRunOutcome,
  type AgentRunner,
} from "../../src/background/browser-bridge/handler";

function runner(outcome: AgentRunOutcome): AgentRunner & { calls: number } {
  return {
    calls: 0,
    async run() {
      this.calls += 1;
      return outcome;
    },
  };
}

describe("toAgentTask", () => {
  test("maps navigate with the url", () => {
    const task = toAgentTask({ tool: "browser_navigate", args: { url: "https://x.test" } });
    expect(task.url).toBe("https://x.test");
    expect(task.instruction).toContain("https://x.test");
  });

  test("passes browser_run_task instruction through", () => {
    const task = toAgentTask({
      tool: "browser_run_task",
      args: { instruction: "book a table for two" },
    });
    expect(task.instruction).toBe("book a table for two");
  });

  test("threads browser_apply_to_job resume + cover letter into the instruction", () => {
    const task = toAgentTask({
      tool: "browser_apply_to_job",
      args: {
        url: "https://jobs.test/1",
        resume: "cv",
        cover_letter: "I am a strong fit because …",
      },
    });
    expect(task.url).toBe("https://jobs.test/1");
    expect(task.instruction).toContain("https://jobs.test/1");
    // The values ride in the instruction — the only channel to the inner agent.
    expect(task.instruction).toContain("cv");
    expect(task.instruction).toContain("I am a strong fit because …");
  });

  test("omits absent apply_to_job resume/cover letter cleanly", () => {
    const task = toAgentTask({
      tool: "browser_apply_to_job",
      args: { url: "https://jobs.test/1" },
    });
    expect(task.instruction).toBe("Apply to the job at https://jobs.test/1.");
  });

  test("carries the request session through on every tool", () => {
    const tools: Array<{ tool: string; args: Record<string, unknown> }> = [
      { tool: "browser_navigate", args: { url: "https://x.test" } },
      { tool: "browser_screenshot", args: {} },
      { tool: "browser_run_task", args: { instruction: "x" } },
      { tool: "browser_apply_to_job", args: { url: "https://jobs.test/1" } },
    ];
    for (const req of tools) {
      expect(toAgentTask({ ...req, session: "pi-abc" }).session).toBe("pi-abc");
      expect(toAgentTask(req).session).toBeUndefined();
    }
  });
});

describe("handleBrowserToolRequest", () => {
  test("ping returns ok without running a task", async () => {
    const r = runner({ status: "completed" });
    const res = await handleBrowserToolRequest({ tool: "browser_ping", args: {} }, r);
    expect(res).toEqual({ status: "ok", result: "pong" });
    expect(r.calls).toBe(0);
  });

  test("completed run maps to ok with data", async () => {
    const r = runner({ status: "completed", data: { title: "Example" } });
    const res = await handleBrowserToolRequest(
      { tool: "browser_navigate", args: { url: "https://x.test" } },
      r,
    );
    expect(res).toEqual({ status: "ok", result: { title: "Example" } });
    expect(r.calls).toBe(1);
  });

  test("needs_human passes through with its reason", async () => {
    const r = runner({ status: "needs_human", reason: "captcha" });
    const res = await handleBrowserToolRequest(
      { tool: "browser_apply_to_job", args: { url: "https://jobs.test/1" } },
      r,
    );
    expect(res).toEqual({ status: "needs_human", reason: "captcha" });
  });

  test("error outcome maps to a structured error", async () => {
    const r = runner({ status: "error", reason: "form not found" });
    const res = await handleBrowserToolRequest(
      { tool: "browser_run_task", args: { instruction: "x" } },
      r,
    );
    expect(res).toEqual({ status: "error", reason: "form not found" });
  });

  test("passes the abort signal through to the runner", async () => {
    let seen: AbortSignal | undefined;
    const capturing: AgentRunner = {
      async run(_task, opts) {
        seen = opts?.signal;
        return { status: "completed" };
      },
    };
    const controller = new AbortController();
    await handleBrowserToolRequest(
      { tool: "browser_run_task", args: { instruction: "x" } },
      capturing,
      { signal: controller.signal },
    );
    expect(seen).toBe(controller.signal);
  });

  test("a thrown runner becomes a structured error, not a crash", async () => {
    const throwing: AgentRunner = {
      run: vi.fn(async () => {
        throw new Error("runner exploded");
      }),
    };
    const res = await handleBrowserToolRequest(
      { tool: "browser_run_task", args: { instruction: "x" } },
      throwing,
    );
    expect(res.status).toBe("error");
    expect(res.reason).toBe("runner exploded");
  });
});

describe("browser_respond_approval routing", () => {
  const approval = { approvalId: "a1", approved: true };

  test("routes to runner.respondApproval and maps its outcome", async () => {
    let seen: unknown = null;
    const r: AgentRunner = {
      async run() {
        return { status: "error", reason: "run should not be called" };
      },
      async respondApproval(req) {
        seen = req.args;
        return { status: "completed", summary: "submitted" };
      },
    };
    const res = await handleBrowserToolRequest(
      { tool: "browser_respond_approval", args: approval },
      r,
    );
    expect(seen).toEqual(approval);
    expect(res).toEqual({ status: "ok", result: "submitted" });
  });

  test("missing capability → structured error", async () => {
    const r = runner({ status: "completed" });
    const res = await handleBrowserToolRequest(
      { tool: "browser_respond_approval", args: approval },
      r,
    );
    expect(res.status).toBe("error");
    expect(res.reason).toContain("cannot answer approvals");
    expect(r.calls).toBe(0);
  });

  test("invalid args → structured error before the runner", async () => {
    let called = false;
    const r: AgentRunner = {
      async run() {
        return { status: "completed" };
      },
      async respondApproval() {
        called = true;
        return { status: "completed" };
      },
    };
    for (const bad of [{}, { approvalId: "a1" }, { approved: true }, { approvalId: "", approved: true }]) {
      const res = await handleBrowserToolRequest(
        { tool: "browser_respond_approval", args: bad },
        r,
      );
      expect(res.status).toBe("error");
    }
    expect(called).toBe(false);
  });
});

describe("mapOutcome approval attachment", () => {
  test("needs_human carries the approval block", async () => {
    const r: AgentRunner = {
      async run() {
        return {
          status: "needs_human",
          reason: "approval required: Submit",
          approval: {
            approvalId: "a1",
            toolName: "click_element",
            args: { id: 7 },
            context: "Submit",
            requestedAt: 1,
            timeoutMs: 600000,
            expiresAt: 600001,
          },
        };
      },
    };
    const res = await handleBrowserToolRequest(
      { tool: "browser_run_task", args: { instruction: "x" } },
      r,
    );
    expect(res.status).toBe("needs_human");
    expect(res.approval?.approvalId).toBe("a1");
  });
});
