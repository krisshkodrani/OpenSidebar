import { describe, expect, test } from "vitest";
import {
  assessConsequentialActionApproval,
  classifyConsequentialActionConsentMode,
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
});
