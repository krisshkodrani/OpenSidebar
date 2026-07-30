import { describe, expect, it } from "vitest";
import {
  FLEET_TELEMETRY_JSON_SCHEMA,
  isFleetTelemetryEnvelopeV1,
  validateFleetTelemetryEnvelope,
} from "@observability-schema";
import {
  normalizeFleetModelId,
  projectFleetTelemetryEnvelope,
  type FleetTelemetryProjectionInput,
} from "../../src/background/telemetry";

function baseInput(
  overrides: Partial<FleetTelemetryProjectionInput> = {},
): FleetTelemetryProjectionInput {
  return {
    eventId: "00000000-0000-4000-8000-000000000001",
    extensionVersion: "0.6.0",
    extensionChannel: "dev",
    browserMajor: 138,
    osFamily: "Windows",
    providerId: "openrouter",
    executorModel: "minimax/minimax-m3",
    plannerModel: "z-ai/glm-5.2",
    judgeModel: "openai/gpt-oss-120b",
    plannerStepCount: 1,
    turnCount: 2,
    durationMs: 8_500,
    toolExecutions: [{ name: "click_element", success: true }],
    completionDecisions: [],
    evidence: [],
    outcome: "completed",
    terminalReason: "completion_accepted",
    errorCodes: [],
    ...overrides,
  };
}

describe("fleet telemetry closed contract", () => {
  it("projects a valid content-free session summary", () => {
    const envelope = projectFleetTelemetryEnvelope(
      baseInput({
        toolExecutions: [
          { name: "click_element", success: true },
          { name: "done", success: true },
        ],
        completionDecisions: [
          {
            turn: 2,
            verdict: "accepted",
            candidateSource: "model_done",
            basis: "kernel",
          },
        ],
        evidence: [
          {
            type: "media_state_changed",
            observedAtTurn: 1,
            supportsTaskGoal: true,
          },
        ],
      }),
    );

    expect(isFleetTelemetryEnvelopeV1(envelope)).toBe(true);
    expect(envelope.runtime).toEqual({
      provider: "openrouter",
      executorModel: "minimax_m3",
      plannerModel: "glm_5_2",
      judgeModel: "gpt_oss_120b",
      taskShape: "single_interaction",
    });
    expect(envelope.completion).toEqual({
      doneCallCount: 1,
      firstDoneCandidateTurn: 2,
      acceptedDoneTurn: 2,
      acceptedSource: "model_done",
      rejectedDoneCount: 0,
      rejectionReasons: [],
      evidenceTypes: ["media_state_changed"],
      firstSatisfiedEvidenceTurn: 1,
      turnsAfterFirstSatisfiedEvidence: 1,
    });
  });

  it("rejects unknown root and nested fields instead of silently stripping them", () => {
    const envelope = projectFleetTelemetryEnvelope(baseInput());
    const withForbiddenFields = {
      ...envelope,
      url: "https://private.example/account",
      completion: {
        ...envelope.completion,
        summary: "clicked Jane Doe's private video",
      },
    };

    const result = validateFleetTelemetryEnvelope(withForbiddenFields);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("$.url is not allowed");
      expect(result.errors).toContain("$.completion.summary is not allowed");
    }
  });

  it("keeps additionalProperties=false on every object schema node", () => {
    const visit = (node: unknown): void => {
      if (!node || typeof node !== "object" || Array.isArray(node)) return;
      const schema = node as Record<string, unknown>;
      if (schema.type === "object") {
        expect(schema.additionalProperties).toBe(false);
        for (const child of Object.values(
          schema.properties as Record<string, unknown>,
        )) {
          visit(child);
        }
      }
      if (schema.type === "array") visit(schema.items);
    };

    visit(FLEET_TELEMETRY_JSON_SCHEMA);
  });

  it("maps unknown strings to closed values without leaking them", () => {
    const secret = "john@example.com/private/customer/acme";
    const envelope = projectFleetTelemetryEnvelope(
      baseInput({
        providerId: secret,
        executorModel: secret,
        plannerModel: secret,
        judgeModel: secret,
        osFamily: secret,
        toolExecutions: [{ name: secret, success: false }],
        completionDecisions: [
          {
            turn: 1,
            verdict: "rejected",
            candidateSource: "model_done",
            guardId: secret,
          },
        ],
        evidence: [
          {
            type: secret,
            observedAtTurn: 1,
            supportsTaskGoal: true,
          },
        ],
        outcome: "error",
        terminalReason: secret,
        errorCodes: [secret],
      }),
    );

    expect(JSON.stringify(envelope)).not.toContain(secret);
    expect(envelope.runtime).toMatchObject({
      provider: "other",
      executorModel: "other",
      plannerModel: "other",
      judgeModel: "other",
      taskShape: "unknown",
    });
    expect(envelope.completion.rejectionReasons).toEqual(["other"]);
    expect(envelope.completion.evidenceTypes).toEqual(["none"]);
    expect(envelope.result.errorCodes).toEqual(["unknown"]);
  });

  it("bounds every numeric field and tool collection", () => {
    const toolExecutions = Array.from({ length: 1_200 }, () => ({
      name: "click_element",
      success: false,
    }));
    const envelope = projectFleetTelemetryEnvelope(
      baseInput({
        browserMajor: 10_000,
        plannerStepCount: 10_000,
        turnCount: 10_000,
        durationMs: Number.POSITIVE_INFINITY,
        toolExecutions,
      }),
    );

    expect(envelope.environment.browserMajor).toBe(999);
    expect(envelope.execution.plannerStepCount).toBe(200);
    expect(envelope.execution.turnCount).toBe(500);
    expect(envelope.execution.durationBucket).toBe("under_1s");
    expect(envelope.execution.toolCounts.click).toEqual({
      attempted: 1_000,
      failed: 1_000,
    });
    expect(validateFleetTelemetryEnvelope(envelope).valid).toBe(true);
  });

  it("rejects malformed UUIDs and arbitrary extension versions", () => {
    expect(() =>
      projectFleetTelemetryEnvelope(
        baseInput({
          eventId: "user@example.com",
          extensionVersion: "private-build-for-alice",
        }),
      ),
    ).toThrow("violated its closed schema");
  });

  it("normalizes current provider-specific aliases into stable model families", () => {
    expect(normalizeFleetModelId("minimax/minimax-m3:nitro")).toBe(
      "minimax_m3",
    );
    expect(
      normalizeFleetModelId("accounts/fireworks/models/kimi-k2p7-code"),
    ).toBe("kimi_k2_7_code");
    expect(normalizeFleetModelId("moonshotai/kimi-k2.6")).toBe("kimi_k2_6");
    expect(normalizeFleetModelId("accounts/fireworks/models/glm-5p2")).toBe(
      "glm_5_2",
    );
    expect(normalizeFleetModelId("openai/gpt-oss-120b")).toBe("gpt_oss_120b");
    expect(normalizeFleetModelId("https://custom.invalid/model/alice")).toBe(
      "other",
    );
  });
});

