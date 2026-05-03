import { ToolName } from "../../types";

export type ConsequentialActionKind = "job_application_submit";

export type ConsequentialActionConsentMode =
  | "explicit_go"
  | "prepare_only"
  | "unclear"
  | "forbidden";

export interface ConsequentialActionApprovalInput {
  toolName: ToolName;
  args: Record<string, unknown>;
  taskText: string;
  actionLabel: string;
}

export interface ConsequentialActionApprovalDecision {
  requiresApproval: boolean;
  kind: ConsequentialActionKind | null;
  consentMode: ConsequentialActionConsentMode;
}

export function classifyConsequentialActionConsentMode(
  taskText: string,
): ConsequentialActionConsentMode {
  if (
    /\b(?:wait for|ask for|request|get)\s+(?:my\s+|user\s+)?(?:approval|confirmation|permission|go-ahead)\b/i.test(
      taskText,
    ) ||
    /\b(?:prepare|fill|draft|stage|review)\b[\s\S]{0,100}\b(?:but\s+)?(?:do not|don't|without)\s+(?:submit|send|post|publish|buy|purchase|place|delete|confirm|approve)\b/i.test(
      taskText,
    )
  ) {
    return "prepare_only";
  }

  if (
    /\b(?:do not|don't|never)\s+(?:submit|send|post|publish|buy|purchase|place|delete|confirm|approve)\b/i.test(
      taskText,
    )
  ) {
    return "forbidden";
  }

  if (
    /\b(?:submit|send|post|publish|buy|purchase|place order|delete|confirm|approve)\b/i.test(
      taskText,
    )
  ) {
    return "explicit_go";
  }

  return "unclear";
}

export function assessConsequentialActionApproval(
  input: ConsequentialActionApprovalInput,
): ConsequentialActionApprovalDecision {
  const taskText = input.taskText.toLowerCase();
  const consentMode = classifyConsequentialActionConsentMode(taskText);

  if (
    isJobApplicationWorkflow(taskText) &&
    isJobApplicationSubmitAction(input.toolName, input.args, input.actionLabel)
  ) {
    return {
      requiresApproval: true,
      kind: "job_application_submit",
      consentMode,
    };
  }

  return {
    requiresApproval: false,
    kind: null,
    consentMode,
  };
}

function isJobApplicationWorkflow(taskText: string): boolean {
  return (
    /\b(job|career|position|vacancy|cv|resume)\b/.test(taskText) ||
    /\b(apply|application)\b[^.\n]{0,80}\b(job|career|position|vacancy)\b/.test(
      taskText,
    ) ||
    /\b(job|career|position|vacancy)\b[^.\n]{0,80}\b(apply|application)\b/.test(
      taskText,
    )
  );
}

function isJobApplicationSubmitAction(
  toolName: ToolName,
  args: Record<string, unknown>,
  actionLabel: string,
): boolean {
  if (toolName !== ToolName.CLICK_ELEMENT) return false;
  if (args.id == null) return false;

  const label = actionLabel.toLowerCase();
  return (
    /\b(submit|send|finish|complete)\b/.test(label) ||
    /\bapply\b.*\b(application|form)\b/.test(label)
  );
}
