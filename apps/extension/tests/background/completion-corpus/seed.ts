/**
 * Seed scenarios for the completion golden corpus (RFC LP-15, Phase 0).
 *
 * These hand-built scenarios exercise the kernel across contract kinds and both
 * accept and reject verdicts. A live recording run (dev flag
 * `opensidebar:recordCompletionDecisions`) will expand this corpus with real
 * traffic; the seeds guarantee coverage of the rare paths and give the replay
 * test something deterministic to anchor on before any recording exists.
 *
 * The recorded kernel status is whatever the kernel produces for the input —
 * we never hand-predict it. The golden-harness contract is byte-identical
 * *reproduction*, not a hand-authored expected verdict.
 */

import {
  buildCompletionDecisionRecord,
  computeSnapshotDigest,
  projectKernelEvidence,
  type CompletionDecisionRecord,
  type CompletionDecisionRecordInput,
} from "../../../src/background/agent/completion/decision-record";
import type { DomSnapshot, TaggedElement } from "../../../src/types";

interface SeedScenario {
  name: string;
  userRequest: string;
  summary: string;
  activeObjective?: string;
  successCriteria?: string;
  snapshot: DomSnapshot | null;
  turn: number;
}

function baseSnapshot(overrides: Partial<DomSnapshot>): DomSnapshot {
  return {
    title: "Page",
    url: "https://example.test/",
    visibleContent: "",
    pageContent: "",
    elements: [],
    viewport: { width: 1280, height: 720 },
    scroll: { x: 0, y: 0, maxY: 0, viewportHeight: 720 },
    ...overrides,
  };
}