describe("issue #120 completion corpus projection", () => {
  it("keeps accepted, rejected-then-accepted, missing-done, max-turn, and user-stop outcomes distinct", () => {
    const accepted = projectFleetTelemetryEnvelope(
      baseInput({
        eventId: "00000000-0000-4000-8000-000000000011",
        toolExecutions: [
          { name: "click_element", success: true },
          { name: "done", success: true },
        ],
        completionDecisions: [
          {
            turn: 2,
            verdict: "accepted",
            candidateSource: "model_done",
            basis: "kernel",
          },
        ],
        evidence: [
          {
            type: "media_state_changed",
            observedAtTurn: 1,
            supportsTaskGoal: true,
          },
        ],
      }),
    );

    const rejectedThenAccepted = projectFleetTelemetryEnvelope(
      baseInput({
        eventId: "00000000-0000-4000-8000-000000000012",
        turnCount: 3,
        toolExecutions: [
          { name: "click_element", success: true },
          { name: "done", success: true },
          { name: "read_page", success: true },
          { name: "done", success: true },
        ],
        completionDecisions: [
          {
            turn: 1,
            verdict: "rejected",
            candidateSource: "model_done",
            guardId: "done_rejected_missing_evidence",
          },
          {
            turn: 3,
            verdict: "accepted",
            candidateSource: "model_done",
            basis: "kernel",
          },
        ],
        evidence: [
          {
            type: "media_state_changed",
            observedAtTurn: 2,
            supportsTaskGoal: true,
          },
        ],
      }),
    );

    const evidenceButNoDone = projectFleetTelemetryEnvelope(
      baseInput({
        eventId: "00000000-0000-4000-8000-000000000013",
        turnCount: 30,
        durationMs: 240_000,
        toolExecutions: [{ name: "click_element", success: true }],
        completionDecisions: [],
        evidence: [
          {
            type: "media_state_changed",
            observedAtTurn: 1,
            supportsTaskGoal: true,
          },
        ],
        outcome: "max_turns",
        terminalReason: "max_turns",
      }),
    );

    const maxTurnsWithoutEvidence = projectFleetTelemetryEnvelope(
      baseInput({
        eventId: "00000000-0000-4000-8000-000000000014",
        turnCount: 30,
        durationMs: 240_000,
        completionDecisions: [],
        evidence: [],
        outcome: "max_turns",
        terminalReason: "max_turns",
      }),
    );

    const userStopped = projectFleetTelemetryEnvelope(
      baseInput({
        eventId: "00000000-0000-4000-8000-000000000015",
        turnCount: 2,
        completionDecisions: [],
        evidence: [],
        outcome: "stopped",
        terminalReason: "user_stopped",
      }),
    );

    expect(accepted.completion).toMatchObject({
      doneCallCount: 1,
      acceptedSource: "model_done",
      rejectedDoneCount: 0,
    });
    expect(accepted.result).toMatchObject({
      outcome: "completed",
      terminalReason: "completion_accepted",
    });

    expect(rejectedThenAccepted.completion).toMatchObject({
      doneCallCount: 2,
      acceptedSource: "model_done",
      rejectedDoneCount: 1,
      rejectionReasons: ["missing_evidence"],
      acceptedDoneTurn: 3,
    });
    expect(rejectedThenAccepted.result.outcome).toBe("completed");

    expect(evidenceButNoDone.completion).toMatchObject({
      doneCallCount: 0,
      acceptedSource: "none",
      evidenceTypes: ["media_state_changed"],
      firstSatisfiedEvidenceTurn: 1,
      turnsAfterFirstSatisfiedEvidence: 29,
    });
    expect(evidenceButNoDone.result).toMatchObject({
      outcome: "guardrail_stopped",
      terminalReason: "max_turns",
      errorCodes: ["guardrail_exhausted"],
    });

    expect(maxTurnsWithoutEvidence.completion).toMatchObject({
      doneCallCount: 0,
      acceptedSource: "none",
      evidenceTypes: ["none"],
    });
    expect(
      maxTurnsWithoutEvidence.completion.firstSatisfiedEvidenceTurn,
    ).toBeUndefined();

    expect(userStopped.result).toMatchObject({
      outcome: "stopped",
      terminalReason: "user_stopped",
      errorCodes: [],
    });
  });
});
