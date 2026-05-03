import { describe, expect, test } from "vitest";
import {
  buildHallucinationRetryMessage,
  buildTurnRetryStep,
  getTurnRetryBackoffMs,
  removeTurnRetryDiagnosticMessages,
  TURN_RETRY_DIAGNOSTIC_PREFIX,
} from "../../src/background/agent/turn-retry";
import { LLMMessage } from "../../src/background/llm/types";

describe("turn retry helpers", () => {
  test("builds retry timeline steps", () => {
    expect(
      buildTurnRetryStep({ retryCount: 1, maxRetries: 2 }).label,
    ).toBe("Retrying (1/2)...");

    expect(
      buildTurnRetryStep({
        retryCount: 2,
        maxRetries: 2,
        fallbackModel: "fallback-model",
      }).label,
    ).toBe("Retrying with fallback model (2/2)...");
  });

  test("resolves retry backoff with fallback", () => {
    expect(getTurnRetryBackoffMs(1, [0, 500])).toBe(0);
    expect(getTurnRetryBackoffMs(3, [0, 500])).toBe(500);
  });

  test("builds and removes retry diagnostic messages", () => {
    const diagnostic = buildHallucinationRetryMessage();
    const messages: LLMMessage[] = [
      { role: "system", content: "System" },
      diagnostic,
      { role: "user", content: "Keep me" },
      { role: "user", content: `${TURN_RETRY_DIAGNOSTIC_PREFIX} stale` },
    ];

    expect(diagnostic.content).toContain("tool_calls API");
    expect(removeTurnRetryDiagnosticMessages(messages)).toEqual([
      { role: "system", content: "System" },
      { role: "user", content: "Keep me" },
    ]);
  });
});
