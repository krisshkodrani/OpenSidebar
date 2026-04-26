import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { join } from "path";
import { tmpdir } from "os";
import { unlinkSync, writeFileSync } from "fs";
import { initDatabase, closeDatabase } from "../src/db";

// We test the route handlers directly by building a minimal server.

import { handleTaskRoutes } from "../src/routes/tasks";
import { handleProfileRoutes } from "../src/routes/profile";
import { handleTaskRunRoutes } from "../src/routes/task-runs";
import { handleMemoryRoutes } from "../src/routes/memory";
import type { RouteContext } from "../src/server";

let server: Server;
let baseUrl: string;
let dbPath: string;
let profilePath: string;

function parseJsonBody(req: NodeJS.ReadableStream): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: any, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function sendEmpty(res: any, status = 204): void {
  res.writeHead(status);
  res.end();
}

function sendError(res: any, message: string, status = 400): void {
  sendJson(res, { error: message }, status);
}

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
      "    first_name: Kai",
      "    last_name: Schmidt",
      "  sensitive:",
      '    date_of_birth: "1990-01-01"',
      "",
    ].join("\n"),
  );

  server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    const ctx: RouteContext = {
      pathname: url.pathname,
      searchParams: url.searchParams,
      method: req.method || "GET",
      parseJsonBody: () => parseJsonBody(req),
      sendJson,
      sendEmpty,
      sendError,
    };

    if (url.pathname === "/health") {
      sendJson(res, { status: "ok", pendingTasks: 0 });
      return;
    }

    if (url.pathname.startsWith("/tasks")) {
      await handleTaskRoutes(req, res, ctx);
      return;
    }

    if (url.pathname.startsWith("/task-runs")) {
      await handleTaskRunRoutes(req, res, ctx);
      return;
    }

    if (url.pathname.startsWith("/memory")) {
      await handleMemoryRoutes(req, res, ctx);
      return;
    }

    if (url.pathname.startsWith("/profile")) {
      await handleProfileRoutes(req, res, ctx);
      return;
    }

    sendError(res, "Not found", 404);
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

// Helper
async function api(
  path: string,
  options?: RequestInit,
): Promise<{ status: number; data: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const text = await res.text();
  return {
    status: res.status,
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

describe("POST /profile/resolve", () => {
  test("returns exact requested fields and marks sensitive ones", async () => {
    const { status, data } = await api("/profile/resolve", {
      method: "POST",
      body: JSON.stringify({
        fields: [
          "identity.first_name",
          "sensitive.date_of_birth",
          "identity.email",
        ],
      }),
    });

    expect(status).toBe(200);
    expect(data.values).toEqual({
      "identity.first_name": "Kai",
      "sensitive.date_of_birth": "1990-01-01",
    });
    expect(data.missing).toEqual(["identity.email"]);
    expect(data.sensitiveFields).toEqual(["sensitive.date_of_birth"]);
  });
});

describe("POST /memory", () => {
  test("creates, lists, searches, fetches, and deletes native memories", async () => {
    const { status, data } = await api("/memory", {
      method: "POST",
      body: JSON.stringify({
        category: "site-knowledge",
        title: "Example memory",
        content:
          "Remember this result for example.com. SKU-160K Migration 4271 foo-Migration.",
        workspaceId: "ws-1",
        metadata: {
          domain: "example.com",
          tipType: "strategy",
          confidence: 0.95,
        },
      }),
    });

    expect(status).toBe(201);
    expect(data.id).toBeTruthy();
    expect(data.slug).toBe(data.id);

    const memoryId = data.id as string;

    const { status: listStatus, data: listData } = await api("/memory/list");
    expect(listStatus).toBe(200);
    expect(
      listData.results.some((item: any) => item.id === memoryId && item.category === "site-knowledge"),
    ).toBe(true);

    const { status: searchStatus, data: searchData } = await api(
      "/memory/search?q=remember%20result&limit=5",
    );
    expect(searchStatus).toBe(200);
    expect(searchData.results.some((item: any) => item.id === memoryId)).toBe(true);

    const { status: hyphenatedStatus, data: hyphenatedData } = await api(
      "/memory/search?q=SKU-160K&limit=5",
    );
    expect(hyphenatedStatus).toBe(200);
    expect(hyphenatedData.results.some((item: any) => item.id === memoryId)).toBe(true);

    const { status: spacedDashStatus, data: spacedDashData } = await api(
      "/memory/search?q=Migration%20-%204271&limit=5",
    );
    expect(spacedDashStatus).toBe(200);
    expect(spacedDashData.results.some((item: any) => item.id === memoryId)).toBe(true);

    const { status: wordHyphenStatus, data: wordHyphenData } = await api(
      "/memory/search?q=foo-Migration&limit=5",
    );
    expect(wordHyphenStatus).toBe(200);
    expect(wordHyphenData.results.some((item: any) => item.id === memoryId)).toBe(true);

    const { status: domainStatus, data: domainData } = await api(
      "/memory/domain?d=example.com&limit=5",
    );
    expect(domainStatus).toBe(200);
    expect(domainData.results.some((item: any) => item.id === memoryId)).toBe(true);

    const { status: detailStatus, data: detailData } = await api(`/memory/${memoryId}`);
    expect(detailStatus).toBe(200);
    expect(detailData.id).toBe(memoryId);
    expect(detailData.metadata.domain).toBe("example.com");

    const { status: deleteStatus } = await api(`/memory/${memoryId}`, {
      method: "DELETE",
    });
    expect(deleteStatus).toBe(204);

    const { status: missingStatus } = await api(`/memory/${memoryId}`);
    expect(missingStatus).toBe(404);
  });
});

describe("POST /tasks", () => {
  test("creates a task with cron schedule", async () => {
    const { status, data } = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({
        description: "Daily check",
        query: "Check HN",
        schedule: "0 9 * * *",
      }),
    });

    expect(status).toBe(201);
    expect(data.id).toBeTruthy();
    expect(data.status).toBe("pending");
    expect(data.schedule).toBe("0 9 * * *");
    expect(data.runAt).toBeGreaterThan(Date.now());
  });

  test("creates a one-shot task with runAt", async () => {
    const futureTime = Date.now() + 3_600_000;
    const { status, data } = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({
        description: "One-shot",
        query: "Do something",
        runAt: futureTime,
      }),
    });

    expect(status).toBe(201);
    expect(data.runAt).toBe(futureTime);
    expect(data.schedule).toBeNull();
  });

  test("rejects invalid cron expression", async () => {
    const { status, data } = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({
        description: "Bad cron",
        query: "Test",
        schedule: "not-a-cron",
      }),
    });

    expect(status).toBe(400);
    expect(data.error).toContain("Invalid cron");
  });

  test("rejects task without schedule or runAt", async () => {
    const { status, data } = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({
        description: "No timing",
        query: "Test",
      }),
    });

    expect(status).toBe(400);
    expect(data.error).toBeTruthy();
  });

  test("rejects task without required fields", async () => {
    const { status } = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({ query: "Missing description" }),
    });
    expect(status).toBe(400);
  });
});

