import { describe, expect, test } from "vitest";
import "../setup";
import {
  CompletionEvidenceLedger,
  buildCompletionRecoveryHint,
  deriveCompletionEvidenceFromSnapshot,
  evaluateCompletionContract,
  generateCompletionContract,
} from "../../src/background/agent/completion-kernel";
import type { DomSnapshot, TaggedElement } from "../../src/types";

function choice(
  tag: number,
  label: string,
  checked: boolean,
): TaggedElement {
  return {
    tag,
    tagName: "input",
    role: "checkbox",
    text: "on",
    attributes: {
      id: `choice-${tag}`,
      control: `choice-${tag}`,
      name: "answer",
      type: "checkbox",
      checked: String(checked),
      label,
    },
    rect: { x: 0, y: tag * 20, width: 16, height: 16 },
    isVisible: true,
    isDisabled: false,
  };
}

function snapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    title: "Quiz",
    url: "https://example.test/quiz",
    visibleContent:
      "Question 32. Which approaches help adapt a foundation model? (Select two)",
    pageContent:
      "Question 32. Which approaches help adapt a foundation model? (Select two)",
    elements: [
      choice(158, "Domain Adaptation Fine-Tuning", true),
      choice(159, "Continued Pre-Training", true),
      choice(160, "Incremental Learning", false),
    ],
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    ...overrides,
  };
}

function navigationSnapshot(overrides: Partial<DomSnapshot> = {}): DomSnapshot {
  return {
    title: "Documentation",
    url: "https://docs.example.test/getting-started",
    visibleContent: "Documentation Getting started",
    pageContent: "Documentation Getting started",
    elements: [],
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    ...overrides,
  };
}

function inputField(tag: number, label: string, value = ""): TaggedElement {
  return {
    tag,
    tagName: "input",
    role: "textbox",
    text: value,
    attributes: {
      id: `field-${tag}`,
      name: label.toLowerCase().replace(/\s+/g, "-"),
      type: "text",
      label,
      value,
    },
    rect: { x: 0, y: tag * 20, width: 240, height: 32 },
    isVisible: true,
    isDisabled: false,
  };
}

function radioChoice(
  tag: number,
  label: string,
  checked = false,
): TaggedElement {
  return {
    tag,
    tagName: "input",
    role: "radio",
    text: label,
    attributes: {
      id: `radio-${tag}`,
      name: "sex",
      type: "radio",
      checked: String(checked),
      label,
    },
    rect: { x: 0, y: tag * 20, width: 16, height: 16 },
    isVisible: true,
    isDisabled: false,
  };
}

