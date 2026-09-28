import assert from "node:assert/strict";
import test from "node:test";
import { aggregate } from "./cache-report.mjs";

function turn(sessionId: string, turnNumber: number) {
  return {
    sessionId,
    turnNumber,
    llmRequest: { modelTier: "executor", model: "accounts/fireworks/models/kimi-k2p7-code" },
    llmResponse: {
      actualProviderId: "fireworks",
      actualModel: "accounts/fireworks/models/kimi-k2p7-code",
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
    },
  };
}

test("cache report weighs task success by session, not by turn count", () => {
  const turns = [turn("completed", 1), turn("completed", 2), turn("completed", 3), turn("failed", 1)];
  const sessions = new Map([
    ["completed", { outcome: "completed" }],
    ["failed", { outcome: "failed" }],
  ]);

  const [group] = aggregate(turns, sessions);
  assert.equal(group.runs, 2);
  assert.equal(group.warmTurns, 2);
  assert.deepEqual(group.outcomes, { completed: 1, failed: 1 });
  assert.equal(group.taskSuccessPct, 50);
  assert.equal(group.verdictEligible, false);
  assert.equal(aggregate(turns, sessions, 2)[0].verdictEligible, true);
});
