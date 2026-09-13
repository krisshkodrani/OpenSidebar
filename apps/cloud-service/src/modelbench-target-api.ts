import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { JsonObject, ScenarioActionV2 } from "@opensidebar/scenario-contracts";
import { scenarioEngine, ScenarioRevisionConflict } from "@opensidebar/scenario-engine";
import type { CloudConfig } from "./config.js";
import { opaqueToken, tokenHash } from "./crypto.js";
import type { ModelBenchRepository } from "./modelbench-repository.js";

const problem = (c: Context, status: 400 | 401 | 403 | 409 | 410, code: string, message: string) => {
  c.header("Cache-Control", "no-store");
  return c.json({ error: { code, message } }, status);
};

export function createModelBenchTargetApi(repository: ModelBenchRepository, config: CloudConfig) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.get("/modelbench/launch/:token", async (c) => {
    const runId = await repository.consumeLaunch(tokenHash(c.req.param("token")));
    if (!runId) return problem(c, 410, "launch_expired", "This launch link expired.");
    const session = opaqueToken();
    await repository.createTargetSession(
      tokenHash(session),
      runId,
      new Date(Date.now() + 7_200_000).toISOString(),
    );
    setCookie(c, "__Host-os_modelbench_target", session, {
      path: "/",
      secure: config.cookieSecure,
      httpOnly: true,
      sameSite: "Lax",
      maxAge: 7200,
    });
    c.header("Referrer-Policy", "no-referrer");
    return c.redirect("/modelbench/index.html", 302);
  });

  const target = new Hono();
  target.use("*", async (c, next) => {
    if (["POST", "PATCH", "DELETE"].includes(c.req.method) && c.req.header("origin") !== config.targetOrigin) {
      return problem(c, 403, "origin_failed", "Target origin rejected.");
    }
    await next();
  });
  const targetRun = async (c: Context) => {
    const raw = getCookie(c, "__Host-os_modelbench_target");
    const runId = raw ? await repository.targetRunId(tokenHash(raw)) : null;
    const run = runId ? await repository.get(runId) : null;
    return run && run.lifecycle !== "expired" && Date.parse(run.expiresAt) > Date.now() ? run : null;
  };
  target.get("/state", async (c) => {
    const run = await targetRun(c);
    return run
      ? c.json({ run: scenarioEngine.targetView(run.state) })
      : problem(c, 401, "target_session_required", "Open from ModelBench Control Center.");
  });
  target.post("/action", async (c) => {
    const run = await targetRun(c);
    if (!run) return problem(c, 401, "target_session_required", "Open from ModelBench Control Center.");
    const input: { type?: unknown; payload?: unknown } = await c.req
      .json<{ type?: unknown; payload?: unknown }>()
      .catch(() => ({}));
    if (!["case.submit", "case.terminal", "workflow.advance", "workflow.recover"].includes(String(input.type))) {
      return problem(c, 400, "invalid_action", "Unsupported target action.");
    }
    const action: ScenarioActionV2 = {
      type: String(input.type),
      payload: input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
        ? input.payload as JsonObject
        : {},
    };
    try {
      const updated = await repository.apply(run.id, run.revision, action, new Date().toISOString());
      return c.json({ run: scenarioEngine.targetView(updated.state) });
    } catch (error) {
      if (error instanceof ScenarioRevisionConflict) {
        return problem(c, 409, "revision_conflict", "Target state changed. Refresh and retry.");
      }
      return problem(c, 400, "invalid_action", error instanceof Error ? error.message : "Target action failed.");
    }
  });
  app.route("/api/v2/target", target);
  return app;
}
