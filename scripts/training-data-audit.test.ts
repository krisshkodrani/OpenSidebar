import assert from "node:assert/strict";
import test from "node:test";
import { candidateFromTurn } from "./training-data/audit.js";

function turn(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "session-1",
    turnNumber: 2,
    snapshot: { url: "https://example.test/orders" },
    llmRequest: {
      model: "example-model",
      modelTier: "executor",
      messages: [{ role: "user", content: "Open the first order" }],
    },
    llmResponse: {
      content: null,
      finishReason: "tool_calls",
      usage: { prompt_tokens: 100, completion_tokens: 20 },
      toolCalls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "click", arguments: '{"id":1}' },
        },
      ],
    },
    toolExecutions: [{ toolName: "click", success: true }],
    ...overrides,
  };
}

test("builds a clean executor candidate from a verified completed turn", () => {
  const candidate = candidateFromTurn(turn(), "completed");
  assert.ok(candidate);
  assert.equal(candidate.role, "executor");
  assert.equal(candidate.domain, "example.test");
  assert.equal(candidate.score, 11);
  assert.deepEqual(candidate.warnings, []);
  assert.deepEqual(candidate.targetToolNames, ["click"]);
});

test("labels planner-tier turns as executor escalations", () => {
  const candidate = candidateFromTurn(
    turn({
      llmRequest: {
        model: "strong-model",
        modelTier: "planner",
        messages: [{ role: "user", content: "Recover from this page" }],
      },
    }),
    "success",
  );
  assert.ok(candidate);
  assert.equal(candidate.role, "planner-tier-executor");
  assert.ok(
    candidate.warnings.includes("planner_tier_is_not_orchestrator_planner"),
  );
});

test("rejects malformed tool arguments and truncated responses", () => {
  const malformed = turn();
  (
    malformed.llmResponse.toolCalls[0].function as { arguments: string }
  ).arguments = "{";
  assert.equal(candidateFromTurn(malformed, "success"), null);

  assert.equal(
    candidateFromTurn(
      turn({
        llmResponse: {
          content: "unfinished",
          finishReason: "length",
          usage: { prompt_tokens: 10, completion_tokens: 10 },
          toolCalls: [],
        },
      }),
      "success",
    ),
    null,
  );
});

test("flags flattened image inputs", () => {
  const candidate = candidateFromTurn(
    turn({
      llmRequest: {
        model: "vision-model",
        messages: [{ role: "user", content: "Page image: [image]" }],
      },
    }),
    "success",
  );
  assert.ok(candidate);
  assert.ok(candidate.warnings.includes("flattened_image_input"));
});

test("excludes removed ServiceNow workflows from review", () => {
  const candidate = candidateFromTurn(
    turn({ snapshot: { url: "https://example.service-now.com/incident" } }),
    "completed",
  );
  assert.ok(candidate);
  assert.ok(candidate.warnings.includes("removed_servicenow_workflow"));
  const genericPageWithLegacyPrompt = candidateFromTurn(
    turn({
      llmRequest: {
        model: "example-model",
        messages: [
          { role: "system", content: "Tools: configure_servicenow_form" },
          { role: "user", content: "Open an order" },
        ],
      },
    }),
    "completed",
  );
  assert.ok(genericPageWithLegacyPrompt);
  assert.ok(
    genericPageWithLegacyPrompt.warnings.includes("removed_servicenow_workflow"),
  );
});
