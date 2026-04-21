import { beforeEach, describe, expect, test, vi } from "vitest";
import type { RouteContext } from "../src/server";

vi.mock("../src/lab-trace-client", () => ({
  createLabBugBriefFromTrace: vi.fn(),
  createLabResearchSeedFromTrace: vi.fn(),
  fetchLabTraceDiagnosis: vi.fn(),
  fetchLabTracePathologies: vi.fn(),
  fetchLabTraceSession: vi.fn(),
  fetchSimilarLabTraceFailures: vi.fn(),
}));

import { handleLabTraceRoutes } from "../src/routes/lab-traces";
import {
  createLabBugBriefFromTrace,
  createLabResearchSeedFromTrace,
  fetchLabTraceDiagnosis,
  fetchLabTraceSession,
} from "../src/lab-trace-client";

function makeContext(
  path: string,
  method = "GET",
  body: unknown = {},
): RouteContext {
  const url = new URL(path, "http://localhost");
  return {
    pathname: url.pathname,
    searchParams: url.searchParams,
    method,
    parseJsonBody: async () => body,
    sendJson: (res: any, data: unknown, status = 200) => {
      res.status = status;
      res.body = data;
    },
    sendEmpty: (res: any, status = 204) => {
      res.status = status;
      res.body = null;
    },
    sendError: (res: any, message: string, status = 400) => {
      res.status = status;
      res.body = { error: message };
    },
  };
}

describe("handleLabTraceRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns diagnosis payload for /lab/traces/diagnosis", async () => {
    vi.mocked(fetchLabTraceDiagnosis).mockReturnValue({
      session: {
        slug: "trace-session/2026-04-21/abc",
        title: "Trace session",
        tags: [],
        page: {
          type: "source",
          updated_at: "2026-04-21T00:00:00.000Z",
          compiled_truth: "summary",
        },
        session: {
          sessionId: "abc",
          runId: null,
          workspaceId: null,
          recordedAt: "2026-04-21T00:00:00.000Z",
          startTime: 1,
          endTime: 2,
          startUrl: "http://127.0.0.1/test",
          domain: "127.0.0.1",
          fixture: "test",
          outcome: "completed",
          failureCategory: "none",
          failureCode: "none",
          failureDetail: null,
          turnCount: 3,
          summary: "done",
          models: [],
          metrics: null,
          sourceFiles: null,
        },
      },
      similarFailures: {
        target: null,
        query: "q",
        failure_code: null,
        total_matches: 0,
        results: [],
      },
      pathologySummary: {
        total_sessions: 1,
        failed_sessions: 0,
        completed_sessions: 1,
        outcomes: [],
        failure_categories: [],
        failure_codes: [],
        domains: [],
        fixtures: [],
        recurring_tools_in_failed_sessions: [],
        recurring_events_in_failed_sessions: [],
      },
      pathologyScope: {
        domain: "127.0.0.1",
        fixture: "test",
      },
    });

    const res: any = {};
    await handleLabTraceRoutes({} as any, res, makeContext("/lab/traces/diagnosis?sessionId=abc"));

    expect(fetchLabTraceDiagnosis).toHaveBeenCalledWith("abc", 5);
    expect(res.status).toBe(200);
    expect(res.body.session.session.sessionId).toBe("abc");
  });

  test("returns 400 when sessionId is missing", async () => {
    const res: any = {};
    await handleLabTraceRoutes({} as any, res, makeContext("/lab/traces/session"));

    expect(fetchLabTraceSession).not.toHaveBeenCalled();
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("sessionId");
  });

  test("creates a research seed for /lab/research-seed", async () => {
    vi.mocked(createLabResearchSeedFromTrace).mockReturnValue({
      title: "Why did turn_limit_reached appear?",
      output: "Created note trace-pathology/seed",
    });

    const res: any = {};
    await handleLabTraceRoutes(
      {} as any,
      res,
      makeContext("/lab/research-seed", "POST", { sessionId: "abc" }),
    );

    expect(createLabResearchSeedFromTrace).toHaveBeenCalledWith("abc");
    expect(res.status).toBe(201);
    expect(res.body.title).toContain("turn_limit_reached");
  });

  test("creates a bug brief for /lab/bug-brief", async () => {
    vi.mocked(createLabBugBriefFromTrace).mockReturnValue({
      title: "Bug brief: turn_limit_reached on job-board (abc12345)",
      content: "# Bug brief\n\n- Compare against xyz",
    });

    const res: any = {};
    await handleLabTraceRoutes(
      {} as any,
      res,
      makeContext("/lab/bug-brief", "POST", { sessionId: "abc" }),
    );

    expect(createLabBugBriefFromTrace).toHaveBeenCalledWith("abc");
    expect(res.status).toBe(201);
    expect(res.body.content).toContain("Compare");
  });
});
