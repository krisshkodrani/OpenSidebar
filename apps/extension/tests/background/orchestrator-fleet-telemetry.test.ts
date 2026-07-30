import { describe, expect, test } from "vitest";
import { projectFleetTelemetryEnvelope } from "../../src/background/telemetry";
import {
  buildTaskFleetTelemetryProjectionInput,
  createTaskFleetTelemetryState,
  recordTaskFleetLoopResult,
} from "../../src/background/orchestrator/fleet-telemetry";

describe("orchestrator fleet telemetry terminal adapter", () => {
  test("keeps only closed terminal facts and does not retain task text", () => {
    const secret = "Click Jane Doe's private YouTube video at https://example.test";
    const state = createTaskFleetTelemetryState({
      providerMode: "fireworks-deepseek",
      executorModel: "z-ai/glm-5.2",
      plannerModel: "qwen/qwen3.7-plus",
    });
    recordTaskFleetLoopResult(state, {
      outcome: "completed",
      turnCount: 2,
      completionEnvelope: {
        resultId: "result-1",
        source: "model_done",
        contractKind: "generic",
        decisionReason: secret,
        evidenceKeys: [],
      },
      evidence: [
        {
          type: "answer_extracted",
          source: "click",
          confidence: "high",
        },
      ],
    });

    const input = buildTaskFleetTelemetryProjectionInput({
      task: {
        nodes: [{ id: "node-1" }],
        createdAt: 100,
        startedAt: 200,
        finishedAt: 1_200,
        terminationReason: secret,
      } as never,
      state,
      runtime: {
        eventId: "00000000-0000-4000-8000-000000000099",
        extensionVersion: "0.6.0",
        extensionChannel: "dev",
        browserMajor: 140,
        osFamily: "windows",
      },
      completionStatus: "completed",
    });
    const envelope = projectFleetTelemetryEnvelope(input);

    expect(envelope).toMatchObject({
      runtime: {
        provider: "fireworks",
        executorModel: "glm_5_2",
        plannerModel: "qwen_3_7",
      },
      execution: { plannerStepCount: 1, turnCount: 2 },
      completion: {
        acceptedSource: "model_done",
        evidenceTypes: ["target_state_observed"],
      },
    });
    expect(JSON.stringify(envelope)).not.toContain(secret);
  });

  test("represents stopped tasks without treating them as successful", () => {
    const input = buildTaskFleetTelemetryProjectionInput({
      task: { nodes: [], createdAt: 100, terminationReason: "Stopped by user" } as never,
      state: createTaskFleetTelemetryState(),
      runtime: {
        eventId: "00000000-0000-4000-8000-000000000100",
        extensionVersion: "0.6.0",
        extensionChannel: "dev",
        browserMajor: 140,
        osFamily: "windows",
      },
      completionStatus: "stopped",
    });
    const envelope = projectFleetTelemetryEnvelope(input);

    expect(envelope.result).toEqual({
      outcome: "stopped",
      terminalReason: "user_stopped",
      errorCodes: ["user_abort"],
    });
  });
});
