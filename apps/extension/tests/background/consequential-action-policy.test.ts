import { describe, expect, test } from "vitest";
import {
  assessConsequentialActionApproval,
  assessConsequentialFinalActionBlock,
  assessDraftOnlyCompletionViolation,
  classifyConsequentialActionConsentMode,
  isDraftOnlyCommunicationTask,
} from "../../src/background/agent/consequential-action-policy";
import { ToolName } from "../../src/types";

describe("consequential action policy", () => {
  test("requires approval for job application final submit clicks", () => {
    expect(
      assessConsequentialActionApproval({
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: "submit-application" },
        taskText: "Fill the job application for the frontend position.",
        actionLabel: "Click Submit application",
      }),
    ).toEqual({
      requiresApproval: true,
      kind: "job_application_submit",
      consentMode: "unclear",
    });
  });

  test("does not require approval for ordinary non-job clicks", () => {
    expect(
      assessConsequentialActionApproval({
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: "submit-search" },
        taskText: "Search the documentation for adapter examples.",
        actionLabel: "Click Submit search",
      }),
    ).toEqual({
      requiresApproval: false,
      kind: null,
      consentMode: "unclear",
    });
  });

  test("classifies prepare-only final-action requests", () => {
    expect(
      classifyConsequentialActionConsentMode(
        "Fill the application but do not submit it until I approve.",
      ),
    ).toBe("prepare_only");
  });

  test("classifies dont-send final-action requests", () => {
    expect(
      classifyConsequentialActionConsentMode(
        "Draft the reply in the editor but dont send it.",
      ),
    ).toBe("prepare_only");
  });

  test("classifies review-first message copy as prepare-only", () => {
    const taskText =
      "Create a message in german to say that I am sorry for not answering before and that I am currently looking for a job in my profession. Let me review the copy first.";

    expect(isDraftOnlyCommunicationTask(taskText)).toBe(true);
    expect(classifyConsequentialActionConsentMode(taskText)).toBe(
      "prepare_only",
    );
  });

  test("classifies explicit final-action requests", () => {
    expect(
      classifyConsequentialActionConsentMode(
        "Complete the form and submit it when everything is ready.",
      ),
    ).toBe("explicit_go");
  });

  test("classifies unclear final-action policy", () => {
    expect(
      classifyConsequentialActionConsentMode(
        "Review the page and prepare the next step.",
      ),
    ).toBe("unclear");
  });

  test("blocks send clicks for draft-only communication tasks", () => {
    const result = assessConsequentialFinalActionBlock({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 42 },
      taskText:
        "Read David's email and draft a short reply in the reply box. Don't click send.",
      actionLabel: 'Click [42] button "Send"',
    });

    expect(result).toContain("draft-only");
  });

  test("blocks send clicks for plain draft communication tasks", () => {
    const result = assessConsequentialFinalActionBlock({
      toolName: ToolName.CLICK_ELEMENT,
      args: { id: 42 },
      taskText: "Draft a reply to David about Monday at 11 AM.",
      actionLabel: 'Click [42] button "Send"',
    });

    expect(result).toContain("draft-only");
  });

  test("allows send clicks when sending is the explicit communication goal", () => {
    expect(
      assessConsequentialFinalActionBlock({
        toolName: ToolName.CLICK_ELEMENT,
        args: { id: 42 },
        taskText: "Read David's email and send a short reply confirming Monday.",
        actionLabel: 'Click [42] button "Send"',
      }),
    ).toBeNull();
  });

  test("rejects done when a draft-only message was sent", () => {
    const result = assessDraftOnlyCompletionViolation({
      taskText: "Draft a reply to David and do not send it.",
      summary: "The message was sent to David.",
      snapshot: {
        title: "Sent",
        url: "https://mail.example/sent",
        elements: [],
        pageContent: "Message sent to David <david@example.com>. Sent just now.",
      },
    });

    expect(result).toContain("required an unsent draft");
  });

  test("accepts done when a draft-only message remains unsent", () => {
    expect(
      assessDraftOnlyCompletionViolation({
        taskText: "Draft a reply to David and do not send it.",
        summary: "The reply remains unsent as a draft in the editor.",
        snapshot: {
          title: "Inbox",
          url: "https://mail.example/inbox",
          elements: [],
          pageContent: "Reply editor. Send button. Drafts 1.",
        },
      }),
    ).toBeNull();
  });
});
