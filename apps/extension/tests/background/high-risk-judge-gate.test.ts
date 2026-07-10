import { describe, expect, test } from "vitest";
import {
  applyJudgeGateOutcome,
  reverifyObjective,
} from "../../src/background/orchestrator/high-risk-judge-gate";
import type { JudgeGateOutcome } from "../../src/background/agent/completion/judge-gate";
import type { NodeVerificationResult } from "../../src/background/orchestrator/verifier";
import type { TaskNode } from "../../src/background/orchestrator/types";

function makeNode(
  description: string,
  successCriteria = "The form is submitted; a confirmation is shown",
): TaskNode {
  return { id: "n1", description, successCriteria } as TaskNode;
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

  test("judge_call carries the derived criteria, per-criterion rulings, entailment, and usage", () => {
    const verification = makeVerification();
    const events: Array<[string, Record<string, unknown>]> = [];
    const longRationale = "x".repeat(400);
    const gate: JudgeGateOutcome = {
      decision: "reroute",
      reason: "Verification judge did not confirm the task outcome.",
      judged: true,
      verdict: {
        pass: false,
        perCriterion: [
          { id: "c1", pass: false, rationale: longRationale },
          { id: "c2", pass: true },
        ],
        entailment: [{ claimKey: "fact:x", label: "contradicted" }],
        confidence: 0.82,
        source: "judge",
        model: "gpt-oss-120b",
        providerId: "fireworks",
        usage: { promptTokens: 500, completionTokens: 90, totalTokens: 590, costUsd: 0.0005 },
      },
    };
    applyJudgeGateOutcome({
      gate,
      node: makeNode("Submit the form", "The form is submitted; a confirmation is shown"),
      verification,
      emit: (type, data) => events.push([type, data]),
    });
    const payload = events[0][1];
    // Two clauses split from successCriteria → two criteria with descriptions.
    expect(payload.criteria).toEqual([
      { id: "c1", description: "The form is submitted", required: true },
      { id: "c2", description: "a confirmation is shown", required: true },
    ]);
    const perCriterion = payload.perCriterion as Array<{ id: string; pass: boolean; rationale?: string }>;
    expect(perCriterion[0]).toMatchObject({ id: "c1", pass: false });
    expect(perCriterion[0].rationale?.length).toBe(240); // truncated
    expect(payload.entailment).toEqual([{ claimKey: "fact:x", label: "contradicted" }]);
    expect(payload.providerId).toBe("fireworks");
    expect(payload.usage).toMatchObject({ totalTokens: 590, costUsd: 0.0005 });
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
