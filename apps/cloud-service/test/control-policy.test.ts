import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ControlPolicyError,
  parseCloudPreferences,
  parseRelayRequest,
} from "../src/control-policy.js";

const rejectsCode = (action: () => unknown, code: ControlPolicyError["code"]) =>
  assert.throws(
    action,
    (error: unknown) =>
      error instanceof ControlPolicyError && error.code === code,
  );

test("relay accepts bounded strict routing and rejects routing escape hatches", () => {
  const base = {
    schemaVersion: 1,
    requestId: "b0e38c60-f154-4eb3-94bf-da143648153a",
    abortScopeId: "task-1",
    provider: "openrouter",
    modelId: "allowed/model",
    seat: "planner",
    messages: [{ role: "user", content: "hello" }],
  };
  const routing = {
    only: ["fast/fp8"],
    order: ["fast/fp8"],
    allow_fallbacks: false,
    require_parameters: true,
    max_price: { completion: 1 },
  };
  const parse = (providerRouting: unknown, provider = "openrouter") =>
    parseRelayRequest(
      { ...base, provider, providerRouting },
      1_000,
      new Set(["allowed/model"]),
    );
  assert.deepEqual(parse(routing).providerRouting, routing);
  for (const invalid of [
    { ...routing, only: [] },
    { ...routing, order: ["outside"] },
    { ...routing, allow_fallbacks: true },
    { ...routing, require_parameters: false },
    { ...routing, max_price: { completion: 2 } },
    null,
    [],
    { ...routing, only: ["bad slug"] },
    { ...routing, only: [3] },
    { ...routing, only: Array(101).fill("fast/fp8") },
    { ...routing, order: [] },
    { ...routing, max_price: null },
    { ...routing, max_price: { completion: -1 } },
    { ...routing, max_price: { completion: NaN } },
    { ...routing, max_price: { completion: Infinity } },
    { ...routing, max_price: { completion: "1" } },
    { ...routing, max_price: { completion: 1, prompt: 0 } },
    { ...routing, url: "https://other.invalid" },
  ])
    rejectsCode(() => parse(invalid), "invalid_request");
  rejectsCode(() => parse(routing, "fireworks"), "invalid_provider");
});

test("cloud preferences accept only the explicit safe allowlist", () => {
  const value = parseCloudPreferences({
    schemaVersion: 1,
    revision: 1,
    inferenceMode: "cloud",
    providerMode: "openrouter",
    maxTurns: 25,
    theme: "system",
    showSessionMetrics: true,
  });
  assert.equal(value.inferenceMode, "cloud");
  rejectsCode(
    () => parseCloudPreferences({ ...value, requireApprovals: false }),
    "invalid_request",
  );
  rejectsCode(
    () => parseCloudPreferences({ ...value, siteAccessBlocklist: [] }),
    "invalid_request",
  );
  rejectsCode(
    () =>
      parseCloudPreferences({ ...value, perceptionMode: "unsafe_remote_mode" }),
    "invalid_request",
  );
});

test("relay policy rejects arbitrary routing and headers", () => {
  const base = {
    schemaVersion: 1,
    requestId: "b0e38c60-f154-4eb3-94bf-da143648153a",
    abortScopeId: "task-1",
    provider: "openrouter",
    modelId: "allowed/model",
    seat: "executor",
    messages: [{ role: "user", content: "hello" }],
  };
  const parsed = parseRelayRequest(
    base,
    JSON.stringify(base).length,
    new Set(["allowed/model"]),
  );
  assert.equal(parsed.modelId, "allowed/model");
  rejectsCode(
    () =>
      parseRelayRequest(
        { ...base, url: "https://attacker.invalid" },
        200,
        new Set(["allowed/model"]),
      ),
    "invalid_request",
  );
  rejectsCode(
    () =>
      parseRelayRequest(
        { ...base, headers: { authorization: "stolen" } },
        200,
        new Set(["allowed/model"]),
      ),
    "invalid_request",
  );
  rejectsCode(
    () =>
      parseRelayRequest(
        { ...base, modelId: "other/model" },
        200,
        new Set(["allowed/model"]),
      ),
    "invalid_request",
  );
  rejectsCode(
    () =>
      parseRelayRequest(
        {
          ...base,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: "data:image/png;base64,AA==",
                    headers: { authorization: "stolen" },
                  },
                },
              ],
            },
          ],
        },
        300,
        new Set(["allowed/model"]),
      ),
    "invalid_request",
  );
  rejectsCode(
    () =>
      parseRelayRequest(
        {
          ...base,
          tools: [
            {
              type: "function",
              function: {
                name: "click",
                description: "Click",
                parameters: { type: "object", properties: {}, required: [] },
                url: "https://attacker.invalid",
              },
            },
          ],
        },
        300,
        new Set(["allowed/model"]),
      ),
    "invalid_request",
  );
});
