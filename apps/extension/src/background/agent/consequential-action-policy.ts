import { DomSnapshot, ToolName } from "../../types";

export type ConsequentialActionKind =
  | "job_application_submit"
  | "communication_send"
  | "destructive_delete";

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

export interface ConsequentialFinalActionBlockInput {
  toolName: ToolName;
  args: Record<string, unknown>;
  taskText: string;
  actionLabel: string;
}

export function classifyConsequentialActionConsentMode(
  taskText: string,
): ConsequentialActionConsentMode {
  if (
    /\b(?:wait for|ask for|request|get)\s+(?:my\s+|user\s+)?(?:approval|confirmation|permission|go-ahead)\b/i.test(
      taskText,
    ) ||
    /\b(?:prepare|fill|draft|stage|review)\b[\s\S]{0,100}\b(?:but\s+)?(?:do not|don't|dont|without)\s+(?:submit|send|post|publish|buy|purchase|place|delete|confirm|approve)\b/i.test(
      taskText,
    )
  ) {
    return "prepare_only";
  }

  if (
    /\b(?:do not|don't|dont|never)\s+(?:submit|send|post|publish|buy|purchase|place|delete|confirm|approve)\b/i.test(
      taskText,
    )
  ) {
    return "forbidden";
  }

  if (isDraftOnlyCommunicationTask(taskText)) {
    return "prepare_only";
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

  if (isDestructiveDeleteAction(input.toolName, input.args, input.actionLabel)) {
    return {
      requiresApproval: true,
      kind: "destructive_delete",
      consentMode,
    };
  }

  return {
    requiresApproval: false,
    kind: null,
    consentMode,
  };
}

function isDestructiveDeleteAction(
  toolName: ToolName,
  args: Record<string, unknown>,
  actionLabel: string,
): boolean {
  if (toolName !== ToolName.CLICK_ELEMENT || args.id == null) return false;

  return /\b(?:delete|trash|move to trash|empty trash|remove permanently)\b/i.test(
    actionLabel,
  );
}

export function assessConsequentialFinalActionBlock(
  input: ConsequentialFinalActionBlockInput,
): string | null {
  const taskText = input.taskText.toLowerCase();

  if (
    isCommunicationWorkflow(taskText) &&
    isCommunicationSendAction(input.toolName, input.args, input.actionLabel) &&
    isDraftOnlyCommunicationTask(taskText)
  ) {
    return (
      "This task is draft-only. Do not click the Send/Post/Reply control. " +
      "Leave the message composed in the editor and verify it remains unsent."
    );
  }

  return null;
}

export function assessDraftOnlyCompletionViolation(params: {
  taskText: string;
  summary: string;
  snapshot?: DomSnapshot | null;
}): string | null {
  const taskText = params.taskText.toLowerCase();
  if (!isDraftOnlyCommunicationTask(taskText)) return null;

  const snapshotText = [
    params.snapshot?.title,
    params.snapshot?.url,
    params.snapshot?.visibleContent,
    params.snapshot?.pageContent,
  ]
    .filter(Boolean)
    .join("\n");

  if (hasStrongCommunicationSentEvidence(snapshotText)) {
    return "The page shows the message was sent, but the task required an unsent draft.";
  }

  if (
    hasStrongCommunicationSentEvidence(params.summary) &&
    !hasDraftPreservedEvidence(params.summary)
  ) {
    return "The completion summary says the message was sent, but the task required an unsent draft.";
  }

  return null;
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

function isCommunicationWorkflow(taskText: string): boolean {
  return /\b(reply|respond|email|e-mail|message|thread|comment|post|compose|draft|copy|text)\b/.test(
    taskText,
  );
}

function isCommunicationSendAction(
  toolName: ToolName,
  args: Record<string, unknown>,
  actionLabel: string,
): boolean {
  if (toolName !== ToolName.CLICK_ELEMENT) return false;
  if (args.id == null) return false;

  const label = actionLabel.toLowerCase();
  return /\b(send|post|reply)\b/.test(label);
}

export function isDraftOnlyCommunicationTask(taskText: string): boolean {
  if (!isCommunicationWorkflow(taskText)) return false;

  if (
    /\b(?:do not|don't|dont|never)\s+(?:click\s+)?(?:send|post|reply|submit|publish)\b/i.test(
      taskText,
    ) ||
    /\b(?:leave|keep)\b[\s\S]{0,80}\b(?:unsent|as\s+(?:a\s+)?draft|in\s+drafts?)\b/i.test(
      taskText,
    ) ||
    /\b(?:unsent|draft-only|draft only)\b/i.test(taskText)
  ) {
    return true;
  }

  if (hasReviewBeforeSendIntent(taskText)) {
    return true;
  }

  return (
    /\b(?:draft|compose|write|prepare|create)\b[\s\S]{0,80}\b(?:reply|response|email|e-mail|message|comment|post|copy|text)\b/i.test(
      taskText,
    ) &&
    !/\b(?:send|post|publish)\b[\s\S]{0,80}\b(?:reply|response|email|e-mail|message|comment|post|it)\b/i.test(
      taskText,
    ) &&
    !/\b(?:reply|response|email|e-mail|message|comment|post)\b[\s\S]{0,80}\b(?:sent|posted|published)\b/i.test(
      taskText,
    )
  );
}

function hasReviewBeforeSendIntent(taskText: string): boolean {
  return (
    /\b(?:let me|allow me|i(?:'ll|'d| will| want to)?|we(?:'ll| will)?)\s+(?:review|approve|check|look over)\b[\s\S]{0,100}\b(?:copy|draft|message|reply|email|e-mail|text|content)\b/i.test(
      taskText,
    ) ||
    /\b(?:review|approve|check|look over)\s+(?:the\s+)?(?:copy|draft|message|reply|email|e-mail|text|content)\s+(?:first|before)\b/i.test(
      taskText,
    ) ||
    /\b(?:copy|draft|message|reply|email|e-mail|text|content)\b[\s\S]{0,100}\b(?:for\s+)?(?:me|the\s+user|user)\s+to\s+(?:review|approve|check|look over)\b/i.test(
      taskText,
    )
  );
}

export function hasStrongCommunicationSentEvidence(text: string): boolean {
  return /\b(?:message|reply|email|e-mail|comment|post)\b[\s\S]{0,50}\b(?:sent|posted|submitted|published)\b/i.test(
    text,
  ) ||
    /\b(?:sent|posted|submitted|published)\b[\s\S]{0,50}\b(?:message|reply|email|e-mail|comment|post)\b/i.test(
      text,
    ) ||
    /\b(?:sent just now|message sent|sent mail|send confirmation|successfully sent|successfully posted)\b/i.test(
      text,
    );
}

export function hasDraftPreservedEvidence(text: string): boolean {
  return /\b(?:unsent|not sent|not been sent|draft|drafted|remains in the editor|left in the editor)\b/i.test(
    text,
  );
}
