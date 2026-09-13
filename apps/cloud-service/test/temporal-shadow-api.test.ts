import assert from "node:assert/strict";
import test from "node:test";
import { createTemporalShadowApi } from "../src/temporal-shadow-api.js";
import type { CloudConfig } from "../src/config.js";

const config = {
  temporalShadowEnabled: true,
  temporalShadowToken: "t".repeat(32),
} as CloudConfig;
const outbox = {
  claim: async () => [],
  complete: async () => true,
  retry: async () => undefined,
};

test("internal shadow claims fail closed and return no content fields", async () => {
  const api = createTemporalShadowApi(config, outbox as never);
  assert.equal((await api.request("/claims", { method: "POST" })).status, 401);
  const response = await api.request("/claims", {
    method: "POST",
    headers: { authorization: `Bearer ${config.temporalShadowToken}` },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { schemaVersion: 1, events: [] });
});
