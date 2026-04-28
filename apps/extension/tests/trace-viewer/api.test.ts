import { beforeEach, describe, expect, test, vi } from "vitest";
import "../setup";
import {
  deleteAllTraces,
  fetchRunTraceEvents,
  fetchSessionLogs,
  fetchTraceSessions,
  screenshotUrl,
} from "../../src/trace-viewer/api";

describe("trace-viewer api", () => {
  beforeEach(() => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ) as any;
  });

  test("fetchTraceSessions builds query params from active filters", async () => {
    await fetchTraceSessions({
      outcome: "completed",
      day: "2026-04-15",
      from: "2026-04-10",
      to: "2026-04-15",
      domain: "example.com",
      model: "openai/gpt-5.4-mini:nitro",
      skill: "checkout",
      runId: "run-123",
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url] = (global.fetch as any).mock.calls[0];
    expect(url).toContain("/api/traces/search?");
    expect(url).toContain("outcome=completed");
    expect(url).toContain("day=2026-04-15");
    expect(url).toContain("from=2026-04-10");
    expect(url).toContain("to=2026-04-15");
    expect(url).toContain("domain=example.com");
    expect(url).toContain("model=openai%2Fgpt-5.4-mini%3Anitro");
    expect(url).toContain("skill=checkout");
    expect(url).toContain("runId=run-123");
    expect(url).toContain("limit=1000");
  });

  test("fetchSessionLogs includes optional level filter", async () => {
    await fetchSessionLogs("session-1", "ERROR");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url] = (global.fetch as any).mock.calls[0];
    expect(url).toBe("/api/logs/session-1?level=ERROR");
  });

  test("fetchRunTraceEvents reads run trace endpoint", async () => {
    await fetchRunTraceEvents("run-123");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url] = (global.fetch as any).mock.calls[0];
    expect(url).toBe("/api/run-traces/run-123");
  });

  test("deleteAllTraces sends DELETE request", async () => {
    await deleteAllTraces();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as any).mock.calls[0];
    expect(url).toBe("/api/traces");
    expect(init).toMatchObject({ method: "DELETE" });
  });

  test("screenshotUrl builds screenshot endpoint", () => {
    expect(screenshotUrl("session-1", 4)).toBe(
      "/api/traces/session-1/screenshots/4",
    );
  });
});
