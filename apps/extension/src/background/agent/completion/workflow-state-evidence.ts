import type { DomSnapshot, TaggedElement, ToolName } from "../../../types";
import type { CompletionEvidence, FormFieldObservation } from "./kernel-types";
import { cleanLabel, compactKey, normalizeText, tokenizeCompletionText } from "./text-utils";
import { extractFormFieldObservations } from "./form-field-analysis";
import { extractDraftEvidence } from "./draft-analysis";
import { samePageUrl } from "./navigation-analysis";
import { isWorkflowRowLikeElement } from "./read-answer-analysis";
import { parseUploadFileResult } from "./file-transfer-evidence";
import {
  elementControlText, inferDraftSubmissionAction,
  inferTargetDisappearanceAction, inferWorkflowConfirmationTargetLabel,
  normalizeWorkflowTargetLabel, workflowTargetLabelCoveredByText,
} from "./workflow-confirmation-analysis";
import type { WorkflowConfirmationAction } from "./workflow-confirmation-types";

export function extractCreateFormDisappearanceEvidenceFromToolOutcome(params: {
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
  if (!element || !isCreateFormSubmissionControl(element)) return [];

  const preFields = extractFormFieldObservations(pre);
  const target = inferCreatedFormTarget(preFields);
  if (!target) return [];
  if (!didSubmittedFormDisappear(preFields, current)) return [];
  if (snapshotHasFormValidationText(current)) return [];

  const key = compactKey(target) || `tag-${element.tag}`;
  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:create:form:${key}`,
      observedAtTurn: params.turn,
      detail: {
        text: `Create form no longer visible: ${target}`,
        action: "create",
        targetText: target,
        source: "form_disappearance",
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

export function extractCreateRowAppearanceEvidenceFromToolOutcome(params: {
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
  if (!element || !isCreateFormSubmissionControl(element)) return [];

  const preFields = extractFormFieldObservations(pre);
  const target = inferCreatedFormTarget(preFields);
  if (!target) return [];
  if (didSubmittedFormDisappear(preFields, current)) return [];
  if (snapshotHasFormValidationText(current)) return [];
  if (findCreatedRowText(pre, target)) return [];

  const rowText = findCreatedRowText(current, target);
  if (!rowText) return [];

  const key = compactKey(target) || compactKey(rowText) || `tag-${element.tag}`;
  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:create:row:${key}`,
      observedAtTurn: params.turn,
      detail: {
        text: `Created row visible: ${target}`,
        action: "create",
        targetText: target,
        source: "created_row",
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

function findCreatedRowText(
  snapshot: DomSnapshot,
  target: string,
): string | null {
  const row = snapshot.elements.find((element) => {
    if (!element.isVisible || element.isDisabled) return false;
    if (!isWorkflowRowLikeElement(element)) return false;
    const text = workflowRowElementText(element);
    return Boolean(text) && workflowTargetLabelCoveredByText(target, text);
  });
  return row ? workflowRowElementText(row) : null;
}

type DuplicateRowWorkflowAction = Extract<
  WorkflowConfirmationAction,
  "copy" | "duplicate"
>;

export function extractDuplicateRowStateEvidenceFromToolOutcome(params: {
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

  const action = inferTargetDisappearanceAction(element);
  if (!isDuplicateRowWorkflowAction(action)) return [];

  const target = inferWorkflowTargetTextFromControl(element, action);
  if (!target) return [];
  if (snapshotHasFormValidationText(current)) return [];

  const rowText = findNewDuplicateRowStateText(
    pre,
    current,
    target,
    action,
    elementControlText(element),
  );
  if (!rowText) return [];

  const key = compactKey(target) || compactKey(rowText) || `tag-${element.tag}`;
  const actionLabel = action === "copy" ? "Copied" : "Duplicated";
  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:${action}:row:${key}`,
      observedAtTurn: params.turn,
      detail: {
        text: `${actionLabel} row visible: ${target}`,
        action,
        targetText: target,
        source: "duplicate_row_state",
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

function isDuplicateRowWorkflowAction(
  action: WorkflowConfirmationAction | null,
): action is DuplicateRowWorkflowAction {
  return action === "copy" || action === "duplicate";
}

function findNewDuplicateRowStateText(
  pre: DomSnapshot,
  current: DomSnapshot,
  target: string,
  action: DuplicateRowWorkflowAction,
  clickedControlText: string,
): string | null {
  const preRows = workflowRowsCoveringTarget(pre, target);
  if (preRows.length === 0) return null;

  const currentRows = workflowRowsCoveringTarget(current, target);
  if (currentRows.length <= preRows.length) return null;

  const preStateRows = new Set(
    preRows
      .filter((text) => duplicateRowTextHasDuplicatedState(text, action))
      .map(rowStateKey),
  );
  const clickedControlKey = normalizeText(clickedControlText);
  const rowText = currentRows.find(
    (text) =>
      duplicateRowTextHasDuplicatedState(text, action) &&
      (!clickedControlKey ||
        !normalizeText(text).includes(clickedControlKey)) &&
      !preStateRows.has(rowStateKey(text)),
  );
  return rowText ?? null;
}

function workflowRowsCoveringTarget(
  snapshot: DomSnapshot,
  target: string,
): string[] {
  const rows: string[] = [];
  for (const element of snapshot.elements) {
    if (!element.isVisible || element.isDisabled) continue;
    if (!isWorkflowRowLikeElement(element)) continue;
    const text = workflowRowElementText(element);
    if (!text || !workflowTargetLabelCoveredByText(target, text)) continue;
    rows.push(text);
  }
  return rows;
}

function duplicateRowTextHasDuplicatedState(
  value: string,
  action: DuplicateRowWorkflowAction,
): boolean {
  const text = normalizeText(value);
  if (action === "copy") {
    return /\b(?:copied|copy)\b/i.test(text);
  }
  return /\b(?:duplicated|duplicate|duplication|cloned|clone|copied|copy)\b/i.test(
    text,
  );
}

function rowStateKey(value: string): string {
  return normalizeText(value);
}

function workflowRowElementText(element: TaggedElement): string {
  const attrs = element.attributes ?? {};
  return cleanLabel(
    [
      element.text,
      attrs["aria-label"],
      attrs.title,
      attrs.label,
      attrs.name,
      attrs.id,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function isCreateFormSubmissionControl(element: TaggedElement): boolean {
  const text = normalizeText(elementControlText(element));
  if (!text) return false;
  if (
    /\b(?:cancel|close|dismiss|delete|remove|archive|invite|duplicate|restore|update|save|send|post|publish|refresh|restart|reset)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  return /\b(?:create|add|register)\b\s+(?:the\s+)?(?:record|item|task|ticket|request|entry|row|template|report|page|document|file|workflow|rule|dashboard|view|list|policy|profile|account|user|order|case|issue|incident|project|contact|customer)\b/i.test(
    text,
  );
}

function inferCreatedFormTarget(fields: FormFieldObservation[]): string | null {
  const candidates = fields
    .filter((field) => field.kind === "text")
    .map((field) => ({
      field,
      value: normalizeWorkflowTargetLabel(cleanLabel(field.value), {
        quoted: true,
      }),
    }))
    .filter(
      (
        candidate,
      ): candidate is {
        field: FormFieldObservation;
        value: string;
      } =>
        Boolean(candidate.value) &&
        isCreateFormTargetValue(candidate.value ?? "") &&
        !isNonTargetCreateFormField(candidate.field),
    );
  if (candidates.length === 0) return null;

  const targetLike = candidates.filter((candidate) =>
    isLikelyCreateTargetField(candidate.field),
  );
  if (targetLike.length > 0) return targetLike[0].value;
  if (candidates.length === 1) return candidates[0].value;
  return null;
}

function isCreateFormTargetValue(value: string): boolean {
  const clean = cleanLabel(value);
  if (clean.length < 3 || clean.length > 120) return false;
  if (/[.!?]\s/.test(clean)) return false;
  const tokens = tokenizeCompletionText(clean);
  if (tokens.length === 0 || tokens.length > 8) return false;
  return !/^(?:yes|no|true|false|on|off|n\/a|none|null|new|draft|active|inactive)$/i.test(
    normalizeText(clean),
  );
}

function isLikelyCreateTargetField(field: FormFieldObservation): boolean {
  const label = normalizeText([field.label, field.stableKey].join(" "));
  return /\b(?:name|title|subject|summary|label|customer|account|user|username|project|ticket|case|contact|company|organization|organisation|email|identifier|id|number)\b/i.test(
    label,
  );
}

function isNonTargetCreateFormField(field: FormFieldObservation): boolean {
  const label = normalizeText([field.label, field.stableKey].join(" "));
  return /\b(?:description|notes?|comments?|message|body|password|passcode|secret|token|key|address|phone|amount|quantity|count|date|time)\b/i.test(
    label,
  );
}

function didSubmittedFormDisappear(
  preFields: FormFieldObservation[],
  current: DomSnapshot,
): boolean {
  if (preFields.length === 0) return false;
  const currentFields = extractFormFieldObservations(current);
  if (currentFields.length === 0) return true;
  const preStableKeys = new Set(preFields.map((field) => field.stableKey));
  return !currentFields.some((field) => preStableKeys.has(field.stableKey));
}

export function extractImportRowStateEvidenceFromToolOutcome(params: {
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
  if (params.toolName !== "upload_file") return [];

  const parsed = parseUploadFileResult(params.result);
  if (!parsed) return [];
  if (snapshotHasFormValidationText(current)) return [];
  if (findImportRowStateText(pre, parsed.filename)) return [];

  const rowText = findImportRowStateText(current, parsed.filename);
  if (!rowText) return [];

  const key = compactKey(parsed.filename) || compactKey(rowText) || "file";
  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:import:row:${key}`,
      observedAtTurn: params.turn,
      detail: {
        text: `Import row visible: ${parsed.filename}`,
        action: "import",
        targetText: parsed.filename,
        source: "import_row_state",
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

function findImportRowStateText(
  snapshot: DomSnapshot,
  filename: string,
): string | null {
  const row = snapshot.elements.find((element) => {
    if (!element.isVisible || element.isDisabled) return false;
    if (!isWorkflowRowLikeElement(element)) return false;
    const text = workflowRowElementText(element);
    return (
      Boolean(text) &&
      workflowTargetLabelCoveredByText(filename, text) &&
      importRowTextHasImportedState(text)
    );
  });
  return row ? workflowRowElementText(row) : null;
}

function importRowTextHasImportedState(value: string): boolean {
  return /\b(?:imported|import\s+(?:complete|completed|successful)|processing\s+complete|processed\s+successfully|records?\s+imported|rows?\s+imported)\b/i.test(
    normalizeText(value),
  );
}

export function extractAttachmentRowStateEvidenceFromToolOutcome(params: {
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
  if (params.toolName !== "upload_file") return [];

  const parsed = parseUploadFileResult(params.result);
  if (!parsed) return [];
  if (snapshotHasFormValidationText(current)) return [];
  if (findAttachmentRowStateText(pre, parsed.filename)) return [];

  const rowText = findAttachmentRowStateText(current, parsed.filename);
  if (!rowText) return [];

  const key = compactKey(parsed.filename) || compactKey(rowText) || "file";
  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:attach:row:${key}`,
      observedAtTurn: params.turn,
      detail: {
        text: `Attachment row visible: ${parsed.filename}`,
        action: "attach",
        targetText: parsed.filename,
        source: "attachment_row_state",
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

function findAttachmentRowStateText(
  snapshot: DomSnapshot,
  filename: string,
): string | null {
  const row = snapshot.elements.find((element) => {
    if (!element.isVisible || element.isDisabled) return false;
    if (!isWorkflowRowLikeElement(element)) return false;
    const text = workflowRowElementText(element);
    return (
      Boolean(text) &&
      workflowTargetLabelCoveredByText(filename, text) &&
      attachmentRowTextHasAttachedState(text)
    );
  });
  return row ? workflowRowElementText(row) : null;
}

function attachmentRowTextHasAttachedState(value: string): boolean {
  return /\b(?:attached|attachment\s+(?:complete|completed|successful|uploaded)|file\s+attached|file\s+uploaded|uploaded)\b/i.test(
    normalizeText(value),
  );
}

function snapshotHasFormValidationText(snapshot: DomSnapshot): boolean {
  const text = [snapshot.title, snapshot.visibleContent, snapshot.pageContent]
    .filter(Boolean)
    .join("\n")
    .slice(0, 20_000);
  return /\b(?:error|invalid|missing|please fill|please enter|is required|are required|required field|cannot be blank|can't be blank|must be filled)\b/i.test(
    text,
  );
}

export function extractDraftSubmissionEvidenceFromToolOutcome(params: {
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

  const action = inferDraftSubmissionAction(element);
  if (!action) return [];

  const draft = findSubmittedDraftCandidate(pre, params.turn);
  if (!draft) return [];

  const normalizedDraftText = normalizeText(draft.detail.text);
  if (!snapshotContainsNormalizedText(pre, normalizedDraftText)) return [];
  if (snapshotContainsNormalizedText(current, normalizedDraftText)) return [];

  const key =
    compactKey(draft.detail.target) ||
    compactKey(draft.detail.text) ||
    `tag-${id}`;
  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:${action}:draft:${key}`,
      observedAtTurn: params.turn,
      detail: {
        text: `${action === "send" ? "Sent" : "Posted"} draft no longer visible: ${draft.detail.target}`,
        action,
        source: "draft_disappearance",
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

export function extractSubmittedDraftRowEvidenceFromToolOutcome(params: {
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

  const action = inferDraftSubmissionAction(element);
  if (!action) return [];

  const draft = findSubmittedDraftCandidate(pre, params.turn);
  if (!draft) return [];
  if (snapshotHasFormValidationText(current)) return [];
  if (draftEditorStillContainsText(current, draft.detail.text, params.turn)) {
    return [];
  }
  if (findSubmittedDraftRowText(pre, draft.detail.text)) return [];

  const rowText = findSubmittedDraftRowText(current, draft.detail.text);
  if (!rowText) return [];

  const key =
    compactKey(draft.detail.target) ||
    compactKey(draft.detail.text) ||
    `tag-${id}`;
  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:${action}:draft-row:${key}`,
      observedAtTurn: params.turn,
      detail: {
        text: `${action === "send" ? "Sent" : "Posted"} draft visible as row: ${draft.detail.target}`,
        action,
        targetText: cleanLabel(draft.detail.text),
        source: "submitted_draft_row",
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

function findSubmittedDraftCandidate(
  snapshot: DomSnapshot,
  turn: number,
): Extract<CompletionEvidence, { type: "draft_state" }> | null {
  return (
    extractDraftEvidence(snapshot, turn)
      .filter(
        (
          event,
        ): event is Extract<CompletionEvidence, { type: "draft_state" }> =>
          event.type === "draft_state" &&
          !event.detail.submitted &&
          tokenizeCompletionText(event.detail.text).length >= 3 &&
          cleanLabel(event.detail.text).length >= 12,
      )
      .sort((a, b) => b.detail.text.length - a.detail.text.length)[0] ?? null
  );
}

function draftEditorStillContainsText(
  snapshot: DomSnapshot,
  draftText: string,
  turn: number,
): boolean {
  const normalizedDraftText = normalizeText(draftText);
  if (!normalizedDraftText) return false;
  return extractDraftEvidence(snapshot, turn).some((event) => {
    if (event.type !== "draft_state") return false;
    const currentText = normalizeText(event.detail.text);
    return (
      currentText === normalizedDraftText ||
      currentText.includes(normalizedDraftText)
    );
  });
}

function findSubmittedDraftRowText(
  snapshot: DomSnapshot,
  draftText: string,
): string | null {
  const normalizedDraftText = normalizeText(draftText);
  if (!normalizedDraftText) return null;
  const row = snapshot.elements.find((element) => {
    if (!element.isVisible || element.isDisabled) return false;
    if (!isWorkflowRowLikeElement(element)) return false;
    const text = workflowRowElementText(element);
    return Boolean(text) && normalizeText(text).includes(normalizedDraftText);
  });
  return row ? workflowRowElementText(row) : null;
}

export function extractInviteRowStateEvidenceFromToolOutcome(params: {
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

  const action = inferTargetDisappearanceAction(element);
  if (action !== "invite") return [];

  const target = inferWorkflowTargetTextFromControl(element, "invite");
  if (!target) return [];
  if (snapshotHasFormValidationText(current)) return [];
  if (findInviteRowStateText(pre, target)) return [];

  const rowText = findInviteRowStateText(current, target);
  if (!rowText) return [];

  const key = compactKey(target) || compactKey(rowText) || `tag-${id}`;
  return [
    {
      type: "confirmation_state",
      confidence: "high",
      logicalKey: `workflow:confirmation:invite:row:${key}`,
      observedAtTurn: params.turn,
      detail: {
        text: `Invitation row visible: ${target}`,
        action: "invite",
        targetText: target,
        source: "invite_row_state",
        ...(current.url ? { url: current.url } : {}),
      },
    },
  ];
}

function findInviteRowStateText(
  snapshot: DomSnapshot,
  target: string,
): string | null {
  const row = snapshot.elements.find((element) => {
    if (!element.isVisible || element.isDisabled) return false;
    if (!isWorkflowRowLikeElement(element)) return false;
    const text = workflowRowElementText(element);
    return (
      Boolean(text) &&
      workflowTargetLabelCoveredByText(target, text) &&
      inviteRowTextHasInvitationState(text)
    );
  });
  return row ? workflowRowElementText(row) : null;
}

function inviteRowTextHasInvitationState(value: string): boolean {
  return /\b(?:pending\s+invitation|invitation\s+pending|invitation\s+sent|invite\s+sent|invited|awaiting\s+(?:acceptance|response)|pending\s+acceptance)\b/i.test(
    normalizeText(value),
  );
}

export function inferWorkflowTargetTextFromControl(
  element: TaggedElement,
  action: WorkflowConfirmationAction,
): string | null {
  const candidates = [
    element.text,
    element.attributes.label,
    element.attributes["aria-label"],
    element.attributes.title,
    element.attributes.value,
  ];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    if (!candidate) continue;
    for (const value of [candidate, candidate.replace(/[-_]+/g, " ")]) {
      const text = cleanLabel(value);
      const key = normalizeText(text);
      if (!text || seen.has(key)) continue;
      seen.add(key);

      const target = inferWorkflowConfirmationTargetLabel(text, action);
      if (target) return target;
    }
  }
  return null;
}

export function snapshotContainsNormalizedText(
  snapshot: DomSnapshot,
  normalizedNeedle: string,
): boolean {
  if (!normalizedNeedle) return false;
  return normalizeText(
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
  ).includes(normalizedNeedle);
}
