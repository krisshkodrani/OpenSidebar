import { describe, expect, test, vi } from "vitest";
import {
  applyJudgeGateOutcome,
  reverifyObjective,
  runHighRiskJudgeGate,
} from "../../src/background/orchestrator/high-risk-judge-gate";
import type { JudgeGateOutcome } from "../../src/background/agent/completion/judge-gate";
import type { NodeVerificationResult } from "../../src/background/orchestrator/verifier";
import type { OrchestratorTask, TaskNode } from "../../src/background/orchestrator/types";
import { ToolName } from "../../src/types";
import type { BrowserPageTab } from "../../src/background/environment/types";

vi.mock("../../src/background/memory/corpus-runtime", () => ({
  getTrustedCorpusStore: () => ({ load: async () => [] }),
}));

test.each([
  "Save a draft to alex@example.test with subject Project update and message The review is complete. Leave it unsent.",
  "Set the request amount to 740 EUR and leave its cost center unchanged.",
])("judge can resolve criteria referring to the original request: %s", async (query) => {
  const judgeGate = vi.fn().mockResolvedValue({ decision: "reroute", judged: true });
  const observation = "Saved amount: 741 EUR. Cost center: Research.";
  const node = makeNode("Save the supplied values", "The saved fields match the values in the request");
  await runHighRiskJudgeGate(
    { id: "task", query } as OrchestratorTask,
    node,
    { verifyNode: vi.fn(), judgeGate },
    [{ basis: "observation", claim: observation }],
    "Saved the requested values.",
  );
  const input = judgeGate.mock.calls[0][0];
  expect(input.claim).toContain(query);
  expect(input.claim).toContain(node.description);
  expect(input.evidence[0]).toContain(observation);
  expect(input.evidence.join("\n")).not.toContain(query);
});

test("judge sees fresh scoped tab state even in a separate final-answer node", async () => {
  const judgeGate = vi.fn().mockResolvedValue({ decision: "accept", judged: true });
  const root = { id: 51, groupId: 9, title: "Request", url: "https://app.test/request", active: true };
  const linked = { id: 52, groupId: 9, title: "Order", url: "https://app.test/order", active: false };
  let openTabs: BrowserPageTab[] = [root, linked];
  const port = { getTab: vi.fn().mockResolvedValue(root), queryTabs: vi.fn(async () => openTabs) };
  const task = { id: "task", rootTabId: 51 } as OrchestratorTask;
  const node = makeNode("Report the tracking number", "The number is reported and both tabs remain open");
  const verify = () => runHighRiskJudgeGate(task, node, { verifyNode: vi.fn(), judgeGate }, [], "Both tabs remain open", port);
  await verify();
  const first = judgeGate.mock.calls[0][0].evidence.at(-1);
  expect(port.queryTabs).toHaveBeenCalledWith({ groupId: 9 });
  expect(first).toContain('"openTabCount":2');
  expect(first).toContain("https://app.test/order");
  expect(first).not.toMatch(/groupId|tabId|"id":/);
  openTabs = [root];
  await verify();
  const second = judgeGate.mock.calls[1][0].evidence.at(-1);
  expect(second).toContain('"openTabCount":1');
  expect(second).not.toContain("https://app.test/order");
});

test("a tab lookup failure stays explicit missing evidence and still invokes the judge", async () => {
  const judgeGate = vi.fn().mockResolvedValue({ decision: "reroute", judged: true });
  const port = { getTab: vi.fn().mockRejectedValue(new Error("Tab closed")), queryTabs: vi.fn() };
  const result = await runHighRiskJudgeGate(
    { id: "task", rootTabId: 51 } as OrchestratorTask,
    makeNode("Report result"), { verifyNode: vi.fn(), judgeGate }, [], "Both tabs remain open", port,
  );
  expect(result?.decision).toBe("reroute");
  expect(judgeGate.mock.calls[0][0].evidence.at(-1)).toContain("open-tab state could not be verified");
  expect(port.queryTabs).not.toHaveBeenCalled();
});

