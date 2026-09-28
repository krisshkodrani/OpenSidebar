import type { DomSnapshot, TaggedElement, ToolName } from "../../../types";
import type { CompletionEvidence } from "./kernel-types";
import { cleanLabel, compactKey, normalizeText } from "./text-utils";
import { samePageUrl } from "./navigation-analysis";
import { inferWorkflowTargetTextFromControl } from "./workflow-state-evidence";
import {
  elementControlText, inferControlLabelChangeAction,
  inferControlStateChangeAction, inferSaveUpdateAction,
  inferStatusChangeAction, normalizeWorkflowTargetLabel,
  type StatusChangeWorkflowAction,
} from "./workflow-confirmation-analysis";
import {
  controlStateChangeMatchesAction, controlStateCompletionWord,
  readControlStateValue, type ControlStateWorkflowAction,
} from "./workflow-control-state";
import type { WorkflowConfirmationAction } from "./workflow-confirmation-types";

export function extractStatusChangeEvidenceFromToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  preActionSnapshot?: DomSnapshot | null;
  currentSnapshot?: DomSnapshot | null;
  turn: number;
}): CompletionEvidence[] {
  const pre = params.preActionSnapshot;
  const current = params.currentSnapshot;
  if (!pre || !current) return [];
  if (!samePageUrl(pre.url, current.url)) return [];
  if (params.toolName !== "click_element") return [];

  const id = Number(params.args.id);
  if (!Number.isFinite(id)) return [];
  const element = pre.elements.find((candidate) => candidate.tag === id);
  if (!element) return [];

  const action = inferStatusChangeAction(element);
  if (!action) return [];

  const currentStatus = findWorkflowStatusChangeText(current, action);
  if (!currentStatus) return [];
  if (findWorkflowStatusChangeText(pre, action)) return [];
  const targetText = findWorkflowStatusChangeTargetText(current, currentStatus);

  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:${action}:status:${compactKey(currentStatus)}`,
      observedAtTurn: params.turn,
      detail: {
        text: currentStatus,
        action,
        source: "status_change",
        ...(targetText ? { targetText } : {}),
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

export function extractControlLabelChangeEvidenceFromToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  preActionSnapshot?: DomSnapshot | null;
  currentSnapshot?: DomSnapshot | null;
  turn: number;
}): CompletionEvidence[] {
  const pre = params.preActionSnapshot;
  const current = params.currentSnapshot;
  if (!pre || !current) return [];
  if (!samePageUrl(pre.url, current.url)) return [];
  if (params.toolName !== "click_element") return [];

  const id = Number(params.args.id);
  if (!Number.isFinite(id)) return [];
  const element = pre.elements.find((candidate) => candidate.tag === id);
  if (!element) return [];

  const action = inferControlLabelChangeAction(element);
  if (!action) return [];

  const identity = stableControlIdentity(element);
  if (!identity) return [];

  const currentElement = current.elements.find(
    (candidate) =>
      candidate.isVisible && stableControlIdentity(candidate) === identity,
  );
  if (!currentElement) return [];

  const beforeText = elementControlText(element);
  const afterText = elementControlText(currentElement);
  if (normalizeText(beforeText) === normalizeText(afterText)) return [];
  if (controlLabelConfirmsWorkflowAction(beforeText, action)) return [];
  if (!controlLabelConfirmsWorkflowAction(afterText, action)) return [];
  const targetText = inferWorkflowTargetTextFromControl(element, action);

  const label = cleanLabel(
    currentElement.text ||
      currentElement.attributes.label ||
      currentElement.attributes["aria-label"] ||
      afterText,
  );

  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:${action}:control:${compactKey(identity)}`,
      observedAtTurn: params.turn,
      detail: {
        text: `Control label changed to confirmed state: ${label}`,
        action,
        source: "control_label_change",
        ...(targetText ? { targetText } : {}),
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

export function extractControlStateChangeEvidenceFromToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  preActionSnapshot?: DomSnapshot | null;
  currentSnapshot?: DomSnapshot | null;
  turn: number;
}): CompletionEvidence[] {
  const pre = params.preActionSnapshot;
  const current = params.currentSnapshot;
  if (!pre || !current) return [];
  if (!samePageUrl(pre.url, current.url)) return [];
  if (params.toolName !== "click_element") return [];

  const id = Number(params.args.id);
  if (!Number.isFinite(id)) return [];
  const element = pre.elements.find((candidate) => candidate.tag === id);
  if (!element) return [];

  const action = inferControlStateChangeAction(element);
  if (!action) return [];

  const identity = stableControlIdentity(element);
  if (!identity) return [];

  const currentElement = current.elements.find(
    (candidate) =>
      candidate.isVisible && stableControlIdentity(candidate) === identity,
  );
  if (!currentElement) return [];

  const beforeState = readControlState(element, action);
  const afterState = readControlState(currentElement, action);
  if (beforeState == null || afterState == null) return [];
  if (beforeState === afterState) return [];
  if (!controlStateChangeMatchesAction(action, beforeState, afterState)) {
    return [];
  }

  const label = cleanLabel(
    currentElement.text ||
      currentElement.attributes.label ||
      currentElement.attributes["aria-label"] ||
      element.text ||
      element.attributes.label ||
      element.attributes["aria-label"] ||
      elementControlText(element),
  );
  const targetText = inferWorkflowTargetTextFromControl(element, action);

  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:${action}:control-state:${compactKey(identity)}`,
      observedAtTurn: params.turn,
      detail: {
        text: `Control state changed to ${controlStateCompletionWord(action)}${label ? `: ${label}` : ""}`,
        action,
        source: "control_state_change",
        ...(targetText ? { targetText } : {}),
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

export function extractDirtyIndicatorClearedEvidenceFromToolOutcome(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  result: string;
  preActionSnapshot?: DomSnapshot | null;
  currentSnapshot?: DomSnapshot | null;
  turn: number;
}): CompletionEvidence[] {
  const pre = params.preActionSnapshot;
  const current = params.currentSnapshot;
  if (!pre || !current) return [];
  if (!samePageUrl(pre.url, current.url)) return [];
  if (params.toolName !== "click_element") return [];

  const id = Number(params.args.id);
  if (!Number.isFinite(id)) return [];
  const element = pre.elements.find((candidate) => candidate.tag === id);
  if (!element) return [];

  const action = inferSaveUpdateAction(element);
  if (!action) return [];
  if (!hasDirtyStateIndicator(pre)) return [];
  if (hasDirtyStateIndicator(current)) return [];
  const targetText = inferWorkflowTargetTextFromControl(element, action);

  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:${action}:dirty-indicator-cleared`,
      observedAtTurn: params.turn,
      detail: {
        text: "Unsaved-changes indicator is no longer visible.",
        action,
        source: "dirty_indicator_cleared",
        ...(targetText ? { targetText } : {}),
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

function controlLabelConfirmsWorkflowAction(
  value: string,
  action: WorkflowConfirmationAction,
): boolean {
  const text = normalizeText(value);
  switch (action) {
    case "delete":
      return /\b(?:deleted|removed)\b/i.test(text);
    case "archive":
      return /\barchived\b/i.test(text);
    case "save":
      return /\bsaved\b/i.test(text);
    case "send":
      return /\bsent\b/i.test(text);
    case "export":
      return /\bexported\b/i.test(text);
    case "download":
      return /\bdownloaded\b/i.test(text);
    case "upload":
      return /\buploaded\b/i.test(text);
    case "import":
      return /\bimported\b/i.test(text);
    case "attach":
      return /\battached\b/i.test(text);
    case "detach":
      return /\bdetached\b/i.test(text);
    case "copy":
      return /\bcopied\b/i.test(text);
    case "transfer":
      return /\btransferred\b/i.test(text);
    case "move":
      return /\bmoved\b/i.test(text);
    case "rename":
      return /\brenamed\b/i.test(text);
    case "merge":
      return /\bmerged\b/i.test(text);
    case "schedule":
      return /\bscheduled\b/i.test(text);
    case "unschedule":
      return /\bunscheduled\b/i.test(text);
    case "deploy":
      return /\bdeployed\b/i.test(text);
    case "rollback":
      return /\b(?:rolled\s+back|reverted)\b/i.test(text);
    case "backup":
      return /\bbacked\s+up\b/i.test(text);
    case "reset":
      return /\breset\b/i.test(text);
    case "suspend":
      return /\bsuspended\b/i.test(text);
    case "unsuspend":
      return /\bunsuspended\b/i.test(text);
    case "block":
      return /\bblocked\b/i.test(text);
    case "unblock":
      return /\bunblocked\b/i.test(text);
    case "link":
      return /\blinked\b/i.test(text);
    case "unlink":
      return /\bunlinked\b/i.test(text);
    case "tag":
      return /\btagged\b/i.test(text);
    case "untag":
      return /\buntagged\b/i.test(text);
    case "flag":
      return /\bflagged\b/i.test(text);
    case "unflag":
      return /\bunflagged\b/i.test(text);
    case "duplicate":
      return /\b(?:duplicated|cloned)\b/i.test(text);
    case "restore":
      return /\b(?:restored|recovered|reinstated)\b/i.test(text);
    case "create":
      return /\b(?:created|added|registered)\b/i.test(text);
    case "share":
      return /\bshared\b/i.test(text);
    case "grant":
      return /\bgranted\b/i.test(text);
    case "revoke":
      return /\brevoked\b/i.test(text);
    case "install":
      return /\binstalled\b/i.test(text);
    case "uninstall":
      return /\buninstalled\b/i.test(text);
    case "connect":
      return /\bconnected\b/i.test(text);
    case "disconnect":
      return /\bdisconnected\b/i.test(text);
    case "sync":
      return /\b(?:synced|resynced|synchroni[sz]ed)\b/i.test(text);
    case "invite":
      return /\binvited\b/i.test(text);
    case "subscribe":
      return /\bsubscribed\b/i.test(text);
    case "unsubscribe":
      return /\bunsubscribed\b/i.test(text);
    case "pin":
      return /\bpinned\b/i.test(text);
    case "unpin":
      return /\bunpinned\b/i.test(text);
    case "mute":
      return /\bmuted\b/i.test(text);
    case "unmute":
      return /\bunmuted\b/i.test(text);
    case "follow":
      return /\bfollowed\b/i.test(text);
    case "unfollow":
      return /\bunfollowed\b/i.test(text);
    case "bookmark":
      return /\bbookmarked\b/i.test(text);
    case "unbookmark":
      return /\bunbookmarked\b/i.test(text);
    case "favorite":
      return /\bfavorited\b/i.test(text);
    case "unfavorite":
      return /\bunfavorited\b/i.test(text);
    case "like":
      return /\bliked\b/i.test(text);
    case "unlike":
      return /\bunliked\b/i.test(text);
    case "upvote":
      return /\bupvoted\b/i.test(text);
    case "downvote":
      return /\bdownvoted\b/i.test(text);
    case "watch":
      return /\bwatched\b/i.test(text);
    case "unwatch":
      return /\bunwatched\b/i.test(text);
    case "star":
      return /\bstarred\b/i.test(text);
    case "unstar":
      return /\bunstarred\b/i.test(text);
    case "post":
      return /\b(?:posted|published)\b/i.test(text);
    case "approve":
      return /\bapproved\b/i.test(text);
    case "reject":
      return /\b(?:rejected|denied)\b/i.test(text);
    case "close":
      return /\b(?:closed|resolved)\b/i.test(text);
    case "reopen":
      return /\bre[-\s]?opened\b/i.test(text);
    case "cancel":
      return /\bcancell?ed\b/i.test(text);
    case "enable":
      return /\b(?:enabled|activated)\b/i.test(text);
    case "disable":
      return /\b(?:disabled|deactivated)\b/i.test(text);
    case "assign":
      return /\bassigned\b/i.test(text);
    case "unassign":
      return /\bunassigned\b/i.test(text);
    case "escalate":
      return /\bescalated\b/i.test(text);
    case "deescalate":
      return /\bde[-\s]?escalated\b/i.test(text);
    case "lock":
      return /\blocked\b/i.test(text);
    case "unlock":
      return /\bunlocked\b/i.test(text);
    case "pause":
      return /\bpaused\b/i.test(text);
    case "resume":
      return /\bresumed\b/i.test(text);
    case "start":
      return /\b(?:started|running|active)\b/i.test(text);
    case "stop":
      return /\b(?:stopped|inactive)\b/i.test(text);
    case "restart":
      return /\brestarted\b/i.test(text);
    case "refresh":
      return /\brefreshed\b/i.test(text);
    case "dismiss":
      return /\b(?:dismissed|hidden|cleared)\b/i.test(text);
    case "update":
      return /\b(?:updated|changed|applied|up[-\s]+to[-\s]+date)\b/i.test(text);
    case "submit":
      return /\bsubmitted\b/i.test(text);
    case "complete":
      return /\bcompleted\b/i.test(text);
  }
  return false;
}

function stableControlIdentity(element: TaggedElement): string | null {
  const identity =
    element.attributes.control ||
    element.attributes.id ||
    element.attributes.name ||
    element.attributes["data-testid"];
  return identity ? normalizeText(identity) : null;
}

function hasDirtyStateIndicator(snapshot: DomSnapshot): boolean {
  const text = normalizeText(snapshotCompletionText(snapshot));
  return /\b(?:unsaved(?: changes)?|changes not saved|changes have not been saved|not saved|pending changes|you have unsaved)\b/i.test(
    text,
  );
}

function findWorkflowStatusChangeText(
  snapshot: DomSnapshot,
  action: StatusChangeWorkflowAction,
): string | null {
  const text = snapshotCompletionText(snapshot);
  const statusWord =
    action === "approve"
      ? "(?:approved|approval complete|approval completed|approval successful)"
      : action === "reject"
        ? "(?:rejected|rejection complete|rejection completed|rejection successful|denied|denial complete|denial completed|denial successful)"
        : action === "post"
          ? "(?:posted|published|post complete|post completed|post successful|publish complete|publish completed|publish successful)"
          : action === "close"
            ? "(?:closed|resolved)"
            : action === "reopen"
              ? "(?:open|reopened|re-opened)"
              : action === "cancel"
                ? "(?:canceled|cancelled|cancellation complete|cancellation completed|cancellation successful)"
                : action === "enable"
                  ? "(?:enabled|activated|activation complete|activation completed|activation successful)"
                  : action === "disable"
                    ? "(?:disabled|deactivated|deactivation complete|deactivation completed|deactivation successful)"
                    : action === "assign"
                      ? "(?:assigned|assignment complete|assignment completed|assignment successful)"
                      : action === "unassign"
                        ? "(?:unassigned|unassign complete|unassign completed|unassign successful)"
                        : action === "escalate"
                          ? "(?:escalated|escalation complete|escalation completed|escalation successful)"
                          : action === "deescalate"
                            ? "(?:de[-\\s]?escalated|de[-\\s]?escalation complete|de[-\\s]?escalation completed|de[-\\s]?escalation successful)"
                            : action === "lock"
                              ? "(?:locked|lock complete|lock completed|lock successful)"
                              : action === "unlock"
                                ? "(?:unlocked|unlock complete|unlock completed|unlock successful)"
                                : action === "pause"
                                  ? "(?:paused|pause complete|pause completed|pause successful)"
                                  : action === "resume"
                                    ? "(?:resumed|running|active|resume complete|resume completed|resume successful)"
                                    : action === "start"
                                      ? "(?:started|running|active|start complete|start completed|start successful)"
                                      : action === "stop"
                                        ? "(?:stopped|inactive|stop complete|stop completed|stop successful)"
                                        : action === "submit"
                                          ? "(?:submitted|submission complete|submission completed|submission successful)"
                                          : "(?:complete|completed)";
  const patterns = [
    new RegExp(
      `\\b(?:status|state|stage)\\s*(?::|=|-|is|now)?\\s*${statusWord}\\b`,
      "i",
    ),
    new RegExp(`\\b${statusWord}\\s+(?:by|on|at|status|state|stage)\\b`, "i"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[0]) return cleanLabel(match[0]);
  }
  return null;
}

function findWorkflowStatusChangeTargetText(
  snapshot: DomSnapshot,
  statusText: string,
): string | null {
  const status = cleanLabel(statusText);
  if (!status) return null;
  const normalizedStatus = normalizeText(status);

  for (const segment of statusTargetTextSegments(snapshot)) {
    const text = cleanLabel(segment);
    const index = normalizeText(text).indexOf(normalizedStatus);
    if (index <= 0) continue;

    const prefix = cleanLabel(text.slice(0, index).replace(/[,:=-]+$/g, ""));
    if (!prefix || /\b(?:status|state|stage)\b/i.test(prefix)) continue;

    const target = normalizeWorkflowTargetLabel(prefix, {
      allowShort: /[\d_-]/.test(prefix),
    });
    if (target) return target;
  }
  return null;
}

function statusTargetTextSegments(snapshot: DomSnapshot): string[] {
  const segments: string[] = [];
  const seen = new Set<string>();
  for (const value of [
    snapshot.visibleContent,
    snapshot.pageContent,
    snapshot.title,
  ]) {
    if (!value) continue;
    for (const segment of value
      .replace(/([.!?;])\s+/g, "$1\n")
      .split(/[\r\n]+/g)) {
      const text = cleanLabel(segment);
      const key = normalizeText(text);
      if (!text || seen.has(key)) continue;
      seen.add(key);
      segments.push(text);
    }
  }
  return segments;
}

function snapshotCompletionText(snapshot: DomSnapshot): string {
  return cleanLabel(
    [
      snapshot.title,
      snapshot.visibleContent,
      snapshot.pageContent,
      ...snapshot.elements.flatMap((element) => [
        element.text,
        element.attributes.label,
        element.attributes["aria-label"],
        element.attributes.title,
        element.attributes.name,
        element.attributes.id,
        element.attributes.value,
      ]),
    ]
      .filter(Boolean)
      .join(" "),
  ).slice(0, 20_000);
}

function readControlState(
  element: TaggedElement,
  action?: ControlStateWorkflowAction,
): boolean | null {
  const state =
    element.attributes.checked ??
    element.attributes["aria-checked"] ??
    element.attributes["aria-pressed"] ??
    element.attributes["aria-selected"] ??
    element.attributes.selected ??
    element.attributes["data-state"] ??
    element.attributes["data-checked"] ??
    element.attributes["data-pressed"] ??
    element.attributes["data-selected"];
  return readControlStateValue(state, action);
}
