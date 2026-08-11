import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { CloudConfig } from "./config.js";
import type { TemporalShadowOutbox } from "./temporal-shadow-outbox.js";

const equal = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export function createTemporalShadowApi(
  config: CloudConfig,
  outbox: TemporalShadowOutbox,
) {
  const api = new Hono();
  api.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (!config.temporalShadowEnabled || !config.temporalShadowToken)
      return c.json({ error: { code: "temporal_shadow_disabled" } }, 503);
    const supplied =
      c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!equal(supplied, config.temporalShadowToken))
      return c.json({ error: { code: "unauthorized" } }, 401);
    await next();
  });
  api.post("/claims", async (c) => {
    const body: { limit?: number } = await c.req
      .json<{ limit?: number }>()
      .catch(() => ({}));
    return c.json({ schemaVersion: 1, events: await outbox.claim(body.limit) });
  });
  api.post("/events/:eventId/complete", async (c) => {
    const body: { claimToken?: string } = await c.req
      .json<{ claimToken?: string }>()
      .catch(() => ({}));
    if (!body.claimToken)
      return c.json({ error: { code: "invalid_request" } }, 400);
    return (await outbox.complete(c.req.param("eventId"), body.claimToken))
      ? c.json({ completed: true })
      : c.json({ error: { code: "claim_expired" } }, 409);
  });
  api.post("/events/:eventId/retry", async (c) => {
    const body: { claimToken?: string } = await c.req
      .json<{ claimToken?: string }>()
      .catch(() => ({}));
    if (!body.claimToken)
      return c.json({ error: { code: "invalid_request" } }, 400);
    await outbox.retry(c.req.param("eventId"), body.claimToken);
    return c.json({ retried: true });
  });
  return api;
}
