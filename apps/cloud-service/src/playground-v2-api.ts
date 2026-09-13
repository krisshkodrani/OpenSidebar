import { Hono } from "hono";
import {
  publicPlaygroundCase,
  publicPlaygroundCatalog,
  scenarioEngine,
} from "@opensidebar/scenario-engine";
import { opaqueToken, tokenHash } from "./crypto.js";
import {
  publicPlaygroundRun,
  usablePlaygroundRun,
  type PlaygroundV2Repository,
} from "./playground-v2-repository.js";

export type PlaygroundVariables = {
  accountId: string;
  email: string;
  csrfHash: string;
};

export function createPlaygroundV2Api(
  repository: PlaygroundV2Repository,
  targetOrigin: string,
  enabled: boolean,
) {
  const api = new Hono<{ Variables: PlaygroundVariables }>();
  api.get("/scenarios", (c) =>
    c.json({
      schemaVersion: 2,
      enabled,
      scenarios: enabled ? publicPlaygroundCatalog() : [],
    }),
  );
  api.use("*", async (c, next) => {
    if (!enabled)
      return c.json(
        {
          error: {
            code: "playground_unavailable",
            message:
              "Playground scenarios are being updated. Please try again later.",
          },
        },
        503,
      );
    await next();
  });
  api.get("/runs", async (c) =>
    c.json({
      runs: (await repository.list(c.get("accountId"))).map(
        publicPlaygroundRun,
      ),
    }),
  );
  api.post("/runs", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== "scenarioId") ||
      !("scenarioId" in body) ||
      typeof body.scenarioId !== "string"
    )
      return c.json(
        {
          error: {
            code: "invalid_scenario",
            message: "Choose a Playground scenario.",
          },
        },
        400,
      );
    let definition;
    try {
      definition = publicPlaygroundCase(body.scenarioId);
    } catch {
      return c.json(
        {
          error: {
            code: "invalid_scenario",
            message: "Unknown public scenario.",
          },
        },
        400,
      );
    }
    const key = c.req.header("idempotency-key")?.trim();
    if (!key || key.length > 200)
      return c.json(
        {
          error: {
            code: "idempotency_required",
            message: "Provide an Idempotency-Key.",
          },
        },
        400,
      );
    const timestamp = new Date();
    const state = scenarioEngine.initialize(definition.contract.id);
    try {
      const run = await repository.create(
        {
          id: `p2_${opaqueToken(12)}`,
          ownerId: c.get("accountId"),
          scenarioId: body.scenarioId,
          scenarioVersion: definition.contract.version,
          lifecycle: "ready",
          revision: state.revision,
          state,
          result: null,
          createdAt: timestamp.toISOString(),
          updatedAt: timestamp.toISOString(),
          expiresAt: new Date(timestamp.getTime() + 7_200_000).toISOString(),
        },
        tokenHash(key),
      );
      return c.json({ run: publicPlaygroundRun(run) }, 201);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "concurrent_run_limit" || code === "daily_run_limit")
        return c.json(
          {
            error: {
              code,
              message:
                "Playground run allowance reached. Remove an old run or try again later.",
            },
          },
          429,
        );
      if (code === "idempotency_conflict")
        return c.json(
          {
            error: {
              code,
              message: "This request key belongs to another scenario.",
            },
          },
          409,
        );
      throw error;
    }
  });
  api.delete("/runs/:id", async (c) =>
    (await repository.remove(c.req.param("id"), c.get("accountId")))
      ? c.body(null, 204)
      : c.json(
          { error: { code: "run_not_found", message: "Run not found." } },
          404,
        ),
  );
  api.post("/runs/:id/launch", async (c) => {
    const run = await repository.get(c.req.param("id"));
    if (!usablePlaygroundRun(run) || run.ownerId !== c.get("accountId"))
      return c.json(
        {
          error: {
            code: "run_not_found",
            message: "Run not found or expired.",
          },
        },
        404,
      );
    const token = opaqueToken(24);
    await repository.createLaunch(
      tokenHash(token),
      run.id,
      new Date(
        Math.min(Date.now() + 300_000, Date.parse(run.expiresAt)),
      ).toISOString(),
    );
    return c.json(
      {
        launchUrl: `${targetOrigin}/scenario/launch/${token}`,
        expiresInSeconds: 300,
      },
      201,
    );
  });
  return api;
}
