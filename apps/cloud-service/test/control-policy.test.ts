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
