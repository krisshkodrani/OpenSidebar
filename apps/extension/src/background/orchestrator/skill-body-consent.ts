import type { LoadedSkillContract, SkillDescriptor } from "./skill-types";

export const CONSEQUENTIAL_ACTION_CONSENT_BODY: Omit<LoadedSkillContract, keyof SkillDescriptor> = {
    procedureMarkdown: [
      "1. Identify whether the task includes a consequential final action: submit, send, publish, buy, place order, delete, confirm, or approve.",
      "2. Determine the user's consent mode from the request: explicit go-ahead, prepare-only, forbidden, or unclear.",
      "3. If consent is unclear, ask the user whether final actions should be executed automatically or held for approval.",
      "4. Continue safe preparation: read context, map and fill every visible draft or form field, configure options, and collect verification evidence. For a message or dispute, identify the recipient or organization in both the subject and body when those fields exist. Do not treat one filled field as a complete multi-field draft.",
      "5. Re-read the live page to verify all prepared values and any ready-for-approval state before calling done. If the page still says Draft or its final-action button is disabled, check for missing required content; a disabled button alone does not prove approval is the only remaining gate. Include requested names and exact facts in the draft itself, not only in the final summary. Before a consequential final action, summarize what will happen and wait for approval when requested or unclear.",
      "6. Do not use test fixture wording, hidden selectors, or benchmark-specific assumptions to decide consent.",
      "7. After an approved final action, verify real page feedback such as confirmation, sent state, published item, order receipt, or deleted/changed state.",
    ].join("\n"),
    requiredEvidence: [
      "The consequential action type and target",
      "The user's consent mode or explicit approval request",
      "Prepared state before final action",
      "Live readback of every required draft or form field and the ready state",
      "Post-action confirmation when execution is approved",
    ],
    commonFailures: [
      {
        signal: "final action is available but user consent is unclear",
        recovery:
          "ask a clarification or approval question instead of clicking the final action",
      },
      {
        signal: "task was prepare-only but the agent tries to submit",
        recovery:
          "stop after preparation, summarize ready state, and request approval",
      },
      {
        signal: "draft remains incomplete or final-action control is disabled",
        recovery:
          "inspect the form's validation hints, fill missing requested content, and verify ready state without submitting",
      },
    ],
    executionContract: {
      sequencing: [
        "Classify consent mode, prepare safely, verify ready state, then request approval before final action when required.",
      ],
      toolDiscipline: [
        "Use clarify when the user's final-action policy is unclear.",
        "Avoid press_key shortcuts for final submit/send/publish/buy/delete actions.",
        "Prefer tagged click targets over coordinates for approval-gated final actions.",
      ],
      completionChecks: [
        "For prepare-only work, every required field is populated and the live page shows the draft or form is ready for approval.",
        "The final action was either approved and verified, or intentionally stopped pending approval.",
        "The final answer states whether the consequential action was executed or is waiting for approval.",
      ],
      failureRecovery: [
        "If approval is denied or absent, report the prepared state without executing the final action.",
        "If the final target is ambiguous, re-ground and ask which target should receive the action.",
      ],
    },
};