describe("completion kernel", () => {
  test("repairs stale planner quiz target to the current visible question", () => {
    const generated = generateCompletionContract({
      userRequest: "Select the correct option/s",
      activeObjective:
        "Read the current quiz question and select the correct answer(s) for Question 31",
      snapshot: snapshot(),
    });

    expect(generated?.contract).toMatchObject({
      kind: "quiz_selection",
      target: { kind: "current_visible_question", questionNumber: 32 },
      requiresSubmit: false,
      requiresCorrectFeedback: false,
      selectionCardinality: 2,
    });
    expect(generated?.notes.join("\n")).toContain("Question 31");
  });

  test("uses embedded original request instead of stale planner verification text", () => {
    const snap = snapshot();
    const generated = generateCompletionContract({
      userRequest: [
        "Objective: Complete the workflow for the original request: Select the correct option/s",
        "Read the current quiz question and select the correct answer(s) for Question 31",
        "Success criteria: The task is fully completed and verified.",
        "",
        "Original user request (reference for specific values - names, emails, codes): Select the correct option/s Stay focused on this goal.",
        "## Page Context",
        "Question 32 / 40",
      ].join("\n"),
      activeObjective:
        "Read the current quiz question and select the correct answer(s) for Question 31",
      successCriteria: "Question 31 has the correct answer options selected",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 3);
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "Selected Domain Adaptation Fine-Tuning and Continued Pre-Training.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "quiz_selection",
      target: { kind: "current_visible_question", questionNumber: 32 },
      requiresSubmit: false,
      requiresCorrectFeedback: false,
    });
    expect(generated?.notes.join("\n")).toContain("Question 31");
    expect(decision.status).toBe("accepted");
    expect(buildCompletionRecoveryHint(decision)).toContain(
      "Completion evidence indicates",
    );
  });

  test("accepts select-only quiz completion from active selected-state evidence", () => {
    const snap = snapshot();
    const generated = generateCompletionContract({
      userRequest: "Select the correct option/s",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 3);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "Selected Domain Adaptation Fine-Tuning and Continued Pre-Training.",
    });

    expect(decision.status).toBe("accepted");
    expect(decision.reason).toContain("select-only");
  });

  test("requires verification when the request asks to check the answer", () => {
    const snap = snapshot();
    const generated = generateCompletionContract({
      userRequest: "Check the answer",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 3),
      snapshot: snap,
      candidateSource: "model_done",
      summary:
        "Selected Domain Adaptation Fine-Tuning and Continued Pre-Training.",
    });

    expect(decision.status).toBe("needs_verification");
    expect(buildCompletionRecoveryHint(decision)).toContain("Check answer");
  });

  test("latest selected-state evidence wins when an option is later deselected", () => {
    const ledger = new CompletionEvidenceLedger();
    const selected = deriveCompletionEvidenceFromSnapshot(snapshot(), 5).find(
      (event) =>
        event.type === "selected_state" &&
        event.detail.label.includes("Domain Adaptation"),
    );
    const deselected = {
      ...selected!,
      observedAtTurn: 7,
      detail: { ...selected!.detail, checked: false },
    };

    expect(ledger.add(selected!)).toBe(true);
    expect(ledger.add(deselected)).toBe(true);

    expect(
      ledger
        .toArray()
        .find(
          (event) =>
            event.type === "selected_state" &&
            event.detail.label.includes("Domain Adaptation"),
        ),
    ).toMatchObject({
      observedAtTurn: 7,
      detail: { checked: false },
    });
  });

  test("same-turn stale snapshot evidence does not overwrite high-confidence tool evidence", () => {
    const ledger = new CompletionEvidenceLedger();
    const staleSnapshotEvidence = deriveCompletionEvidenceFromSnapshot(
      snapshot({
        elements: [
          choice(158, "Domain Adaptation Fine-Tuning", false),
          choice(159, "Continued Pre-Training", false),
        ],
      }),
      6,
    ).find(
      (event) =>
        event.type === "selected_state" &&
        event.detail.label.includes("Domain Adaptation"),
    );
    const toolEvidence = {
      ...staleSnapshotEvidence!,
      confidence: "high" as const,
      detail: { ...staleSnapshotEvidence!.detail, checked: true },
    };

    expect(ledger.add(toolEvidence)).toBe(true);
    expect(ledger.add(staleSnapshotEvidence!)).toBe(false);

    expect(
      ledger
        .toArray()
        .find(
          (event) =>
            event.type === "selected_state" &&
            event.detail.label.includes("Domain Adaptation"),
        ),
    ).toMatchObject({
      confidence: "high",
      detail: { checked: true },
    });
  });

  test("accepts explicit-url navigation completion from current URL evidence", () => {
    const snap = navigationSnapshot();
    const generated = generateCompletionContract({
      userRequest: "Open https://docs.example.test/getting-started",
      snapshot: snap,
    });
    const evidence = deriveCompletionEvidenceFromSnapshot(snap, 7);

    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence,
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Opened https://docs.example.test/getting-started.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "navigation",
      targetUrl: "https://docs.example.test/getting-started",
      targetHost: "docs.example.test",
    });
    expect(decision.status).toBe("accepted");
    expect(decision.reason).toContain("current URL");
    expect(buildCompletionRecoveryHint(decision)).toContain(
      "requested page is already open",
    );
  });

  test("rejects explicit-url navigation completion on the wrong host", () => {
    const snap = navigationSnapshot({
      url: "https://other.example.test/getting-started",
      title: "Other docs",
    });
    const generated = generateCompletionContract({
      userRequest: "Navigate to docs.example.test/getting-started",
      snapshot: snap,
    });
    const decision = evaluateCompletionContract({
      contract: generated?.contract,
      evidence: deriveCompletionEvidenceFromSnapshot(snap, 8),
      snapshot: snap,
      candidateSource: "model_done",
      summary: "Opened the docs page.",
    });

    expect(generated?.contract).toMatchObject({
      kind: "navigation",
      targetHost: "docs.example.test",
    });
    expect(decision.status).toBe("rejected");
    expect(decision.reason).toContain("does not match requested host");
  });

  test("does not treat an email domain as a navigation target", () => {
    const generated = generateCompletionContract({
      userRequest:
        "Open the cart and checkout as Alex Morgan (alex.morgan@example.com).",
      snapshot: navigationSnapshot({
        url: "https://shop.example.test/cart",
        title: "Shop cart",
        visibleContent: "Your Cart Checkout",
        pageContent: "Your Cart Checkout",
      }),
    });

    expect(generated?.contract.kind).not.toBe("navigation");
  });

  test("does not infer quiz or form completion for a page-state search-results node", () => {
    const generated = generateCompletionContract({
      userRequest: [
        "Objective: Search for homes in zip code 85747.",
        "Selected workflow skill:",
        "- search-answer-extraction: Read result snippets and choose the result that answers the request.",
        "Original user request: Find listings in 85747 with pool/private outdoor space.",
      ].join("\n"),
      activeObjective: "Search for homes in zip code 85747",
      successCriteria:
        "Search results page shows 85747 in the search field or page heading, and listings load.",
      snapshot: navigationSnapshot({
        title: "85747 Homes for Sale",
        url: "https://www.example-realestate.test/search/85747",
        visibleContent:
          "85747 Homes for Sale Pool Private outdoor space Save search",
        pageContent:
          "85747 Homes for Sale Pool Private outdoor space Save search",
        elements: [
          inputField(21, "Search", "85747"),
          choice(22, "Pool", false),
          choice(23, "Private outdoor space", false),
        ],
      }),
    });

    expect(generated?.contract.kind).not.toBe("quiz_selection");
    expect(generated?.contract.kind).not.toBe("form_fill");
  });

  test("does not infer quiz completion from calculator radio controls on an open-page node", () => {
    const generated = generateCompletionContract({
      userRequest:
        "Find and open the BabyCenter child growth percentile calculator.",
      activeObjective: "Find and open the child growth percentile calculator",
      successCriteria:
        "The calculator page is loaded and input fields are visible.",
      snapshot: navigationSnapshot({
        title: "Child Growth Percentile Calculator",
        url: "https://www.example-parenting.test/child-growth-percentile-calculator",
        visibleContent:
          "Child growth percentile calculator Sex Boy Girl Age Height Weight",
        pageContent:
          "Child growth percentile calculator Sex Boy Girl Age Height Weight",
        elements: [
          radioChoice(31, "Boy"),
          radioChoice(32, "Girl"),
          inputField(33, "Age"),
          inputField(34, "Height"),
          inputField(35, "Weight"),
        ],
      }),
    });

    expect(generated?.contract.kind).not.toBe("quiz_selection");
    expect(generated?.contract.kind).not.toBe("form_fill");
  });

  test("does not infer form completion for search-results page verification", () => {
    const generated = generateCompletionContract({
      userRequest: "Find the next available date for Albion Basin.",
      activeObjective: "Search for Albion Basin availability",
      successCriteria:
        "Search results page displays Albion Basin and available-date content.",
      snapshot: navigationSnapshot({
        title: "Search results",
        url: "https://www.example-parks.test/search?q=Albion%20Basin",
        visibleContent:
          "Search results for Albion Basin Please enter a destination Next available date",
        pageContent:
          "Search results for Albion Basin Please enter a destination Next available date",
        elements: [
          inputField(41, "Search", "Albion Basin"),
          inputField(42, "Destination"),
        ],
      }),
    });

    expect(generated?.contract.kind).not.toBe("form_fill");
    expect(generated?.contract.kind).not.toBe("quiz_selection");
  });
});