describe("GET /tasks", () => {
  test("lists all tasks", async () => {
    const { data } = await api("/tasks");
    expect(data.tasks).toBeDefined();
    expect(Array.isArray(data.tasks)).toBe(true);
  });

  test("filters by status", async () => {
    // Create and complete a task
    const { data: created } = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({
        description: "To complete",
        query: "Test",
        runAt: Date.now() + 1000,
      }),
    });
    await api(`/tasks/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
    });

    const { data: completed } = await api("/tasks?status=completed");
    expect(completed.tasks.some((t: any) => t.id === created.id)).toBe(true);

    const { data: pending } = await api("/tasks?status=pending");
    expect(pending.tasks.some((t: any) => t.id === created.id)).toBe(false);
  });

  test("rejects invalid status filter", async () => {
    const { status } = await api("/tasks?status=bogus");
    expect(status).toBe(400);
  });
});

describe("GET /tasks/pending", () => {
  test("returns tasks with past runAt", async () => {
    const { data: created } = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({
        description: "Due now",
        query: "Test",
        runAt: Date.now() - 5000,
      }),
    });

    const { data } = await api("/tasks/pending");
    expect(data.tasks.some((t: any) => t.id === created.id)).toBe(true);
  });

  test("excludes tasks with future runAt", async () => {
    const { data: created } = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({
        description: "Not yet",
        query: "Test",
        runAt: Date.now() + 999_999,
      }),
    });

    const { data } = await api("/tasks/pending");
    expect(data.tasks.some((t: any) => t.id === created.id)).toBe(false);
  });
});

describe("PATCH /tasks/:id", () => {
  test("updates task status and result", async () => {
    const { data: created } = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({
        description: "To update",
        query: "Test",
        runAt: Date.now() - 1000,
      }),
    });

    const { status, data } = await api(`/tasks/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "completed", result: "All done" }),
    });

    expect(status).toBe(200);
    expect(data.status).toBe("completed");
    expect(data.result).toBe("All done");
    expect(data.lastRunAt).toBeGreaterThan(0);
  });

  test("recurring task resets to pending with new runAt on completion", async () => {
    const { data: created } = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({
        description: "Recurring",
        query: "Check",
        schedule: "0 9 * * *",
      }),
    });
    const originalRunAt = created.runAt;

    const { data: updated } = await api(`/tasks/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
    });

    expect(updated.status).toBe("pending");
    expect(updated.runAt).toBeGreaterThanOrEqual(originalRunAt);
  });

  test("returns 404 for non-existent task", async () => {
    const { status } = await api("/tasks/nonexistent-id", {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
    });
    expect(status).toBe(404);
  });

  test("rejects invalid status value", async () => {
    const { data: created } = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({
        description: "T",
        query: "Q",
        runAt: Date.now() + 1000,
      }),
    });
    const { status } = await api(`/tasks/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "invalid" }),
    });
    expect(status).toBe(400);
  });
});

describe("DELETE /tasks/:id", () => {
  test("removes a task and returns 204", async () => {
    const { data: created } = await api("/tasks", {
      method: "POST",
      body: JSON.stringify({
        description: "Delete me",
        query: "Test",
        runAt: Date.now() + 1000,
      }),
    });

    const { status } = await api(`/tasks/${created.id}`, { method: "DELETE" });
    expect(status).toBe(204);

    // Verify it's gone from the list
    const { data: list } = await api("/tasks");
    expect(list.tasks.some((t: any) => t.id === created.id)).toBe(false);
  });

  test("returns 404 for non-existent task", async () => {
    const { status } = await api("/tasks/nonexistent", { method: "DELETE" });
    expect(status).toBe(404);
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
