import { Hono } from "hono";
import type { BenchmarkAttemptV1, ScenarioActionV2 } from "@opensidebar/scenario-contracts";
import { scenarioEngine } from "@opensidebar/scenario-engine";
import type { ModelBenchRepository } from "./modelbench-repository.js";

type Variables = { principal: { accountId: string } };

const problem = (c: any, status: 400 | 404 | 409, code: string, message: string) => {
  c.header("Cache-Control", "no-store");
  return c.json({ error: { code, message } }, status);
};

function attempt(value: unknown): value is BenchmarkAttemptV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<BenchmarkAttemptV1>;
  return (
    item.schemaVersion === 1 &&
    typeof item.attemptId === "string" &&
    typeof item.caseId === "string" &&
    typeof item.caseVersion === "number" &&
    typeof item.caseContentHash === "string" &&
    typeof item.buildRevision === "string" &&
    typeof item.startedAt === "string" &&
    typeof item.durationMs === "number" &&
    typeof item.classification === "string" &&
    typeof item.scoreEligible === "boolean" &&
    Array.isArray(item.artifactRefs)
  );
}

export function createModelBenchApi(repository: ModelBenchRepository) {
  const api = new Hono<{ Variables: Variables }>();
  api.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  api.post("/runs", async (c) => {
    const body = await c.req
      .json<{ caseId?: string }>()
      .catch((): { caseId?: string } => ({}));
    if (typeof body.caseId !== "string") {
      return problem(c, 400, "invalid_case", "caseId is required.");
    }
    try {
      scenarioEngine.case(body.caseId);
    } catch {
      return problem(c, 400, "invalid_case", "Unknown ModelBench case.");
    }
    const now = new Date();
    const run = await repository.create({
      id: `run_${crypto.randomUUID()}`,
      ownerId: c.get("principal").accountId,
      caseId: body.caseId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7_200_000).toISOString(),
    });
    return c.json({ run }, 201);
  });
  api.get("/runs/:runId", async (c) => {
    const run = await repository.get(c.req.param("runId"));
    return run && run.ownerId === c.get("principal").accountId
      ? c.json({ run })
      : problem(c, 404, "run_not_found", "Run not found.");
  });
  api.post("/runs/:runId/actions", async (c) => {
    const run = await repository.get(c.req.param("runId"));
    if (!run || run.ownerId !== c.get("principal").accountId) {
      return problem(c, 404, "run_not_found", "Run not found.");
    }
    const body = await c.req
      .json<{ revision?: number; action?: ScenarioActionV2 }>()
      .catch((): { revision?: number; action?: ScenarioActionV2 } => ({}));
    if (!Number.isInteger(body.revision) || !body.action || typeof body.action.type !== "string") {
      return problem(c, 400, "invalid_action", "revision and action are required.");
    }
    try {
      return c.json({
        run: await repository.apply(run.id, body.revision!, body.action, new Date().toISOString()),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "ScenarioRevisionConflict") {
        return problem(c, 409, "revision_conflict", "Run changed. Refresh and retry.");
      }
      throw error;
    }
  });
  api.post("/attempts", async (c) => {
    const body = await c.req.json<unknown>().catch(() => null);
    if (!attempt(body)) return problem(c, 400, "invalid_attempt", "Attempt payload is invalid.");
    const definition = (() => {
      try { return scenarioEngine.case(body.caseId, body.caseVersion); } catch { return null; }
    })();
    if (!definition || definition.contentHash !== body.caseContentHash) {
      return problem(c, 409, "case_version_mismatch", "Attempt case identity does not match the released catalog.");
    }
    await repository.saveAttempt(
      body,
      new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    );
    return c.json({ attemptId: body.attemptId }, 201);
  });
  api.get("/attempts", async (c) =>
    c.json({ attempts: await repository.listAttempts(c.req.query("caseId")) }),
  );
  return api;
}
