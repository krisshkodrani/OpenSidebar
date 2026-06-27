import { describe, expect, it } from "vitest";

import { buildRlTrajectory } from "./rl-trajectory";
import type {
  TraceEntry,
  TraceSession,
} from "../../apps/extension/src/types/traces";

const session = {
  sessionId: "s1",
  startTime: 1000,
  endTime: 2000,
  query: "read the page",
  startUrl: "https://ex.com",
  outcome: "completed",
  turnCount: 1,
  summary: "done",
  metrics: null,
} as unknown as TraceSession;

const entries = [
  {
    sessionId: "s1",
    turnNumber: 1,
    timestamp: 1000,
    snapshot: {
      url: "https://ex.com",
      title: "Ex",
      elementCount: 5,
      visibleContentLength: 100,
      scrollY: 0,
    },
    elements: [],
    llmRequest: {
      model: "model-a",
      modelTier: "executor",
      messageCount: 2,
      toolCount: 1,
      compressionLevel: "NONE",
    },
    llmResponse: {
      content: "read it",
      toolCalls: [],
      finishReason: "stop",
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      durationMs: 50,
    },
    toolExecutions: [
      {
        toolCallId: "t1",
        toolName: "read_page",
        args: {},
        result: "ok",
        success: true,
        durationMs: 10,
        riskLevel: "LOW",
      },
    ],
    events: [],
    progressState: { stagnantTurns: 0, signal: null },
    perception: {
      interpretation: "a simple page",
      model: "vlm",
      durationMs: 20,
      cached: false,
      screenshotPath: "/s/s1-T1.jpg",
    },
  },
] as unknown as TraceEntry[];

describe("buildRlTrajectory", () => {
  const trajectory = buildRlTrajectory(session, entries);

  it("grades a terminal reward in 1..5 with a verdict and rubric tag", () => {
    expect(trajectory.reward).toBeGreaterThanOrEqual(1);
    expect(trajectory.reward).toBeLessThanOrEqual(5);
    expect(["pass", "non_fail", "fail"]).toContain(trajectory.verdict);
    expect(trajectory.rubric).toBe("openclaw-1-5-grade-to-lowest");
    expect(trajectory.sessionId).toBe("s1");
  });

  it("emits one (state, action, reward) step per turn", () => {
    expect(trajectory.steps).toHaveLength(1);
    const step = trajectory.steps[0];
    expect(step.action.tools.map((t) => t.name)).toContain("read_page");
    expect(step.state.url).toBe("https://ex.com");
    expect(step.state.perception).toBe("a simple page");
    expect(typeof step.reward).toBe("number");
  });

  it("carries blob refs derived from the span mapper into the state", () => {
    expect(trajectory.steps[0].state.blobs.length).toBeGreaterThan(0);
  });
});
