import assert from "node:assert/strict";
import test from "node:test";
import { observeProviderCall, providerSlugsFromCatalog, summarizeProviderCalls } from "./modelbench-provider-evidence.js";

const seats = { executor: { provider: "openrouter", providerPin: "coreweave", model: "test/model" } };

test("reported display names require an unambiguous catalog mapping to the pinned slug", () => {
  const requested = { executor: { ...seats.executor, providerPin: "example-host" } };
  const call = observeProviderCall('{"model":"test/model"}',
    '{"model":"test/model","provider":"Example.Host","usage":{"cost":0.01}}', 200, 1);
  assert.ok(summarizeProviderCalls([call], requested).issues.length);
  const catalog = providerSlugsFromCatalog([{ name: "Example.Host", slug: "example-host" }]);
  const result = summarizeProviderCalls([call], requested, catalog);
  assert.deepEqual(result.issues, []);
  assert.equal(result.resolvedSeats.executor?.resolvedProvider, "example-host");
  assert.equal(call.provider, "example.host");
  const ambiguous = providerSlugsFromCatalog([
    { name: "Example.Host", slug: "example-host" },
    { name: "Example.Host", slug: "another-host" },
  ]);
  assert.ok(summarizeProviderCalls([call], requested, ambiguous).issues.length);
  assert.deepEqual(providerSlugsFromCatalog(null), {});
});

test("non-object error bodies do not break passive response observation", () => {
  for (const response of ["null", "[]", "data: null\n", "upstream unavailable"]) {
    const call = observeProviderCall('{"model":"test/model"}', response, 503, 12);
    assert.equal(call.status, 503);
    assert.equal(call.usageReported, false);
    assert.match(summarizeProviderCalls([call], seats).providerFailures[0], /503/);
  }
});

test("an entirely unserved seat is a provider failure, but recovered same-route retries are not", () => {
  const rejected = observeProviderCall('{"model":"test/model"}', '{"error":{"code":429}}', 429, 12);
  const success = observeProviderCall('{"model":"test/model"}', '{"model":"test/model","provider":"CoreWeave","usage":{"cost":0.01}}', 200, 12);
  assert.match(summarizeProviderCalls([rejected, rejected], seats).providerFailures[0], /executor.*HTTP 429/);
  assert.deepEqual(summarizeProviderCalls([rejected, success], seats).providerFailures, []);
  assert.deepEqual(summarizeProviderCalls([], seats).providerFailures, []);
});
test("observes streamed identity and billed usage without keeping response content", () => {
  const response = 'data: {"provider":"CoreWeave","model":"test/model","choices":[{"delta":{"content":"private answer"}}]}\n' +
    'data: {"usage":{"prompt_tokens":10,"completion_tokens":2,"cost":0.01,"prompt_tokens_details":{"cached_tokens":4}}}\n' + 'data: [DONE]\n';
  const call = observeProviderCall('{"model":"test/model"}', response, 200, 12);
  assert.equal(call.provider, "coreweave");
  assert.equal(call.usage.costUsd, 0.01);
  assert.equal(JSON.stringify(call).includes("private answer"), false);
  const result = summarizeProviderCalls([call], seats);
  assert.deepEqual(result.issues, []);
  assert.equal(result.resolvedSeats.executor?.resolvedProvider, "coreweave");
  assert.equal(result.usageByRole.executor?.cachedTokens, 4);
});

test("missing provider metadata and wrong routes are never inferred from the pin", () => {
  for (const provider of [undefined, "OtherHost"]) {
    const call = observeProviderCall('{"model":"test/model"}', JSON.stringify({ model: "test/model", provider }), 200, 1);
    const result = summarizeProviderCalls([call], seats);
    assert.equal(result.resolvedSeats.executor, undefined);
    assert.ok(result.issues.some((issue) => issue.startsWith("Unverified route")));
  }
});

