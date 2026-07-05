import { describe, expect, test } from "vitest";
import "../setup";
import {
  deriveCompletionEvidenceFromToolOutcome,
  evaluateCompletionContract,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import type { DomSnapshot } from "../../src/types";

// Repro of the secret-formula max_turns cluster (session 404d2eed).
// The planner produced a garbled read objective; the agent found the answer
// (CODE-OMEGA-42) via read_page but done() was rejected because the contract
// was classified as workflow_confirmation instead of read_answer.
const PAGE_TEXT =
  "Social Feed. Post #35: The Secret Formula for Productivity. " +
  "The answer to maximum productivity is: CODE-OMEGA-42. " +
  "Remember this code - it unlocks the productivity dashboard. " +
  "Most people overlook this simple insight about focus and deep work.";

// At done()-time the agent had scrolled; the captured snapshot's page text is
// empty (the answer-bearing post had virtualized out of the grounding text).
function emptyFeedSnapshot(): DomSnapshot {
  return {
    title: "Social Feed",
    url: "http://127.0.0.1:56673/infinite-scroll",
    visibleContent: "",
    pageContent: "",
    elements: [],
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 8405, maxY: 9102, viewportHeight: 720 },
  };
}

// Read-answer evidence accumulated earlier from a read_page that DID see the answer.
function accumulatedReadAnswerEvidence() {
  const grounded: DomSnapshot = {
    title: "Social Feed",
    url: "http://127.0.0.1:56673/infinite-scroll",
    visibleContent: PAGE_TEXT,
    pageContent: PAGE_TEXT,
    elements: [],
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 6405, maxY: 9102, viewportHeight: 720 },
  };
  return deriveCompletionEvidenceFromToolOutcome({
    toolName: "read_page",
    args: {},
    result: PAGE_TEXT,
    currentSnapshot: grounded,
    turn: 9,
  });
}

describe("read/nav completion classification repro", () => {
  const userRequest =
    "Find Post #35 'The Secret Formula for Productivity' in the feed and tell me the secret code mentioned in it.";
  const activeObjective =
    "Navigate to the secret formula for productivity and the secret formula and productivity and read the requested result there.";
  const successCriteria =
    "Page shows the secret formula for productivity and the secret formula and productivity and the requested result value.";

  test("does not degrade a read task to an unsatisfiable workflow_confirmation contract", () => {
    const snap = emptyFeedSnapshot();
    const generated = generateCompletionContract({
      userRequest,
      snapshot: snap,
      activeObjective,
      successCriteria,
    });
    // The bug: kind === "workflow_confirmation", which can never be satisfied
    // by a read task and traps the agent in a done()-rejection death spiral.
    expect(generated?.contract.kind).not.toBe("workflow_confirmation");
  });

  test("does not reject done() when read-answer evidence supports the summary", () => {
    const snap = emptyFeedSnapshot();
    const generated = generateCompletionContract({
      userRequest,
      snapshot: snap,
      activeObjective,
      successCriteria,
    });
    const evidence = accumulatedReadAnswerEvidence();
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "Found Post #35 'The Secret Formula for Productivity'. The secret code is CODE-OMEGA-42.",
    });
    expect(decision.status).not.toBe("needs_verification");
    expect(decision.status).not.toBe("rejected");
  });
});
