import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import {
  publicPlaygroundAction,
  publicPlaygroundCase,
  scenarioEngine,
} from "@opensidebar/scenario-engine";
import type { CloudConfig } from "./config.js";
import { opaqueToken, tokenHash } from "./crypto.js";
import {
  usablePlaygroundRun,
  type PlaygroundRunRecordV2,
  type PlaygroundV2Repository,
} from "./playground-v2-repository.js";

export function createPlaygroundV2TargetApi(
  repository: PlaygroundV2Repository,
  config: CloudConfig,
) {
  const app = new Hono();
  const cookie = "__Host-os_scenario_target";
  app.get("/scenario/launch/:token", async (c) => {
    const id = await repository.consumeLaunch(tokenHash(c.req.param("token")));
    const run = id ? await repository.get(id) : null;
    if (!usablePlaygroundRun(run))
      return c.json(
        {
          error: {
            code: "launch_expired",
            message:
              "This launch link has expired. Open a fresh run from Playground.",
          },
        },
        410,
      );
    const session = opaqueToken();
    await repository.createTargetSession(
      tokenHash(session),
      run.id,
      run.expiresAt,
    );
    setCookie(c, cookie, session, {
      path: "/",
      secure: config.cookieSecure,
      httpOnly: true,
      sameSite: "Lax",
      maxAge: Math.max(
        0,
        Math.floor((Date.parse(run.expiresAt) - Date.now()) / 1000),
      ),
    });
    c.header("Referrer-Policy", "no-referrer");
    return c.redirect(
      `/scenario/index.html?run=${encodeURIComponent(run.id)}`,
      302,
    );
  });
  const target = new Hono();
  target.use("*", async (c, next) => {
    if (
      c.req.method !== "GET" &&
      c.req.header("origin") !== config.targetOrigin
    )
      return c.json(
        {
          error: { code: "origin_failed", message: "Target origin rejected." },
        },
        403,
      );
    await next();
  });
  const read = async (c: Context) => {
    const raw = getCookie(c, cookie);
    const id = raw ? await repository.targetRunId(tokenHash(raw)) : null;
    const run = id ? await repository.get(id) : null;
    return usablePlaygroundRun(run) && run.id === c.req.param("runId")
      ? run
      : null;
  };
  target.get("/runs/:runId/state", async (c) => {
    const run = await read(c);
    return run
      ? c.json({ run: scenarioEngine.targetView(run.state) })
      : c.json(
          {
            error: {
              code: "target_session_required",
              message: "Open a run from Playground.",
            },
          },
          401,
        );
  });
  target.post("/runs/:runId/action", async (c) => {
    const run = await read(c);
    if (!run)
      return c.json(
        {
          error: {
            code: "target_session_required",
            message: "Open a run from Playground.",
          },
        },
        401,
      );
    let updated: PlaygroundRunRecordV2;
    try {
      const definition = publicPlaygroundCase(run.scenarioId);
      if (definition.contract.version !== run.scenarioVersion)
        throw new Error("This scenario has been updated. Start a fresh run.");
      const state = scenarioEngine.apply(
        run.state,
        publicPlaygroundAction(run.state, await c.req.json()),
      );
      const observationOnly =
        definition.contract.capabilityTags.includes("answer");
      const result = observationOnly
        ? "page_state_only"
        : scenarioEngine.validate({
              definition,
              initialState: scenarioEngine.initialize(definition.contract.id),
              finalState: state,
            }).verdict === "pass"
          ? "succeeded"
          : "not_completed";
      updated = {
        ...run,
        state,
        revision: state.revision,
        lifecycle: state.lifecycle,
        result,
        updatedAt: new Date().toISOString(),
      };
    } catch {
      return c.json(
        {
          error: {
            code: "invalid_action",
            message: "This action is not available for the current page state.",
          },
        },
        400,
      );
    }
    if (!(await repository.update(updated, run.revision)))
      return c.json(
        {
          error: {
            code: "revision_conflict",
            message: "The page changed. Refresh and try again.",
          },
        },
        409,
      );
    return c.json({ run: scenarioEngine.targetView(updated.state) });
  });
  app.route("/api/v2/playground-target", target);
  return app;
}
