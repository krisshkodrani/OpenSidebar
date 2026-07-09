import { describe, expect, test } from "vitest";
import {
  applyJudgeGateOutcome,
  reverifyObjective,
} from "../../src/background/orchestrator/high-risk-judge-gate";
import type { JudgeGateOutcome } from "../../src/background/agent/completion/judge-gate";
import type { NodeVerificationResult } from "../../src/background/orchestrator/verifier";
import type { TaskNode } from "../../src/background/orchestrator/types";

function makeNode(description: string): TaskNode {
  return { id: "n1", description } as TaskNode;
}

function makeVerification(): NodeVerificationResult {
  return {
    decision: "accept",
    reason: "verifier accepted",
    confidence: 0.9,
  } as NodeVerificationResult;
}

describe("reverifyObjective", () => {
  test("prepends the prefix once", () => {
    expect(reverifyObjective("Submit the form")).toBe(
      "Re-verify and complete: Submit the form",
    );
  });

  test("does not stack on an already-rerouted description", () => {
    const once = reverifyObjective("Submit the form");
    expect(reverifyObjective(once)).toBe(once);
    // Repairs historical stacking too.
    expect(
      reverifyObjective(
        "Re-verify and complete: Re-verify and complete: Submit the form",
      ),
    ).toBe("Re-verify and complete: Submit the form");
  });
});

describe("applyJudgeGateOutcome", () => {
  test("null gate: no events, verification untouched", () => {
    const verification = makeVerification();
    const events: Array<[string, Record<string, unknown>]> = [];
    applyJudgeGateOutcome({
      gate: null,
      node: makeNode("x"),
      verification,
      emit: (type, data) => events.push([type, data]),
    });
    expect(events).toEqual([]);
    expect(verification.decision).toBe("accept");
  });

  test("accept gate: judge_call telemetry only, accept stands", () => {
    const verification = makeVerification();
    const events: Array<[string, Record<string, unknown>]> = [];
    const gate: JudgeGateOutcome = {
      decision: "accept",
      reason: "Verification judge was unavailable; verifier accept stands.",
      judged: true,
      verdict: {
        pass: false,
        perCriterion: [],
        entailment: [],
        confidence: 0,
        source: "fail_open",
        failureCause: "timeout",
        durationMs: 15001,
      },
    };
    applyJudgeGateOutcome({
      gate,
      node: makeNode("Submit the form"),
      verification,
      emit: (type, data) => events.push([type, data]),
    });
    expect(events.map(([type]) => type)).toEqual(["judge_call"]);
    expect(events[0][1]).toMatchObject({
      nodeId: "n1",
      decision: "accept",
      verdictSource: "fail_open",
      failureCause: "timeout",
      durationMs: 15001,
    });
    expect(verification.decision).toBe("accept");
  });

  test("reroute gate: verification downgraded, objective prefix does not stack, both events emitted", () => {
    const verification = makeVerification();
    const events: Array<[string, Record<string, unknown>]> = [];
    const gate: JudgeGateOutcome = {
      decision: "reroute",
      reason: "Verification judge did not confirm the task outcome.",
      judged: true,
      verdict: {
        pass: false,
        perCriterion: [],
        entailment: [],
        confidence: 0.8,
        source: "judge",
        model: "glm-5p2",
      },
    };
    applyJudgeGateOutcome({
      gate,
      node: makeNode("Re-verify and complete: Submit the form"),
      verification,
      emit: (type, data) => events.push([type, data]),
    });
    expect(verification.decision).toBe("reroute");
    expect(verification.reason).toBe(gate.reason);
    expect(verification.rerouteObjective).toBe(
      "Re-verify and complete: Submit the form",
    );
    expect(events.map(([type]) => type)).toEqual([
      "judge_call",
      "judge_gate_reroute",
    ]);
  });
});
