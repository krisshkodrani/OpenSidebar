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
