import assert from "node:assert/strict";
import test from "node:test";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { createIngestHandler } from "../src/ingest-policy.ts";

const valid = {
  schemaVersion: 1,
  eventId: "00000000-0000-4000-8000-000000000001",
  extension: { version: "0.6.0", channel: "dev" },
  environment: { browserMajor: 140, osFamily: "linux" },
  runtime: {
    provider: "fireworks",
    executorModel: "other",
    plannerModel: "other",
    judgeModel: "other",
    taskShape: "single_interaction",
  },
  execution: {
    plannerStepCount: 0,
    turnCount: 1,
    durationBucket: "under_1s",
    toolCounts: {},
  },
  completion: {
    doneCallCount: 0,
    acceptedSource: "none",
    rejectedDoneCount: 0,
    rejectionReasons: [],
    evidenceTypes: ["none"],
  },
  result: {
    outcome: "failed",
    terminalReason: "error",
    errorCodes: ["unknown"],
  },
};

function event(body: unknown): APIGatewayProxyEventV2 {
  return {
    requestContext: { http: { method: "POST" } },
    headers: {},
    body: JSON.stringify(body),
    isBase64Encoded: false,
  } as APIGatewayProxyEventV2;
}

test("rejects malformed and unknown-field payloads before Firehose", async () => {
  const put = async () => assert.fail("Firehose must not be called");
  const handler = createIngestHandler({ put });

  assert.equal((await handler(event({ nope: true }))).statusCode, 400);
  assert.equal(
    (await handler(event({ ...valid, unexpected: "value" }))).statusCode,
    400,
  );
});

test("accepts only a schema-valid summary and forwards no extra fields", async () => {
  let forwarded: unknown;
  const handler = createIngestHandler({
    put: async (record) => {
      forwarded = record;
    },
  });
  const result = await handler(event(valid));

  assert.equal(result.statusCode, 202);
  assert.deepEqual(forwarded, valid);
});

test("rejects oversized bodies before parsing", async () => {
  const handler = createIngestHandler({
    put: async () => assert.fail("Firehose must not be called"),
  });
  const result = await handler(event("x".repeat(40_000)));
  assert.equal(result.statusCode, 413);
});

test("rejects compressed requests and hides downstream failures", async () => {
  const handler = createIngestHandler({
    put: async () => {
      throw new Error("provider details must not escape");
    },
  });
  const compressed = await handler({
    ...event(valid),
    headers: { "Content-Encoding": "gzip" },
  });
  assert.equal(compressed.statusCode, 415);

  const unavailable = await handler(event(valid));
  assert.equal(unavailable.statusCode, 503);
  assert.equal(unavailable.body, '{"error":"temporarily_unavailable"}');
});
