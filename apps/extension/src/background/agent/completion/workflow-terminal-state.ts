/**
 * Workflow visible/terminal target-state confirmation.
 *
 * Infers whether a workflow contract is satisfied by state the page is
 * actually showing - a toggle rendered in its target state, or a terminal
 * "workflow complete / saved successfully" banner. Extracted from
 * completion-kernel.ts; behavior is unchanged.
 */

import type { DomSnapshot } from "../../../types";
import type {
  CompletionEvidence,
  WorkflowConfirmationContract,
} from "./kernel-types";
import type { WorkflowConfirmationAction } from "./workflow-confirmation-types";
import {
  cleanLabel,
  compactKey,
  escapeRegExp,
  normalizeText,
  tokenizeCompletionText,
} from "./text-utils";
import {
  textConfirmsWorkflowAction,
  workflowTargetLabelCoveredByText,
} from "./workflow-confirmation-analysis";

/** Highest turn index observed across the evidence ledger. */
export function latestObservedTurn(evidence: CompletionEvidence[]): number {
  return evidence.reduce(
    (latest, event) => Math.max(latest, event.observedAtTurn),
    0,
  );
}

export function summaryConfirmsWorkflowAction(
  summary: string,
  action: WorkflowConfirmationAction,
): boolean {
  return textConfirmsWorkflowAction(summary, action, "summary");
}

export function inferWorkflowVisibleTargetStateConfirmation(params: {
  contract: WorkflowConfirmationContract;
  evidence: CompletionEvidence[];
  snapshot?: DomSnapshot | null;
  summary?: string;
}): Extract<CompletionEvidence, { type: "confirmation_state" }> | null {
  const { contract, snapshot } = params;
  if (!contract.targetLabel || !snapshot) return null;

  const statePattern = workflowVisibleTargetStatePattern(contract.action);
  if (!statePattern) return null;

  const visibleText = cleanLabel(
    [snapshot.visibleContent, snapshot.pageContent].filter(Boolean).join("\n"),
  );
  if (!visibleText) return null;
  if (
    !workflowVisibleTargetStateMatches(
      contract.targetLabel,
      statePattern,
      visibleText,
    )
  ) {
    return null;
  }
  if (
    params.summary &&
    !workflowVisibleTargetStateSummaryMatches(
      params.summary,
      contract.targetLabel,
      contract.action,
      statePattern,
    )
  ) {
    return null;
  }

  const targetKey = compactKey(contract.targetLabel + ":" + contract.action);
  return {
    type: "confirmation_state",
    confidence: "medium",
    logicalKey:
      "workflow:confirmation:" +
      contract.action +
      ":visible-target-state:" +
      targetKey,
    observedAtTurn: latestObservedTurn(params.evidence),
    detail: {
      action: contract.action,
      source: "visible_text",
      targetText: contract.targetLabel,
      text: workflowVisibleTargetStateSnippet(
        visibleText,
        contract.targetLabel,
        statePattern,
      ),
    },
  };
}

export function inferSavedTerminalWorkflowStateConfirmation(params: {
  contract: WorkflowConfirmationContract;
  evidence: CompletionEvidence[];
  snapshot?: DomSnapshot | null;
  summary?: string;
}): Extract<CompletionEvidence, { type: "confirmation_state" }> | null {
  const { contract, snapshot } = params;
  if (!snapshot) return null;

  const visibleText = cleanLabel(
    [snapshot.visibleContent, snapshot.pageContent].filter(Boolean).join("\n"),
  );
  if (
    !/\bworkflow\s+complete\b/i.test(visibleText) ||
    !/\bfinal\s+action\s+(?:was\s+|has\s+been\s+)?saved\s+successfully\b/i.test(
      visibleText,
    ) ||
    /\bfinal\s+action\s+is\s+(?:now\s+)?available\b/i.test(visibleText)
  ) {
    return null;
  }

  const pageText = cleanLabel(
    [snapshot.title, visibleText].filter(Boolean).join("\n"),
  );
  if (
    contract.targetLabel &&
    !workflowTargetLabelCoveredByText(contract.targetLabel, pageText)
  ) {
    return null;
  }

  if (
    params.summary &&
    !summaryConfirmsWorkflowAction(params.summary, contract.action) &&
    !(
      /\bworkflow\s+(?:is\s+)?complete\b/i.test(params.summary) &&
      /\bfinal\s+action\s+(?:was\s+|has\s+been\s+)?saved\s+successfully\b/i.test(
        params.summary,
      )
    )
  ) {
    return null;
  }

  return {
    type: "confirmation_state",
    confidence: "medium",
    logicalKey: `workflow:confirmation:${contract.action}:saved-terminal-state`,
    observedAtTurn: latestObservedTurn(params.evidence),
    detail: {
      action: contract.action,
      source: "visible_text",
      ...(contract.targetLabel ? { targetText: contract.targetLabel } : {}),
      text: "Workflow complete. The final action was saved successfully.",
      ...(snapshot.url ? { url: snapshot.url } : {}),
    },
  };
}