test("ungrouped tab evidence reads only unreleased task tabs and discloses incomplete scope", async () => {
  const judgeGate = vi.fn().mockResolvedValue({ decision: "reroute", judged: true });
  const port = {
    getTab: vi.fn(async (id: number) => {
      if (id === 52) throw new Error("Unavailable");
      return { id, groupId: -1, url: "https://app.test/request" };
    }),
    queryTabs: vi.fn(),
  };
  await runHighRiskJudgeGate(
    { id: "task", rootTabId: 51, tabCoordination: { ownedTabs: [
      { tabId: 51 }, { tabId: 52 }, { tabId: 53, releasedAt: 1 },
    ] } } as OrchestratorTask,
    makeNode("Report result"), { verifyNode: vi.fn(), judgeGate }, [], "Both tabs remain open", port,
  );
  const observation = judgeGate.mock.calls[0][0].evidence.at(-1);
  expect(observation).toContain("not a complete browser or workspace inventory");
  expect(observation).toContain('"unavailableTabCount":1');
  expect(port.getTab).not.toHaveBeenCalledWith(53);
  expect(port.queryTabs).not.toHaveBeenCalled();
});

test("judge receives observed event details even when a generic claim is present", async () => {
  const judgeGate = vi.fn().mockResolvedValue({ decision: "accept", judged: true });
  const event = {
    type: "field_value_observed" as const,
    source: ToolName.READ_PAGE,
    confidence: "high" as const,
    observedAt: "2026-10-05T12:00:00Z",
    supportsTaskGoal: false,
    detail: { recordId: "REQ-17", field: "amount", value: "741", currency: "EUR" },
  };
  await runHighRiskJudgeGate(
    { id: "task" } as OrchestratorTask,
    makeNode("Save the request"),
    { verifyNode: vi.fn(), judgeGate },
    [{ claim: "field_value_observed from read_page", event }],
    "Saved amount 740 EUR.",
  );
  const evidence = judgeGate.mock.calls[0][0].evidence as string[];
  expect(evidence).toContain(JSON.stringify(event));
  expect(evidence).toContain("Saved amount 740 EUR.");
});

test("reroute judgment retains observations and separates proposed output from page evidence", async () => {
  const judgeGate = vi.fn().mockResolvedValue({ decision: "reroute", judged: true });
  const parent = {
    ...makeNode("Save request"),
    handoffArtifacts: [{ evidence: [{ basis: "observation", claim: "Other editor set cost center Research" }] }],
  } as TaskNode;
  const node = { ...makeNode("Re-verify request"), id: "n2", handoffFromNodeId: parent.id };
  await runHighRiskJudgeGate(
    { id: "task", nodes: [parent, node] } as OrchestratorTask,
    node,
    { verifyNode: vi.fn(), judgeGate },
    [{ basis: "observation", claim: "Saved request: cost center Platform" }],
    "Successfully preserved every other editor's change",
  );
  const evidence = judgeGate.mock.calls[0][0].evidence as string[];
  expect(evidence).toHaveLength(3);
  expect(evidence[0]).toContain("cost center Research");
  expect(evidence[1]).toContain("cost center Platform");
  expect(evidence[2]).toBe("Proposed final response (check its contents against observations; not independent evidence of page state):\nSuccessfully preserved every other editor's change");
});

test("final-answer judgment retains transitive prerequisite observations without unrelated nodes or cycles", async () => {
  const judgeGate = vi.fn().mockResolvedValue({ decision: "accept", judged: true });
  const observedNode = (id: string, dependencies: string[], claim: string) => ({
    ...makeNode(id), id, dependencies, status: "completed",
    handoffArtifacts: [{ evidence: [{ basis: "observation", claim }] }],
  }) as TaskNode;
  const read = observedNode("read", ["final"], "Order page: tracking ABC123");
  const save = observedNode("save", ["read"], "Request page: saved ABC123");
  const unrelated = observedNode("other", [], "Unrelated page");
  const final = { ...makeNode("Report result"), id: "final", dependencies: ["save", "read"] };
  await runHighRiskJudgeGate(
    { id: "task", nodes: [read, save, unrelated, final] } as OrchestratorTask,
    final, { verifyNode: vi.fn(), judgeGate }, [], "Tracking ABC123",
  );
  const evidence = judgeGate.mock.calls[0][0].evidence as string[];
  expect(evidence).toHaveLength(3);
  expect(evidence[0]).toContain("Order page: tracking ABC123");
  expect(evidence[1]).toContain("Request page: saved ABC123");
  expect(evidence.join("\n")).not.toContain("Unrelated page");
});

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