test("retains every role's reported costs and detects unconfigured models", () => {
  const calls = ["test/model", "planner/model", "judge/model", "other/model"].map((model) =>
    observeProviderCall(JSON.stringify({ model }), JSON.stringify({ model, provider: "CoreWeave", usage: { cost: 0.01 } }), 200, 1));
  const result = summarizeProviderCalls(calls, {
    ...seats,
    planner: { ...seats.executor, model: "planner/model" },
    judge: { ...seats.executor, model: "judge/model" },
  });
  assert.equal(Object.keys(result.usageByRole).length, 3);
  assert.equal(result.usageByRole.judge?.costUsd, 0.01);
  assert.match(result.issues[0], /other\/model/);
});

test("explicit request roles separate concurrent same-model calls and provider pins", () => {
  const shared = {
    executor: { provider: "openrouter", providerPin: "coreweave", model: "test/model" },
    planner: { provider: "openrouter", providerPin: "other-host", model: "test/model" },
  };
  const planner = observeProviderCall('{"model":"test/model"}',
    '{"model":"test/model","provider":"Other Host","usage":{"cost":0.02}}',
    200, 20, { role: "planner", requestId: "parallel-planner" });
  const executor = observeProviderCall('{"model":"test/model"}',
    '{"model":"test/model","provider":"CoreWeave","usage":{"cost":0.01}}',
    200, 10, { role: "executor", requestId: "parallel-executor" });
  const result = summarizeProviderCalls([planner, executor], shared, { "other host": "other-host" });
  assert.deepEqual(result.issues, []);
  assert.equal(result.usageByRole.planner?.costUsd, 0.02);
  assert.equal(result.usageByRole.executor?.costUsd, 0.01);
  assert.equal(result.resolvedSeats.planner?.resolvedProvider, "other-host");
  assert.equal(result.resolvedSeats.executor?.resolvedProvider, "coreweave");
  assert.equal(planner.requestId, "parallel-planner");
  const samePin = summarizeProviderCalls([executor, { ...executor, role: "planner", requestId: "same-pin-planner" }],
    { executor: shared.executor, planner: { ...shared.planner, providerPin: "coreweave" } });
  assert.deepEqual(samePin.issues, []);
  assert.equal(samePin.usageByRole.planner?.calls, 1);
  const ambiguous = summarizeProviderCalls([observeProviderCall('{"model":"test/model"}',
    '{"model":"test/model","provider":"CoreWeave","usage":{"cost":0.03}}', 200, 1)], shared);
  assert.equal(ambiguous.unattributedUsage.costUsd, 0.03);
  assert.equal(Object.keys(ambiguous.usageByRole).length, 0);
});

test("same-model retries, unserved roles and an unconfigured writer stay attributable", () => {
  const shared = { executor: seats.executor, planner: { ...seats.executor } };
  const failed = observeProviderCall('{"model":"test/model"}', '{"error":{"code":429}}',
    429, 5, { role: "planner", requestId: "planner-retry" });
  const recovered = observeProviderCall('{"model":"test/model"}',
    '{"model":"test/model","provider":"CoreWeave","usage":{"cost":0.02}}',
    200, 10, { role: "planner", requestId: "planner-retry" });
  const writer = observeProviderCall('{"model":"test/model"}',
    '{"model":"test/model","provider":"CoreWeave","usage":{"cost":0.01}}',
    200, 10, { role: "writer", requestId: "writer-call" });
  const result = summarizeProviderCalls([failed, recovered, writer], shared);
  assert.deepEqual(result.providerFailures, []);
  assert.equal(result.usageByRole.planner?.calls, 2);
  assert.equal(result.usageByRole.executor?.costUsd, 0.01);
  const unserved = summarizeProviderCalls([failed, writer], shared);
  assert.match(unserved.providerFailures[0], /planner.*429/);
  assert.equal(unserved.unattributedUsage.costUsd, 0);
});