function workflowVisibleTargetStatePattern(
  action: WorkflowConfirmationAction,
): string | null {
  switch (action) {
    case "enable":
      return "(?:enabled|activated|on|active)";
    case "disable":
      return "(?:disabled|deactivated|off|inactive)";
    default:
      return null;
  }
}

function workflowVisibleTargetStateMatches(
  targetLabel: string,
  statePattern: string,
  visibleText: string,
): boolean {
  const targetTokens = workflowVisibleTargetStateTokens(targetLabel);
  if (targetTokens.length === 0) return false;

  const normalizedText = normalizeText(visibleText);
  const targetPattern = targetTokens.map(escapeRegExp).join("\\s+");
  return new RegExp(
    `\\b${targetPattern}\\b(?:\\s*(?:[:=\\-])\\s*|\\s+(?:is|now|currently|has\\s+been|was|turned|set\\s+to|status(?:\\s+is)?|state(?:\\s+is)?)\\s+|\\s+)${statePattern}\\b`,
    "i",
  ).test(normalizedText);
}

function workflowVisibleTargetStateSummaryMatches(
  summary: string,
  targetLabel: string,
  action: WorkflowConfirmationAction,
  statePattern: string,
): boolean {
  if (workflowVisibleTargetStateMatches(targetLabel, statePattern, summary)) {
    return true;
  }
  if (!workflowTargetLabelCoveredByText(targetLabel, summary)) return false;
  if (summaryConfirmsWorkflowAction(summary, action)) return true;
  if (action === "enable") {
    return /\b(?:turn(?:ed)?\s+on|switched\s+on|enabled|activated)\b/i.test(
      summary,
    );
  }
  if (action === "disable") {
    return /\b(?:turn(?:ed)?\s+off|switched\s+off|disabled|deactivated)\b/i.test(
      summary,
    );
  }
  return false;
}

function workflowVisibleTargetStateTokens(targetLabel: string): string[] {
  return tokenizeCompletionText(targetLabel).filter(
    (token) =>
      !/^(?:enable|enabled|activate|activated|activation|disable|disabled|deactivate|deactivated|deactivation|turn|turned|on|off|active|inactive|toggle|toggles|switch|switches|setting|settings|status|state|control|button)$/i.test(
        token,
      ),
  );
}

function workflowVisibleTargetStateSnippet(
  visibleText: string,
  targetLabel: string,
  statePattern: string,
): string {
  const normalizedText = normalizeText(visibleText);
  const targetTokens = workflowVisibleTargetStateTokens(targetLabel);
  const targetPattern = targetTokens.map(escapeRegExp).join("\\s+");
  const match = new RegExp(
    `\\b${targetPattern}\\b(?:\\s*(?:[:=\\-])\\s*|\\s+(?:is|now|currently|has\\s+been|was|turned|set\\s+to|status(?:\\s+is)?|state(?:\\s+is)?)\\s+|\\s+)${statePattern}\\b`,
    "i",
  ).exec(normalizedText);
  if (!match) return cleanLabel(targetLabel);
  const start = Math.max(0, match.index - 120);
  const end = Math.min(visibleText.length, match.index + match[0].length + 120);
  return cleanLabel(visibleText.slice(start, end));
}

