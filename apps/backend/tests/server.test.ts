import { describe, test, expect, beforeAll, afterAll, vi, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { join } from "path";
import { tmpdir } from "os";
import { unlinkSync, writeFileSync } from "fs";
import { initDatabase, closeDatabase } from "../src/db";
import { handleBackendRequest } from "../src/server";

// Exercise the real request handler so local API security policy is covered.

let server: Server;
let baseUrl: string;
let dbPath: string;
let profilePath: string;

beforeAll(async () => {
  dbPath = join(tmpdir(), `test-server-${Date.now()}.sqlite`);
  profilePath = join(tmpdir(), `test-profile-${Date.now()}.yaml`);
  initDatabase(dbPath);
  process.env.OPENSIDEBAR_PROFILE_PATH = profilePath;
  writeFileSync(
    profilePath,
    [
      "profile:",
      "  identity:",
      "    first_name: John",
      "    last_name: Doe",
      "  sensitive:",
      '    date_of_birth: "1990-01-01"',
      "",
    ].join("\n"),
  );

  server = createServer((req, res) => {
    handleBackendRequest(req, res).catch((error) => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({ error: error?.message ?? "Request failed" }));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server.close();
  closeDatabase();
  try {
    unlinkSync(dbPath);
    unlinkSync(dbPath + "-wal");
    unlinkSync(dbPath + "-shm");
    unlinkSync(profilePath);
  } catch {
    // best-effort cleanup
  }
  delete process.env.OPENSIDEBAR_PROFILE_PATH;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Helper
async function api(
  path: string,
  options?: RequestInit,
): Promise<{ status: number; headers: Headers; data: any }> {
  const { headers, ...rest } = options ?? {};
  const mergedHeaders = new Headers(headers);
  if (!mergedHeaders.has("Content-Type")) {
    mergedHeaders.set("Content-Type", "application/json");
  }
  const res = await fetch(`${baseUrl}${path}`, {
    ...rest,
    headers: mergedHeaders,
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    data: text ? JSON.parse(text) : null,
  };
}

describe("GET /health", () => {
  test("returns 200 with status", async () => {
    const { status, data } = await api("/health");
    expect(status).toBe(200);
    expect(data.status).toBe("ok");
  });
});

describe("local API origin policy", () => {
  test("allows extension origins and echoes the origin", async () => {
    const origin = "chrome-extension://abcdefghijklmnop";
    const { status, headers } = await api("/health", {
      headers: { Origin: origin },
    });

    expect(status).toBe(200);
    expect(headers.get("access-control-allow-origin")).toBe(origin);
    expect(headers.get("vary")).toContain("Origin");
  });

  test("allows extension preflight requests", async () => {
    const origin = "chrome-extension://abcdefghijklmnop";
    const { status, data, headers } = await api("/task-runs", {
      method: "OPTIONS",
      headers: { Origin: origin },
    });

    expect(status).toBe(204);
    expect(data).toBeNull();
    expect(headers.get("access-control-allow-origin")).toBe(origin);
  });

  test("rejects arbitrary browser origins", async () => {
    const { status, data, headers } = await api("/profile/file", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
      body: JSON.stringify({ alias: "cv" }),
    });

    expect(status).toBe(403);
    expect(data.error).toBe("Origin not allowed");
    expect(headers.get("access-control-allow-origin")).toBeNull();
  });

  test("rejects arbitrary browser preflight requests", async () => {
    const { status, data, headers } = await api("/task-runs", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example" },
    });

    expect(status).toBe(403);
    expect(data.error).toBe("Origin not allowed");
    expect(headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("task run durability routes", () => {
  test("creates, lists, controls, and resumes a task run", async () => {
    const runId = `run-${Date.now()}`;

    const { status: createStatus, data: created } = await api("/task-runs", {
      method: "POST",
      body: JSON.stringify({
        id: runId,
        workspaceId: "ws-1",
        query: "Review jobs and compare them",
        rootTabId: 14,
        status: "planning",
        checkpointSummary: {
          currentIndex: 0,
          nodeCount: 1,
          turnNumber: 1,
        },
        sessionMetrics: { totalTokens: 10 },
        budget: { maxSessionTimeMs: 1000 },
      }),
    });

    expect(createStatus).toBe(201);
    expect(created.id).toBe(runId);
    expect(created.workspaceId).toBe("ws-1");

    const { status: nodeStatus } = await api(`/task-runs/${runId}/nodes/n1`, {
      method: "PUT",
      body: JSON.stringify({
        description: "Review the first listing",
        successCriteria: "Listing reviewed",
        allowedTools: ["read_page", "click_element"],
        dependencies: [],
        assumptions: [],
        handoffArtifacts: [],
        reflexionLog: [],
        handoffDepth: 0,
        status: "running",
        retries: 0,
      }),
    });
    expect(nodeStatus).toBe(200);

    const { status: interactionStatus, data: interactionData } = await api(
      `/task-runs/${runId}/pending-interaction`,
      {
        method: "PUT",
        body: JSON.stringify({
          interaction: {
            nodeId: "n1",
            kind: "approval",
            payload: { approvalId: "appr-1", toolName: "navigate" },
            requestedAt: 100,
            timeoutAt: 200,
            status: "active",
          },
        }),
      },
    );
    expect(interactionStatus).toBe(200);
    expect(interactionData.interaction.kind).toBe("approval");

    const { status: progressStatus, data: initialReviewedProgress } = await api(
      `/task-runs/${runId}/progress`,
      {
        method: "PUT",
        body: JSON.stringify({
          key: "reviewed-items",
          kind: "reviewed-item-list",
          payload: ["job-1", "job-2"],
        }),
      },
    );
    expect(progressStatus).toBe(200);
    expect(initialReviewedProgress.payload).toEqual(["job-1", "job-2"]);

    const { status: reviewedMergeStatus, data: mergedReviewedProgress } =
      await api(`/task-runs/${runId}/progress`, {
        method: "PUT",
        body: JSON.stringify({
          key: "reviewed-items",
          kind: "reviewed-item-list",
          payload: ["job-2", "job-3"],
        }),
      });
    expect(reviewedMergeStatus).toBe(200);
    expect(mergedReviewedProgress.payload).toEqual(["job-1", "job-2", "job-3"]);

    const { status: extractedFactsStatus, data: extractedFacts } = await api(
      `/task-runs/${runId}/progress`,
      {
        method: "PUT",
        body: JSON.stringify({
          key: "facts",
          kind: "extracted-fact-map",
          payload: {
            company: "Acme",
            location: "Berlin",
          },
        }),
      },
    );
    expect(extractedFactsStatus).toBe(200);
    expect(extractedFacts.payload).toEqual({
      company: "Acme",
      location: "Berlin",
    });

    const { status: mergedFactsStatus, data: mergedFacts } = await api(
      `/task-runs/${runId}/progress`,
      {
        method: "PUT",
        body: JSON.stringify({
          key: "facts",
          kind: "extracted-fact-map",
          payload: {
            location: "Remote",
            salary: "100k",
          },
        }),
      },
    );
    expect(mergedFactsStatus).toBe(200);
    expect(mergedFacts.payload).toEqual({
      company: "Acme",
      location: "Remote",
      salary: "100k",
    });

    const { status: phasesStatus } = await api(`/task-runs/${runId}/progress`, {
      method: "PUT",
      body: JSON.stringify({
        key: "completed-phases",
        kind: "completed-phase-list",
        payload: ["gathered-listings", "compared-shortlist"],
      }),
    });
    expect(phasesStatus).toBe(200);

    const { status: questionsStatus } = await api(`/task-runs/${runId}/progress`, {
      method: "PUT",
      body: JSON.stringify({
        key: "outstanding-questions",
        kind: "outstanding-question-list",
        payload: ["Need salary confirmation"],
      }),
    });
    expect(questionsStatus).toBe(200);

    const { status: sideEffectStatus } = await api(
      `/task-runs/${runId}/side-effects`,
      {
        method: "POST",
        body: JSON.stringify({
          entries: [
            {
              id: "se-1",
              nodeId: "n1",
              toolName: "click_element",
              args: { elementId: 3 },
              result: "clicked",
              timestamp: Date.now(),
              snapshotFingerprint: "abc",
            },
          ],
        }),
      },
    );
    expect(sideEffectStatus).toBe(201);

    const { status: patchStatus, data: patched } = await api(
      `/task-runs/${runId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "running",
          startedAt: 1234,
        }),
      },
    );
    expect(patchStatus).toBe(200);
    expect(patched.status).toBe("running");

    const { status: controlResumeStatus, data: resumeRequested } = await api(
      `/task-runs/${runId}/resume`,
      {
        method: "POST",
        body: JSON.stringify({ reason: "viewer resume click" }),
      },
    );
    expect(controlResumeStatus).toBe(200);
    expect(typeof resumeRequested.resumeRequestedAt).toBe("number");
    expect(resumeRequested.resumeRequestedReason).toBe("viewer resume click");

    const { status: controlStopStatus, data: stopRequested } = await api(
      `/task-runs/${runId}/stop`,
      {
        method: "POST",
        body: JSON.stringify({ reason: "viewer stop click" }),
      },
    );
    expect(controlStopStatus).toBe(200);
    expect(typeof stopRequested.stopRequestedAt).toBe("number");
    expect(stopRequested.stopRequestedReason).toBe("viewer stop click");

    const { status: listStatus, data: listData } = await api(
      "/task-runs?workspace_id=ws-1&status=running&include_progress_summary=true&control_requested=true",
    );
    expect(listStatus).toBe(200);
    const listed = listData.runs.find((run: any) => run.id === runId);
    expect(listed).toBeDefined();
    expect(listed.nodeCounts.running).toBe(1);
    expect(listed.pendingInteraction.kind).toBe("approval");
    expect(listed.progressSummary.reviewedItemCount).toBe(3);
    expect(listed.progressSummary.extractedFactCount).toBe(3);
    expect(listed.progressSummary.completedPhases).toEqual([
      "gathered-listings",
      "compared-shortlist",
    ]);
    expect(listed.progressSummary.outstandingQuestions).toEqual([
      "Need salary confirmation",
    ]);

    const { status: detailStatus, data: detailData } = await api(
      `/task-runs/${runId}`,
    );
    expect(detailStatus).toBe(200);
    expect(detailData.run.id).toBe(runId);
    expect(detailData.nodes).toHaveLength(1);
    expect(detailData.progress).toHaveLength(4);
    expect(detailData.pendingInteraction.kind).toBe("approval");
    expect(detailData.recentSideEffects).toHaveLength(1);

    const reviewedItems = detailData.progress.find(
      (entry: any) => entry.key === "reviewed-items",
    );
    expect(reviewedItems.payload).toEqual(["job-1", "job-2", "job-3"]);

    const { status: resumeStatus, data: resumeData } = await api(
      `/task-runs/${runId}/resume`,
    );
    expect(resumeStatus).toBe(200);
    expect(resumeData.run.id).toBe(runId);
    expect(resumeData.nodes).toHaveLength(1);

    const { status: clearInteractionStatus, data: clearedInteraction } =
      await api(`/task-runs/${runId}/pending-interaction`, {
        method: "PUT",
        body: JSON.stringify({ interaction: null }),
      });
    expect(clearInteractionStatus).toBe(200);
    expect(clearedInteraction.interaction).toBeNull();

    const { status: deleteProgressStatus } = await api(
      `/task-runs/${runId}/progress/reviewed-items`,
      {
        method: "DELETE",
      },
    );
    expect(deleteProgressStatus).toBe(204);
  });

  test("rejects invalid structured progress payloads and kind changes", async () => {
    const runId = `run-progress-${Date.now()}`;

    await api("/task-runs", {
      method: "POST",
      body: JSON.stringify({
        id: runId,
        workspaceId: "ws-progress",
        query: "Track progress",
        status: "running",
      }),
    });

    const { status: badPayloadStatus, data: badPayloadData } = await api(
      `/task-runs/${runId}/progress`,
      {
        method: "PUT",
        body: JSON.stringify({
          key: "reviewed-items",
          kind: "reviewed-item-list",
          payload: { not: "a list" },
        }),
      },
    );
    expect(badPayloadStatus).toBe(400);
    expect(badPayloadData.error).toContain("string array");

    const { status: validStatus } = await api(`/task-runs/${runId}/progress`, {
      method: "PUT",
      body: JSON.stringify({
        key: "reviewed-items",
        kind: "reviewed-item-list",
        payload: ["job-1"],
      }),
    });
    expect(validStatus).toBe(200);

    const { status: kindConflictStatus, data: kindConflictData } = await api(
      `/task-runs/${runId}/progress`,
      {
        method: "PUT",
        body: JSON.stringify({
          key: "reviewed-items",
          kind: "completed-phase-list",
          payload: ["done"],
        }),
      },
    );
    expect(kindConflictStatus).toBe(400);
    expect(kindConflictData.error).toContain("already exists with kind");
  });

  test("excludes completed and stopped runs from list responses by default", async () => {
    const completedId = `run-completed-${Date.now()}`;
    const stoppedId = `run-stopped-${Date.now()}`;

    await api("/task-runs", {
      method: "POST",
      body: JSON.stringify({
        id: completedId,
        workspaceId: "ws-filter",
        query: "completed run",
        status: "completed",
      }),
    });
    await api("/task-runs", {
      method: "POST",
      body: JSON.stringify({
        id: stoppedId,
        workspaceId: "ws-filter",
        query: "stopped run",
        status: "stopped",
      }),
    });

    const { data: hidden } = await api("/task-runs?workspace_id=ws-filter");
    expect(hidden.runs).toHaveLength(0);

    const { data: visible } = await api(
      "/task-runs?workspace_id=ws-filter&include_completed=true",
    );
    const ids = visible.runs.map((run: any) => run.id);
    expect(ids).toContain(completedId);
    expect(ids).toContain(stoppedId);
  });
});
