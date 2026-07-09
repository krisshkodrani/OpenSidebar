import { describe, expect, test } from "vitest";
import "../setup";
import { assessGroundingGuard } from "../../src/background/agent/completion/guards/grounding-guards";
import type { CompletionGuardContext } from "../../src/background/agent/completion/guards/context";
import type { DomSnapshot } from "../../src/types";

/** A substantive messaging page: enough elements + page content that its text
 * is already in the model's prompt. */
function substantiveComposerSnapshot(): DomSnapshot {
  const content =
    "Conversation with David Park. Reply composer is open with the drafted apology message ready for review before sending it to the recipient.";
  return {
    url: "http://localhost/messaging",
    title: "Messaging",
    visibleContent: content,
    pageContent: content,
    elements: Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      tagName: "div",
      role: "generic",
      text: `element ${i + 1}`,
      attributes: {},
      isVisible: true,
      isDisabled: false,
    })),
  } as unknown as DomSnapshot;
}

function baseCtx(
  overrides: Partial<CompletionGuardContext>,
): CompletionGuardContext {
  return {
    summary:
      "Drafted the German apology reply in the composer and left it unsent for review.",
    userRequest: "Draft a German apology in the composer. Do not send it.",
    snapshot: substantiveComposerSnapshot(),
    hasReadPage: false,
    hasExplicitPageRead: false,
    hasTaskId: true,
    turnCount: 3,
    doneRejections: 0,
    maxDoneRejections: 8,
    consecutiveSameKindRejections: 0,
    lastContractRejectionKind: null,
    planSubtaskCount: 1,
    runningSubtaskIndex: 0,
    selectedSkillId: null,
    isOrchestratorNode: true,
    missingRequiredEvidence: [],
    listDetailReviewedCount: 0,
    listDetailOpenedCount: 0,
    listDetailVisibleActionCount: 0,
    moneyTableIncompleteScanReason: null,
    moneyTableIncorrectAnswerReason: null,
    ...overrides,
  } as CompletionGuardContext;
}

describe("assessGroundingGuard task-intent source", () => {
  test("classifies from the clean node objective, not a composed prompt that merely mentions 'summarize'", () => {
    // The orchestrator's composed node prompt embeds skill boilerplate whose
    // incidental "summarize"/"read the page" phrasing would false-positive the
    // summarize-task heuristic if classified verbatim.
    const composedPrompt = [
      "Objective: Draft the requested German apology message in the composer and leave it unsent for review.",
      "Selected workflow skill:",
      "- email-reply-careful: Read the email, then draft or send. Re-read or summarize the draft before sending; read the page to verify.",
      "Original user request: Draft a German apology in the composer. Do not send it.",
    ].join("\n");

    const ctx = baseCtx({
      userRequest: composedPrompt,
      activeObjective:
        "Draft the requested German apology message in the composer and leave it unsent for review.",
    });

    // Compose/action task with a substantive page → grounding is satisfied and
    // the guard passes, letting the completion kernel's own contract adjudicate.
    expect(assessGroundingGuard(ctx).kind).toBe("pass");
  });

  test("extracts the Objective section when activeObjective is absent (merged single-node form submit)", () => {
    // Form-submit runs as a merged node whose plan subtask does not reach the
    // loop, so activeObjective is empty — the fix must still classify from the
    // composed prompt's `Objective:` line, not the boilerplate that mentions
    // "summarize".
    const composedPrompt = [
      "Objective: Complete the workflow for the original request: Submit the partner registration for Sam Rivera, and accept the partner terms.",
      "Success criteria: The created record or confirmation is visible.",
      "",
      "Selected workflow skill:",
      "- structured-form-fill: Read the form, then summarize the fields before submitting.",
    ].join("\n");

    const ctx = baseCtx({
      activeObjective: undefined,
      userRequest: composedPrompt,
      summary: "Submitted the partner registration for Sam Rivera.",
      // A substantive form snapshot (values typed in): grounding satisfied for a
      // non-summarize task, so the completion kernel's confirmation contract —
      // not the grounding guard — adjudicates the premature done.
    });

    expect(assessGroundingGuard(ctx).kind).toBe("pass");
  });

  test("still requires grounding when the objective itself is a summarize task", () => {
    const ctx = baseCtx({
      activeObjective: "Read this page and summarize the main points.",
      summary: "This page is about something.",
      hasReadPage: false,
      hasExplicitPageRead: false,
    });
    expect(assessGroundingGuard(ctx).kind).toBe("reject");
  });
});