function checkbox(
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

function textField(tag: number, label: string, value: string): TaggedElement {
  return {
    tag,
    tagName: "input",
    role: "textbox",
    text: value,
    attributes: {
      id: `field-${tag}`,
      control: `field-${tag}`,
      name: label.toLowerCase().replace(/\s+/g, "_"),
      type: "text",
      label,
      value,
    },
    rect: { x: 0, y: tag * 30, width: 200, height: 24 },
    isVisible: true,
    isDisabled: false,
  };
}

/** Diverse, valid input surfaces exercising the kernel's contract families. */
export const SEED_SCENARIOS: SeedScenario[] = [
  {
    name: "navigation-arrived",
    userRequest: "Go to the account settings page",
    summary: "Navigated to the account settings page.",
    snapshot: baseSnapshot({
      title: "Account Settings",
      url: "https://example.test/account/settings",
      visibleContent: "Account settings — manage your profile",
      pageContent: "Account settings — manage your profile",
    }),
    turn: 3,
  },
  {
    name: "quiz-selected-two-no-submit",
    userRequest: "Answer question 32 by selecting the two correct approaches",
    summary: "Selected Domain Adaptation Fine-Tuning and Continued Pre-Training.",
    snapshot: baseSnapshot({
      title: "Quiz",
      url: "https://example.test/quiz",
      visibleContent:
        "Question 32. Which approaches help adapt a foundation model? (Select two)",
      pageContent:
        "Question 32. Which approaches help adapt a foundation model? (Select two)",
      elements: [
        checkbox(158, "Domain Adaptation Fine-Tuning", true),
        checkbox(159, "Continued Pre-Training", true),
        checkbox(160, "Incremental Learning", false),
      ],
    }),
    turn: 5,
  },
  {
    name: "form-fill-partial",
    userRequest: "Fill in the shipping form with name Alex Kim and city Denver",
    summary: "Entered the name and city into the shipping form.",
    snapshot: baseSnapshot({
      title: "Shipping",
      url: "https://example.test/checkout/shipping",
      visibleContent: "Shipping details",
      pageContent: "Shipping details",
      elements: [
        textField(21, "Full name", "Alex Kim"),
        textField(22, "City", ""),
      ],
    }),
    turn: 7,
  },
  {
    name: "read-answer-summarize",
    userRequest: "What is the capital city named on this page?",
    summary: "The page states the capital city is Ottawa.",
    snapshot: baseSnapshot({
      title: "Country facts",
      url: "https://example.test/facts",
      visibleContent:
        "Canada is a country in North America. Its capital city is Ottawa.",
      pageContent:
        "Canada is a country in North America. Its capital city is Ottawa.",
    }),
    turn: 2,
  },
  {
    name: "generic-no-contract",
    userRequest: "Summarize the main points of this article for me",
    summary: "Summarized the article's three main points.",
    snapshot: baseSnapshot({
      title: "Article",
      url: "https://example.test/article",
      visibleContent:
        "The report covers three themes: cost, latency, and reliability.",
      pageContent:
        "The report covers three themes: cost, latency, and reliability.",
    }),
    turn: 4,
  },
  {
    name: "quiz-nothing-selected",
    userRequest: "Answer question 5 on the quiz",
    summary: "Reviewed question 5.",
    activeObjective: "Answer question 5",
    successCriteria: "The correct option is selected and submitted",
    snapshot: baseSnapshot({
      title: "Quiz",
      url: "https://example.test/quiz",
      visibleContent: "Question 5. Which planet is closest to the sun?",
      pageContent: "Question 5. Which planet is closest to the sun?",
      elements: [
        checkbox(40, "Mercury", false),
        checkbox(41, "Venus", false),
        checkbox(42, "Earth", false),
      ],
    }),
    turn: 6,
  },
];

function inputFor(scenario: SeedScenario): CompletionDecisionRecordInput {
  const snapshot = scenario.snapshot;
  const hasPlan = Boolean(scenario.activeObjective);
  return {
    userRequest: scenario.userRequest,
    summary: scenario.summary,
    candidateSource: "model_done",
    activeObjective: scenario.activeObjective,
    successCriteria: scenario.successCriteria,
    snapshot,
    snapshotDigest: computeSnapshotDigest(snapshot),
    evidence: projectKernelEvidence([], snapshot, scenario.turn),
    counters: {
      turnCount: scenario.turn,
      doneRejections: 0,
      consecutiveSameKindRejections: 0,
      lastContractRejectionKind: null,
    },
    planValidation: {
      hasPlan,
      planSubtaskCount: hasPlan ? 1 : 0,
      runningSubtaskIndex: hasPlan ? 0 : -1,
    },
    guardContext: {
      summary: scenario.summary,
      userRequest: scenario.userRequest,
      snapshot,
      taskContext: scenario.userRequest,
      turnCount: scenario.turn,
      isOrchestratorNode: false,
      doneRejections: 0,
      maxDoneRejections: 3,
      consecutiveSameKindRejections: 0,
      lastContractRejectionKind: null,
      planSubtaskCount: hasPlan ? 1 : 0,
      runningSubtaskIndex: hasPlan ? 0 : -1,
      selectedSkillId: null,
      hasReadPage: true,
      hasExplicitPageRead: true,
      hasTaskId: hasPlan,
      missingRequiredEvidence: [],
      activeObjective: scenario.activeObjective,
      successCriteria: scenario.successCriteria,
      listDetailReviewedCount: 0,
      listDetailOpenedCount: 0,
      listDetailVisibleActionCount: 0,
      moneyTableIncompleteScanReason: null,
      moneyTableIncorrectAnswerReason: null,
    },
    deterministicAcceptanceEnabled: true,
    isDuplicateTerminal: false,
    plannerResult: null,
  };
}

/**
 * Generate the full seed corpus. The outcome's loop-side fields (verdict/basis)
 * are derived from the kernel status here so the seed records are internally
 * consistent; a live recording run captures the true loop-side outcome.
 */
export function generateSeedCorpus(): { name: string; record: CompletionDecisionRecord }[] {
  return SEED_SCENARIOS.map((scenario) => {
    const input = inputFor(scenario);
    // Peek the kernel status to fill the loop-side outcome consistently.
    const probe = buildCompletionDecisionRecord({
      recordedAtTurn: scenario.turn,
      input,
      verdict: "accepted",
      basis: "kernel",
      contractKind: "unknown",
      guardId: null,
      reason: "",
      recoveryHint: null,
    });
    // Clean seeds trigger no legacy guard: only an explicit kernel
    // rejection/verification rejects. An inconclusive kernel (no contract)
    // falls through to the legacy_done_guards accept — matching the pipeline.
    const kernelRejects =
      probe.outcome.kernelStatus === "rejected" ||
      probe.outcome.kernelStatus === "needs_verification";
    const kernelAccepts = probe.outcome.kernelStatus === "accepted";
    const record = buildCompletionDecisionRecord({
      recordedAtTurn: scenario.turn,
      input,
      verdict: kernelRejects ? "rejected" : "accepted",
      basis: kernelRejects
        ? "kernel_reject"
        : kernelAccepts
          ? "kernel"
          : "legacy_done_guards",
      contractKind: probe.outcome.kernelContractKind,
      guardId: kernelRejects ? probe.outcome.kernelContractKind : null,
      reason: probe.outcome.kernelReason,
      recoveryHint: null,
    });
    return { name: scenario.name, record };
  });
}
