/**
 * Agent loop helpers — element validation, action tracking, snapshot fingerprinting,
 * handoff briefing, filler/hallucination detection, and attempt summarization
 */

import { DomSnapshot, ToolName } from "../../types";
import { LLMMessage } from "../llm/types";
import { stripThinkTags } from "../llm";
import { ActionEffect } from "./stagnation";
import { ACTION_EFFECT } from "./constants";
import { CACHEABLE_TOOLS } from "../tools/metadata";
import { ToolResultCache, type CacheType } from "./tool-cache";
import {
  assessTaskContractCoverage,
  buildTaskContract,
  TaskContractCoverage,
} from "./task-contract";

/** Tools that require a valid element `id` param — validated before dispatch. */
export const ELEMENT_ID_TOOLS = new Set<string>([
  ToolName.CLICK_ELEMENT,
  ToolName.TYPE_TEXT,
  ToolName.HOVER_ELEMENT,
  ToolName.SELECT_OPTION,
  ToolName.HIDE_ELEMENT,
  ToolName.READ_ELEMENT,
  ToolName.UPLOAD_FILE,
  ToolName.RIGHT_CLICK,
  ToolName.SET_CHECKBOX,
]);

/** Tools with dual element ID params (sourceId + targetId). */
export const ELEMENT_DUAL_ID_TOOLS = new Set<string>([ToolName.DRAG_AND_DROP]);

/**
 * Validate element IDs before dispatching to content script.
 * Returns null if valid, or an error string with sample valid IDs if invalid.
 */
export function validateElementIds(
  toolName: string,
  args: Record<string, unknown>,
  snapshot: DomSnapshot | null,
  discoveredIds?: Set<number>,
): string | null {
  if (!snapshot || snapshot.elements.length === 0) return null;

  const validIds = new Set(snapshot.elements.map((e) => e.tag));
  if (discoveredIds) {
    for (const id of discoveredIds) validIds.add(id);
  }

  const checkId = (id: unknown, paramName: string): string | null => {
    if (id == null) return null; // param not present — let executor handle
    const numId = typeof id === "number" ? id : Number(id);
    if (isNaN(numId)) return null; // non-numeric — let executor handle
    if (validIds.has(numId)) return null;

    const sampleElements = snapshot.elements
      .slice(0, 15)
      .map((e) => `[${e.tag}] ${e.tagName} "${e.text.slice(0, 30)}"`);
    return (
      `Error: Element ${paramName}=${numId} does not exist on the current page. ` +
      `Valid element IDs: ${[...validIds].slice(0, 20).join(", ")}. ` +
      `Sample elements:\n${sampleElements.join("\n")}\n` +
      `Important: IDs mentioned by discovery tools like find_element may be locator references, not current visible tags. ` +
      `Do not pass them directly into click_element/read_element unless they appear in the current Visible Elements list. ` +
      `This target may be hidden, inside a closed drawer or accordion, off-screen, or the page state may be stale. ` +
      `Reveal or refresh the relevant UI first, then retry with a currently visible tag. ` +
      `Use read_page, scroll_page, or click a control that reveals the target before retrying.`
    );
  };

  if (ELEMENT_ID_TOOLS.has(toolName)) {
    return checkId(args.id, "id");
  }
  if (ELEMENT_DUAL_ID_TOOLS.has(toolName)) {
    return (
      checkId(args.sourceId, "sourceId") ?? checkId(args.targetId, "targetId")
    );
  }
  return null;
}

export interface ElementIdPreDispatchDecision {
  error: string | null;
  logArgs: string;
  traceData: {
    toolName: string;
    requestedId: unknown;
    currentUrl: string | null;
    reason: "invalid_element_id_pre_dispatch";
  } | null;
}

export function assessElementIdPreDispatch(params: {
  toolName: string;
  args: Record<string, unknown>;
  snapshot: DomSnapshot | null;
  discoveredIds?: Set<number>;
  currentUrl: string | null;
}): ElementIdPreDispatchDecision {
  const error = validateElementIds(
    params.toolName,
    params.args,
    params.snapshot,
    params.discoveredIds,
  );
  return {
    error,
    logArgs: JSON.stringify(params.args).slice(0, 100),
    traceData: error
      ? {
          toolName: params.toolName,
          requestedId:
            typeof params.args.id === "number"
              ? params.args.id
              : (params.args.sourceId ?? params.args.targetId ?? null),
          currentUrl: params.currentUrl,
          reason: "invalid_element_id_pre_dispatch",
        }
      : null,
  };
}

/**
 * Extract tag IDs mentioned in tool results.
 * Tools report dynamic tags as [N] — e.g. find_element ("near [30] <td>"),
 * click interception ("covered by [34] <div>"). These tags exist in the
 * content script's tag map but may not be in the background's snapshot yet.
 */
export function extractDiscoveredTagIds(
  _toolName: string,
  result: string,
): number[] {
  const matches = result.matchAll(/\[(\d+)\]/g);
  return [...matches].map((m) => Number(m[1])).filter((n) => !isNaN(n));
}

/**
 * Format an ActionEffect into a human-readable injection message.
 * Returns null if no message should be injected (e.g., first snapshot).
 */
export function formatActionEffect(effect: ActionEffect): string | null {
  if (
    effect.deltaPercent < ACTION_EFFECT.ZERO_THRESHOLD &&
    !effect.urlChanged
  ) {
    return "[Action effect: No observable DOM change — page state appears unchanged.]";
  }
  const parts: string[] = [];
  const pct = Math.round(effect.deltaPercent * 100);
  parts.push(`${pct}% elements changed`);
  if (effect.urlChanged) parts.push("URL changed");
  if (effect.elementsAdded > 0) parts.push(`+${effect.elementsAdded} new`);
  if (effect.elementsRemoved > 0)
    parts.push(`-${effect.elementsRemoved} removed`);
  return `[Action effect: ${parts.join(", ")}]`;
}

export interface ZeroEffectDecision {
  kind: "none" | "warn" | "escalate";
  message?: string;
}

export function buildZeroEffectDecision(params: {
  consecutiveTurns: number;
  failureBrief?: string;
  warningThreshold: number;
  escalateThreshold: number;
}): ZeroEffectDecision {
  const {
    consecutiveTurns,
    failureBrief,
    warningThreshold,
    escalateThreshold,
  } = params;

  if (consecutiveTurns >= escalateThreshold) {
    return {
      kind: "escalate",
      message: failureBrief
        ? `[Verification: ${consecutiveTurns} consecutive actions had no observable effect.\n${failureBrief}\nEscalate or replan now instead of retrying the same approach.]`
        : `[Verification: ${consecutiveTurns} consecutive actions had no observable effect on the page. Escalate or replan now instead of retrying the same approach.]`,
    };
  }

  if (consecutiveTurns >= warningThreshold) {
    return {
      kind: "warn",
      message: failureBrief
        ? `[Verification: Your last action had no observable effect.\n${failureBrief}\nTry one different action. If the page still does not change, escalate or replan.]`
        : `[Verification: Your last action had no observable effect on the page. Try one different action. If the page still does not change, escalate or replan.]`,
    };
  }

  return { kind: "none" };
}

/**
 * Format an ActionEffect into structured evidence for the validateDone verifier.
 * Returns null if the effect is negligible (no meaningful DOM change).
 */
export function formatStateEvidence(effect: ActionEffect): string | null {
  if (effect.deltaPercent < 0.01 && !effect.urlChanged) return null;

  const lines: string[] = [];
  lines.push(
    `Elements: ${effect.prevCount} → ${effect.currentCount} (${effect.elementsAdded > 0 ? "+" + effect.elementsAdded : "0"} new, ${effect.elementsRemoved > 0 ? "-" + effect.elementsRemoved : "0"} removed)`,
  );
  lines.push(
    `Change: ${Math.round(effect.deltaPercent * 100)}% of page signatures changed`,
  );
  if (effect.urlChanged)
    lines.push(`URL changed: ${effect.prevUrl} → ${effect.currentUrl}`);

  if (effect.addedSignatures.length > 0) {
    lines.push("New elements appearing on page:");
    for (const sig of effect.addedSignatures) {
      const parts = sig.split(":");
      const tag = parts[0] || "";
      const text = parts[1] || "";
      const attrs = parts.slice(2).join(":") || "";
      const readable = text
        ? `${tag} "${text}"${attrs ? ` (${attrs})` : ""}`
        : tag;
      lines.push(`  + ${readable}`);
    }
  }
  return lines.join("\n");
}

export interface StepAdvanceSignal {
  matchedTokens: string[];
  reason: string;
}

export interface PendingAsyncChangeSignal {
  expectedTokens: string[];
  loadingIndicator: string | null;
  /** Loading keywords that were already present before the action (structural, not transient). */
  baselineLoadingKeywords: string[];
  reason: string;
}

export interface FormSubmissionResetSignal {
  reason: string;
  previousRecordId: string;
  currentRecordId: string;
  filledFieldsBeforeSubmit: number;
}

const STRUCTURAL_ADVANCE_TOOLS = new Set<string>([
  ToolName.CLICK_ELEMENT,
  ToolName.TYPE_TEXT,
  ToolName.SELECT_OPTION,
  ToolName.SET_CHECKBOX,
  ToolName.PRESS_KEY,
  ToolName.RIGHT_CLICK,
  ToolName.SCROLL_PAGE,
  ToolName.GO_BACK,
  ToolName.XRAY_PAGE,
  ToolName.DISMISS_OVERLAYS,
]);

const STEP_TOKEN_STOPWORDS = new Set([
  "the",
  "and",
  "then",
  "into",
  "with",
  "that",
  "this",
  "from",
  "your",
  "you",
  "are",
  "for",
  "step",
  "click",
  "type",
  "read",
  "find",
  "open",
  "close",
  "button",
  "input",
  "field",
  "section",
  "page",
  "next",
  "current",
  "visible",
  "order",
  "verify",
  "successfully",
  "requested",
  "result",
  "results",
  "value",
  "values",
  "there",
]);

const ASYNC_TRIGGER_TOOLS = new Set<string>([
  ToolName.CLICK_ELEMENT,
  ToolName.PRESS_KEY,
  ToolName.SELECT_OPTION,
  ToolName.SET_CHECKBOX,
  ToolName.RIGHT_CLICK,
  ToolName.HOVER_ELEMENT,
  ToolName.SCROLL_PAGE,
  ToolName.GO_BACK,
  ToolName.EXECUTE_JS,
]);

const ASYNC_INTENT_KEYWORDS = [
  "wait",
  "appears",
  "appear",
  "after click",
  "after the click",
  "after pressing",
  "after button click",
  "loaded",
  "loading",
  "load ",
  "reveal",
  "reveals",
  "show ",
  "shown",
  "becomes visible",
  "become visible",
  "generate",
  "fetch",
  "result appears",
  "dialog",
  "modal",
  "popup",
  "menu",
  "context menu",
  "confirmation",
  "confirm",
  "rename",
  "editor",
  "inline input",
  "scroll down",
  "load more",
  "lazy load",
  "feed",
  "more posts",
];

const LOADING_UI_KEYWORDS = [
  "loading",
  "please wait",
  "processing",
  "generating",
  "fetching",
  "working",
  "submitting",
];

const ASYNC_TOKEN_STOPWORDS = new Set([
  ...STEP_TOKEN_STOPWORDS,
  "wait",
  "loaded",
  "loading",
  "result",
  "appears",
  "appear",
  "visible",
  "content",
  "after",
  "click",
]);

const FORM_FINALIZING_CONTROL_RE =
  /\b(submit|save|create|insert|send|confirm|finish|place order|checkout)\b/i;
const FORM_SUBMISSION_CONTEXT_RE =
  /\b(submit|submission|submitted|save|saved|create|created|insert|record|form|confirmation|complete)\b/i;
const FORM_VALIDATION_ERROR_RE =
  /\b(error message|validation error|mandatory fields?\s+(?:are\s+)?not filled|required fields?|cannot be blank|must be filled|please fill|required value)\b/i;
const RECORD_ID_RE = /\b[A-Z]{2,}\d{4,}\b/g;

export function tokenizeStepText(stepText: string): string[] {
  return [
    ...new Set(stepText.toLowerCase().match(/[a-z0-9$@._-]{3,}/g) ?? []),
  ].filter((token) => !STEP_TOKEN_STOPWORDS.has(token));
}

export function snapshotSearchText(snapshot: DomSnapshot | null): string {
  if (!snapshot) return "";
  const elementText = snapshot.elements
    .flatMap((element) => [
      element.text,
      element.tagName,
      element.attributes.id,
      element.attributes.name,
      element.attributes.placeholder,
      element.attributes["aria-label"],
      element.attributes.label,
      element.attributes.value,
    ])
    .filter(Boolean)
    .join(" ");
  return [
    snapshot.title,
    snapshot.url,
    snapshot.pageContent,
    snapshot.visibleContent,
    elementText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function elementAttributeText(element: DomSnapshot["elements"][number]): string {
  return [
    element.text,
    element.tagName,
    element.role,
    element.attributes.id,
    element.attributes.name,
    element.attributes.type,
    element.attributes.value,
    element.attributes.selected,
    element.attributes.placeholder,
    element.attributes["aria-label"],
    element.attributes.title,
  ]
    .filter(Boolean)
    .join(" ");
}

function findToolTargetElement(
  snapshot: DomSnapshot | null | undefined,
  toolArgs: Record<string, unknown> | undefined,
): DomSnapshot["elements"][number] | null {
  if (!snapshot || !toolArgs) return null;
  const rawId = toolArgs.id;
  const tagId =
    typeof rawId === "number"
      ? rawId
      : typeof rawId === "string"
        ? Number(rawId)
        : NaN;
  if (!Number.isFinite(tagId)) return null;
  return snapshot.elements.find((element) => element.tag === tagId) ?? null;
}

function extractPrimaryRecordId(
  snapshot: DomSnapshot | null | undefined,
): string | null {
  if (!snapshot) return null;
  const titleRecordMatch = snapshot.title?.match(
    /\b(?:Create|New|Record)\s+([A-Z]{2,}\d+)\b/i,
  )?.[1];
  if (titleRecordMatch) return titleRecordMatch;

  const numberField = snapshot.elements.find((element) =>
    /\b(?:number|record_number)\b/i.test(
      `${element.attributes.id ?? ""} ${element.attributes.name ?? ""}`,
    ),
  );
  const numberValue = [numberField?.attributes.value, numberField?.text].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const numberMatch = numberValue?.match(RECORD_ID_RE)?.[0];
  if (numberMatch) return numberMatch;

  return (
    [snapshot.title, snapshot.pageContent, snapshot.visibleContent]
      .filter(Boolean)
      .join(" ")
      .match(RECORD_ID_RE)?.[0] ?? null
  );
}

function hasCreateRecordTitle(
  snapshot: DomSnapshot | null | undefined,
  recordId: string,
): boolean {
  if (!snapshot?.title || !recordId) return false;
  const escapedRecordId = recordId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b(?:Create|New)\\s+${escapedRecordId}\\b`, "i").test(
    snapshot.title,
  );
}

function getUserEnteredFormValue(
  element: DomSnapshot["elements"][number],
): string {
  const attrs = element.attributes;
  const fieldName = `${attrs.id ?? ""} ${attrs.name ?? ""}`.toLowerCase();
  if (!fieldName) return "";
  if (/\b(search|typeahead|filter|query)\b/.test(fieldName)) return "";
  if (/\b(?:^|[._-])number\b/.test(fieldName)) return "";

  const type = String(attrs.type ?? "").toLowerCase();
  if (["button", "submit", "hidden", "radio", "checkbox"].includes(type)) {
    return "";
  }

  if (element.tagName.toLowerCase() === "select") {
    const selected = String(attrs.selected ?? "").trim();
    return selected && !/^--\s*none\s*--$/i.test(selected) ? selected : "";
  }

  const value = String(attrs.value ?? element.text ?? "").trim();
  const placeholder = String(attrs.placeholder ?? "").trim();
  if (!value || value === placeholder) return "";
  if (/^(search|related search|resolved)$/i.test(value)) return "";
  return value;
}

function countUserEnteredFormValues(
  snapshot: DomSnapshot | null | undefined,
): number {
  if (!snapshot) return 0;
  return snapshot.elements.filter((element) => getUserEnteredFormValue(element))
    .length;
}

/**
 * Detect record-creation UIs that signal a successful submit by resetting from a
 * populated "Create ABC123" form to the next blank "Create ABC124" form.
 */
export function detectFormSubmissionResetSuccess(params: {
  currentStepDescription: string;
  currentStepSuccessCriteria?: string;
  preActionSnapshot?: DomSnapshot | null;
  currentSnapshot: DomSnapshot | null;
  actionEffect: ActionEffect | null;
  toolName: string;
  toolArgs?: Record<string, unknown>;
}): FormSubmissionResetSignal | null {
  const {
    currentStepDescription,
    currentStepSuccessCriteria,
    preActionSnapshot,
    currentSnapshot,
    actionEffect,
    toolName,
    toolArgs,
  } = params;
  if (!preActionSnapshot || !currentSnapshot || !actionEffect) return null;
  if (
    toolName !== ToolName.CLICK_ELEMENT &&
    toolName !== ToolName.PRESS_KEY &&
    toolName !== ToolName.CONFIGURE_SERVICENOW_FORM
  ) {
    return null;
  }

  const stepText = `${currentStepDescription}\n${currentStepSuccessCriteria ?? ""}`;
  if (!FORM_SUBMISSION_CONTEXT_RE.test(stepText)) return null;

  if (toolName === ToolName.CLICK_ELEMENT) {
    const target = findToolTargetElement(preActionSnapshot, toolArgs);
    if (
      !target ||
      !FORM_FINALIZING_CONTROL_RE.test(elementAttributeText(target))
    ) {
      return null;
    }
  } else if (
    toolName === ToolName.CONFIGURE_SERVICENOW_FORM &&
    toolArgs?.submit !== true
  ) {
    return null;
  }

  const materiallyChanged =
    actionEffect.urlChanged ||
    actionEffect.deltaPercent >= ACTION_EFFECT.ZERO_THRESHOLD;
  if (!materiallyChanged) return null;

  const beforeRecordId = extractPrimaryRecordId(preActionSnapshot);
  const afterRecordId = extractPrimaryRecordId(currentSnapshot);
  if (!beforeRecordId || !afterRecordId || beforeRecordId === afterRecordId) {
    return null;
  }
  if (
    !hasCreateRecordTitle(preActionSnapshot, beforeRecordId) ||
    !hasCreateRecordTitle(currentSnapshot, afterRecordId)
  ) {
    return null;
  }

  const beforeFilledCount = countUserEnteredFormValues(preActionSnapshot);
  const afterFilledCount = countUserEnteredFormValues(currentSnapshot);
  if (beforeFilledCount < 2 || afterFilledCount >= beforeFilledCount) {
    return null;
  }

  const afterText = snapshotSearchText(currentSnapshot);
  if (FORM_VALIDATION_ERROR_RE.test(afterText)) return null;
  if (!/\b(create|new record)\b/i.test(afterText)) return null;

  return {
    previousRecordId: beforeRecordId,
    currentRecordId: afterRecordId,
    filledFieldsBeforeSubmit: beforeFilledCount,
    reason:
      `Submit advanced from populated record ${beforeRecordId} to fresh ` +
      `record form ${afterRecordId}; treating the prior record submission as complete.`,
  };
}

export function shouldTrackFormSubmissionReset(params: {
  currentStepDescription: string;
  currentStepSuccessCriteria?: string;
  preActionSnapshot?: DomSnapshot | null;
  toolName: string;
  toolArgs?: Record<string, unknown>;
}): boolean {
  const {
    currentStepDescription,
    currentStepSuccessCriteria,
    preActionSnapshot,
    toolName,
    toolArgs,
  } = params;
  if (!preActionSnapshot) return false;
  if (
    toolName !== ToolName.CLICK_ELEMENT &&
    toolName !== ToolName.PRESS_KEY &&
    toolName !== ToolName.CONFIGURE_SERVICENOW_FORM
  ) {
    return false;
  }
  const stepText = `${currentStepDescription}\n${currentStepSuccessCriteria ?? ""}`;
  if (!FORM_SUBMISSION_CONTEXT_RE.test(stepText)) return false;

  if (toolName === ToolName.CLICK_ELEMENT) {
    const target = findToolTargetElement(preActionSnapshot, toolArgs);
    if (
      !target ||
      !FORM_FINALIZING_CONTROL_RE.test(elementAttributeText(target))
    ) {
      return false;
    }
  } else if (
    toolName === ToolName.CONFIGURE_SERVICENOW_FORM &&
    toolArgs?.submit !== true
  ) {
    return false;
  }

  const beforeRecordId = extractPrimaryRecordId(preActionSnapshot);
  if (!beforeRecordId || !hasCreateRecordTitle(preActionSnapshot, beforeRecordId)) {
    return false;
  }

  return countUserEnteredFormValues(preActionSnapshot) >= 2;
}

export function detectTrustedFormFillStepCompletion(params: {
  toolName: string;
  toolArgs?: Record<string, unknown>;
  toolResult: string;
}): { reason: string; matchedTokens: string[] } | null {
  const { toolName, toolArgs, toolResult } = params;
  if (toolName !== ToolName.CONFIGURE_SERVICENOW_FORM) return null;
  if (toolArgs?.submit === true) return null;

  const fields = Array.isArray(toolArgs?.fields) ? toolArgs.fields : [];
  if (fields.length === 0) return null;

  if (!toolResult.startsWith("Configured ServiceNow form.")) return null;
  if (
    toolResult.includes("Mismatches:") ||
    toolResult.includes("ServiceNow form configuration incomplete.") ||
    toolResult.startsWith("Error:")
  ) {
    return null;
  }

  const configuredRows = [
    ...toolResult.matchAll(/^- .+\([^)]+\) = /gm),
  ].length;
  if (configuredRows < fields.length) return null;

  return {
    reason:
      `Trusted form helper configured ${configuredRows} requested ` +
      `field${configuredRows === 1 ? "" : "s"} without mismatches.`,
    matchedTokens: ["Configured ServiceNow form", `${configuredRows} fields`],
  };
}

export function detectTrustedFormSubmitCompletion(params: {
  toolName: string;
  toolArgs?: Record<string, unknown>;
  toolResult: string;
}): { reason: string; matchedTokens: string[]; submittedRecord: string } | null {
  const { toolName, toolArgs, toolResult } = params;
  if (toolName !== ToolName.CONFIGURE_SERVICENOW_FORM) return null;
  if (toolArgs?.submit !== true) return null;

  const submittedRecord =
    toolResult.match(/\bSubmitted ServiceNow form record:\s*([A-Z]{2,}\d+)\b/i)?.[1] ??
    "";
  if (!submittedRecord) return null;

  if (!toolResult.startsWith("Configured ServiceNow form.")) return null;
  if (
    toolResult.includes("Mismatches:") ||
    toolResult.includes("ServiceNow form configuration incomplete.") ||
    toolResult.startsWith("Error:")
  ) {
    return null;
  }
  if (!/\bClicked submit control:/i.test(toolResult)) return null;

  return {
    reason: `Trusted ServiceNow form helper submitted record ${submittedRecord.toUpperCase()}.`,
    matchedTokens: [
      "Configured ServiceNow form",
      "Clicked submit control",
      "Submitted ServiceNow form record",
      submittedRecord.toUpperCase(),
    ],
    submittedRecord: submittedRecord.toUpperCase(),
  };
}

export interface SuccessCriteriaResult {
  satisfied: boolean;
  matchedTokens: string[];
  totalTokens: number;
  matchedQuotedPhrases: string[];
  requiredQuotedPhrases: string[];
  matchedNamedPhrases: string[];
  requiredNamedPhrases: string[];
  matchedNumbers: string[];
  requiredNumbers: string[];
}

function extractQuotedPhrases(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/["']([^"']{3,120})["']/g)]
        .map((match) => match[1]?.trim().toLowerCase())
        .filter((value): value is string => !!value),
    ),
  ];
}

function extractNumericLiterals(text: string): string[] {
  return [
    ...new Set(
      text
        .match(/\b\d[\d,./-]*\b/g)
        ?.map((value) => value.trim().toLowerCase())
        .filter((value) => value.length >= 2) ?? [],
    ),
  ];
}

function extractNamedPhrases(text: string): string[] {
  const blacklist = new Set([
    "page",
    "step",
    "task",
    "goal",
    "done",
    "final",
    "answer",
    "confirmation",
  ]);

  return [
    ...new Set(
      (
        text.match(
          /\b(?:[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}|[A-Z]{2,}(?:\s+[A-Z][a-z]+){0,3})\b/g,
        ) ?? []
      )
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length >= 4)
        .filter((value) => !blacklist.has(value)),
    ),
  ];
}

/**
 * Check whether success criteria tokens are present in the current DOM snapshot.
 * Steps without successCriteria always pass (satisfied: true).
 */
export function matchSuccessCriteria(params: {
  successCriteria: string | undefined;
  snapshot: DomSnapshot | null;
}): SuccessCriteriaResult {
  const { successCriteria, snapshot } = params;
  if (!successCriteria || successCriteria.trim().length === 0) {
    return {
      satisfied: true,
      matchedTokens: [],
      totalTokens: 0,
      matchedQuotedPhrases: [],
      requiredQuotedPhrases: [],
      matchedNamedPhrases: [],
      requiredNamedPhrases: [],
      matchedNumbers: [],
      requiredNumbers: [],
    };
  }
  const tokens = tokenizeStepText(successCriteria);
  const requiredQuotedPhrases = extractQuotedPhrases(successCriteria);
  const requiredNamedPhrases = extractNamedPhrases(successCriteria).filter(
    (phrase) => !requiredQuotedPhrases.includes(phrase),
  );
  const requiredNumbers = extractNumericLiterals(successCriteria);
  if (tokens.length === 0) {
    return {
      satisfied: true,
      matchedTokens: [],
      totalTokens: 0,
      matchedQuotedPhrases: [],
      requiredQuotedPhrases,
      matchedNamedPhrases: [],
      requiredNamedPhrases,
      matchedNumbers: [],
      requiredNumbers,
    };
  }
  const searchText = snapshotSearchText(snapshot);
  const matched = tokens.filter((token) => searchText.includes(token));
  const matchedQuotedPhrases = requiredQuotedPhrases.filter((phrase) =>
    searchText.includes(phrase),
  );
  const matchedNamedPhrases = requiredNamedPhrases.filter((phrase) =>
    searchText.includes(phrase),
  );
  const matchedNumbers = requiredNumbers.filter((value) =>
    searchText.includes(value),
  );
  const threshold = Math.max(1, Math.ceil(tokens.length * 0.4));
  const quotesSatisfied =
    requiredQuotedPhrases.length === 0 ||
    matchedQuotedPhrases.length === requiredQuotedPhrases.length;
  const namesSatisfied =
    requiredNamedPhrases.length === 0 ||
    matchedNamedPhrases.length === requiredNamedPhrases.length;
  const numbersSatisfied =
    requiredNumbers.length === 0 ||
    matchedNumbers.length === requiredNumbers.length;
  return {
    satisfied:
      matched.length >= threshold &&
      quotesSatisfied &&
      namesSatisfied &&
      numbersSatisfied,
    matchedTokens: matched,
    totalTokens: tokens.length,
    matchedQuotedPhrases,
    requiredQuotedPhrases,
    matchedNamedPhrases,
    requiredNamedPhrases,
    matchedNumbers,
    requiredNumbers,
  };
}

function tokenizeAsyncExpectationText(text: string): string[] {
  return [
    ...new Set(text.toLowerCase().match(/[a-z0-9$@._-]{2,}/g) ?? []),
  ].filter((token) => !ASYNC_TOKEN_STOPWORDS.has(token));
}

function findLoadingIndicator(snapshot: DomSnapshot | null): string | null {
  const searchText = snapshotSearchText(snapshot);
  return (
    LOADING_UI_KEYWORDS.find((keyword) => searchText.includes(keyword)) ?? null
  );
}

function findAllLoadingKeywords(snapshot: DomSnapshot | null): string[] {
  const searchText = snapshotSearchText(snapshot);
  return LOADING_UI_KEYWORDS.filter((keyword) => searchText.includes(keyword));
}

function matchStepTokens(
  stepText: string,
  snapshot: DomSnapshot | null,
): string[] {
  const searchText = snapshotSearchText(snapshot);
  return tokenizeStepText(stepText).filter((token) =>
    searchText.includes(token),
  );
}

export function detectStructuralStepAdvance(params: {
  currentStepDescription: string;
  currentStepSuccessCriteria?: string;
  nextStepDescription?: string;
  currentSnapshot: DomSnapshot | null;
  actionEffect: ActionEffect | null;
  toolName: string;
}): StepAdvanceSignal | null {
  const {
    currentStepDescription,
    currentStepSuccessCriteria,
    nextStepDescription,
    currentSnapshot,
    actionEffect,
    toolName,
  } = params;

  if (!nextStepDescription || !currentSnapshot || !actionEffect) return null;
  if (!STRUCTURAL_ADVANCE_TOOLS.has(toolName)) return null;

  const materiallyChanged =
    actionEffect.urlChanged ||
    actionEffect.deltaPercent >= ACTION_EFFECT.ZERO_THRESHOLD;
  if (!materiallyChanged) return null;

  const currentMatches = matchStepTokens(
    currentStepDescription,
    currentSnapshot,
  );
  const successMatches = currentStepSuccessCriteria
    ? matchStepTokens(currentStepSuccessCriteria, currentSnapshot)
    : [];
  const nextMatches = matchStepTokens(nextStepDescription, currentSnapshot);

  const hasCurrentSuccessEvidence =
    successMatches.length >= 2 ||
    (successMatches.length >= 1 && currentMatches.length >= 1);
  if (!hasCurrentSuccessEvidence) return null;

  const hasDistinctNextEvidence = nextMatches.some(
    (token) => !currentMatches.includes(token),
  );
  if (nextMatches.length >= 2 && hasDistinctNextEvidence) {
    const evidence = [...new Set([...successMatches, ...nextMatches])];
    return {
      matchedTokens: evidence,
      reason:
        `Current step now appears satisfied and exposed the next planned step: ` +
        evidence.slice(0, 4).join(", "),
    };
  }

  return null;
}

export function isPendingAsyncChangeSatisfied(params: {
  snapshot: DomSnapshot | null;
  expectedTokens: string[];
  /** Loading keywords that existed before the action — these are structural and should be ignored. */
  baselineLoadingKeywords?: string[];
}): boolean {
  const { snapshot, expectedTokens, baselineLoadingKeywords = [] } = params;
  if (!snapshot) return false;
  // Only block on loading indicators that are NEW (not structural).
  // A keyword present before the action (e.g. LinkedIn's permanent "loading"
  // in lazy-load containers) is structural and should not prevent satisfaction.
  const currentLoading = findLoadingIndicator(snapshot);
  if (currentLoading && !baselineLoadingKeywords.includes(currentLoading)) {
    return false;
  }
  if (expectedTokens.length === 0) return false;
  const searchText = snapshotSearchText(snapshot);
  const matched = expectedTokens.filter((token) => searchText.includes(token));
  const threshold =
    expectedTokens.length >= 4 ? 2 : Math.min(1, expectedTokens.length);
  return matched.length >= threshold;
}

export function detectPendingAsyncChange(params: {
  currentStepDescription: string;
  currentStepSuccessCriteria?: string;
  currentSnapshot: DomSnapshot | null;
  /** Snapshot captured before tool execution — used to distinguish structural vs transient loading indicators. */
  preActionSnapshot?: DomSnapshot | null;
  actionEffect: ActionEffect | null;
  toolName: string;
}): PendingAsyncChangeSignal | null {
  const {
    currentStepDescription,
    currentStepSuccessCriteria,
    currentSnapshot,
    preActionSnapshot,
    actionEffect,
    toolName,
  } = params;
  if (!currentSnapshot || !actionEffect) return null;
  if (!ASYNC_TRIGGER_TOOLS.has(toolName)) return null;

  // Identify loading keywords that existed before the action (structural).
  const baselineLoadingKeywords = findAllLoadingKeywords(preActionSnapshot ?? null);

  const combinedText =
    `${currentStepDescription}\n${currentStepSuccessCriteria ?? ""}`.toLowerCase();
  const postLoadingIndicator = findLoadingIndicator(currentSnapshot);
  // A loading indicator is only "new" if it wasn't present before the action.
  const newLoadingIndicator =
    postLoadingIndicator && !baselineLoadingKeywords.includes(postLoadingIndicator)
      ? postLoadingIndicator
      : null;
  const hasAsyncIntent =
    newLoadingIndicator !== null ||
    ASYNC_INTENT_KEYWORDS.some((keyword) => combinedText.includes(keyword));
  if (!hasAsyncIntent) return null;

  const materiallyChanged =
    actionEffect.urlChanged ||
    actionEffect.deltaPercent >= ACTION_EFFECT.ZERO_THRESHOLD;
  if (!materiallyChanged && !newLoadingIndicator) return null;

  const expectedTokens = tokenizeAsyncExpectationText(
    currentStepSuccessCriteria || currentStepDescription,
  ).slice(0, 8);
  if (
    isPendingAsyncChangeSatisfied({
      snapshot: currentSnapshot,
      expectedTokens,
      baselineLoadingKeywords,
    })
  ) {
    return null;
  }

  return {
    expectedTokens,
    loadingIndicator: newLoadingIndicator,
    baselineLoadingKeywords,
    reason: newLoadingIndicator
      ? `The page is still showing "${newLoadingIndicator}", so the result of the last action is still pending.`
      : "The current step expects content to appear after the last action, but the result is not visible yet.",
  };
}

/** Tools that require a pre-action feasibility check on the target element. */
export const PREFLIGHT_CHECK_TOOLS = new Set<string>([
  ToolName.CLICK_ELEMENT,
  ToolName.TYPE_TEXT,
  ToolName.HOVER_ELEMENT,
  ToolName.SELECT_OPTION,
  ToolName.DRAG_AND_DROP,
  ToolName.UPLOAD_FILE,
  ToolName.RIGHT_CLICK,
  ToolName.SET_CHECKBOX,
]);

/**
 * Pre-action feasibility check: validates element interactability beyond just ID existence.
 * Returns { error, warning } — error is a hard block, warning is informational.
 */
export function preflightElementCheck(
  toolName: string,
  args: Record<string, unknown>,
  snapshot: DomSnapshot | null,
): { error: string | null; warning: string | null } {
  if (!snapshot || !PREFLIGHT_CHECK_TOOLS.has(toolName)) {
    return { error: null, warning: null };
  }

  // Resolve the element ID(s) to check
  const ids: Array<{ id: number; param: string }> = [];
  if (args.id != null) ids.push({ id: Number(args.id), param: "id" });
  if (args.sourceId != null)
    ids.push({ id: Number(args.sourceId), param: "sourceId" });
  if (args.targetId != null)
    ids.push({ id: Number(args.targetId), param: "targetId" });

  for (const { id, param } of ids) {
    if (isNaN(id)) continue;
    const el = snapshot.elements.find((e) => e.tag === id);
    if (!el) continue; // validateElementIds handles missing elements

    if (el.isDisabled) {
      return {
        error: `Error: Element [${id}] (${param}) is disabled and cannot be interacted with. Find an alternative or wait for it to become enabled.`,
        warning: null,
      };
    }
    if (el.rect.width === 0 && el.rect.height === 0) {
      return {
        error: `Error: Element [${id}] (${param}) has zero size (0×0) and cannot be clicked.`,
        warning: null,
      };
    }
    if (!el.isVisible) {
      return {
        error: null,
        warning: `Warning: Element [${id}] (${param}) is not visible in the viewport. Consider scrolling to it first, or it may be hidden.`,
      };
    }
  }
  return { error: null, warning: null };
}

export interface PreflightElementDecision {
  error: string | null;
  warning: string | null;
}

export function assessPreflightElement(params: {
  toolName: string;
  args: Record<string, unknown>;
  snapshot: DomSnapshot | null;
}): PreflightElementDecision {
  return preflightElementCheck(
    params.toolName,
    params.args,
    params.snapshot,
  );
}

/** Tracks a recent successful tool call for redundant action detection */
export interface RecentAction {
  tool: string;
  args: string; // First 100 chars of JSON args
  result: string; // Full result string (used as cached return on redundant action block)
  /** Snapshot fingerprint (url|elementCount) at time of action — for outcome-aware comparison */
  snapshotFingerprint: string;
}

/** Tracks a failed tool call to prevent exact repeats */
export interface BlockedAction {
  tool: string;
  argsKey: string; // First 100 chars of JSON args for matching
  error: string; // First 80 chars of error
  turn: number;
}

/** Check if the same tool+args already failed. Returns the prior failure or null. */
export function findPriorFailure(
  blockedActions: BlockedAction[],
  tool: string,
  argsKey: string,
): BlockedAction | null {
  return (
    blockedActions.find((f) => f.tool === tool && f.argsKey === argsKey) ?? null
  );
}

/** Build contextual recovery suggestions based on the error message. */
export function buildFailureRecovery(error: string): string {
  const coverMatch = error.match(/covered by (?:overlay )?\[(\d+)\]/);
  if (coverMatch) {
    return `Suggestions: hide_element(${coverMatch[1]}) to remove covering element, execute_js to click programmatically, or scroll_page.`;
  }
  if (
    error.includes("No element with tag") ||
    error.includes("does not exist")
  ) {
    return `Suggestions: read_page to refresh element IDs, or find_element to locate by text.`;
  }
  return `Choose a different approach — try a different element ID, different tool, or read_page to reassess.`;
}

export interface FailedActionRepeatBlock {
  priorTurn: number;
  message: string;
}

export function assessFailedActionRepeat(params: {
  blockedActions: BlockedAction[];
  tool: string;
  argsKey: string;
}): FailedActionRepeatBlock | null {
  const priorFail = findPriorFailure(
    params.blockedActions,
    params.tool,
    params.argsKey,
  );
  if (!priorFail) return null;

  return {
    priorTurn: priorFail.turn,
    message:
      `Error: This exact action already failed at turn ${priorFail.turn} with: '${priorFail.error}'. ` +
      buildFailureRecovery(priorFail.error),
  };
}

export interface ReadElementNudgeState {
  lastReadElementId: number | null;
  consecutiveReadElementSameId: number;
}

export interface ReadElementSameIdNudgeDecision {
  state: ReadElementNudgeState;
  nudge:
    | {
        elementId: number;
        consecutive: number;
        message: string;
      }
    | null;
}

export function assessReadElementSameIdNudge(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  state: ReadElementNudgeState;
}): ReadElementSameIdNudgeDecision {
  const { toolName, args, state } = params;
  if (toolName !== ToolName.READ_ELEMENT) {
    return {
      state: {
        lastReadElementId: null,
        consecutiveReadElementSameId: 0,
      },
      nudge: null,
    };
  }

  const elemId = typeof args.id === "number" ? args.id : Number(args.id);
  if (elemId !== state.lastReadElementId) {
    return {
      state: {
        lastReadElementId: elemId,
        consecutiveReadElementSameId: 0,
      },
      nudge: null,
    };
  }

  const consecutiveReadElementSameId = state.consecutiveReadElementSameId + 1;
  const consecutive = consecutiveReadElementSameId + 1;
  return {
    state: {
      lastReadElementId: elemId,
      consecutiveReadElementSameId,
    },
    nudge:
      consecutiveReadElementSameId >= 2
        ? {
            elementId: elemId,
            consecutive,
            message:
              `You have called read_element on element [${elemId}] ${consecutive} times. ` +
              `Try a different approach: click_element to interact with it, read_page for full page context, or find_element to locate a different target.`,
          }
        : null,
  };
}

export interface ToolCacheHitDecision {
  cacheType: CacheType | undefined;
  cachedResult: string | null;
}

export function assessToolCacheHit(params: {
  toolName: ToolName;
  args: Record<string, unknown>;
  snapshot: DomSnapshot | null | undefined;
  toolCache: ToolResultCache;
}): ToolCacheHitDecision {
  const cacheType = CACHEABLE_TOOLS.get(params.toolName);
  if (!cacheType) {
    return { cacheType, cachedResult: null };
  }

  const cacheKey = ToolResultCache.key(params.toolName, params.args);
  const fingerprint = getSnapshotFingerprint(params.snapshot ?? null);
  return {
    cacheType,
    cachedResult: params.toolCache.get(cacheKey, fingerprint),
  };
}

export interface RedundantSuccessBlock {
  count: number;
  result: string;
}

export function assessRedundantSuccessBlock(params: {
  recentSuccesses: RecentAction[];
  toolName: ToolName;
  argsKey: string;
  snapshot: DomSnapshot | null | undefined;
  blockThreshold: number;
}): RedundantSuccessBlock | null {
  const fingerprint = getSnapshotFingerprint(params.snapshot ?? null);
  const sameCount = params.recentSuccesses.filter(
    (entry) =>
      entry.tool === params.toolName &&
      entry.args === params.argsKey &&
      entry.snapshotFingerprint === fingerprint,
  ).length;
  if (sameCount < params.blockThreshold) return null;

  const lastMatch = params.recentSuccesses.findLast(
    (entry) =>
      entry.tool === params.toolName &&
      entry.args === params.argsKey &&
      entry.snapshotFingerprint === fingerprint,
  );
  if (!lastMatch) return null;

  return {
    count: sameCount,
    result: lastMatch.result,
  };
}

export type RecentSuccessTrackingDecision =
  | { kind: "none" }
  | {
      kind: "redundant_nudge";
      sameStateCount: number;
      totalRepeatCount: number;
      message: string;
    }
  | {
      kind: "tool_name_pattern";
      toolNameCount: number;
      message: string;
    };

export function recordRecentSuccessfulAction(params: {
  recentSuccesses: RecentAction[];
  toolName: ToolName;
  argsKey: string;
  resultContent: string;
  snapshot: DomSnapshot | null | undefined;
  windowSize: number;
  infoThreshold: number;
  toolNameInfoThreshold: number;
}): RecentSuccessTrackingDecision {
  const isSuccess =
    !params.resultContent.startsWith("Error:") &&
    !params.resultContent.includes("does not appear to be") &&
    !params.resultContent.includes("No element with tag") &&
    !params.resultContent.includes("Click intercepted") &&
    !params.resultContent.includes("REJECTED");
  if (!isSuccess) return { kind: "none" };

  const actionFingerprint = getSnapshotFingerprint(params.snapshot ?? null);
  params.recentSuccesses.push({
    tool: params.toolName,
    args: params.argsKey,
    result: params.resultContent,
    snapshotFingerprint: actionFingerprint,
  });
  if (params.recentSuccesses.length > params.windowSize) {
    params.recentSuccesses.shift();
  }

  const sameStateCount = params.recentSuccesses.filter(
    (entry) =>
      entry.tool === params.toolName &&
      entry.args === params.argsKey &&
      entry.snapshotFingerprint === actionFingerprint,
  ).length;
  const totalRepeatCount = params.recentSuccesses.filter(
    (entry) => entry.tool === params.toolName && entry.args === params.argsKey,
  ).length;

  if (sameStateCount >= params.infoThreshold) {
    params.recentSuccesses.length = 0;
    return {
      kind: "redundant_nudge",
      sameStateCount,
      totalRepeatCount,
      message: `Note: You have called ${params.toolName} ${sameStateCount} times with similar arguments and the page appears unchanged each time. Consider whether a different approach might be more effective.`,
    };
  }

  const toolNameCount = params.recentSuccesses.filter(
    (entry) => entry.tool === params.toolName,
  ).length;
  if (toolNameCount >= params.toolNameInfoThreshold) {
    params.recentSuccesses.length = 0;
    return {
      kind: "tool_name_pattern",
      toolNameCount,
      message: `Note: You have used ${params.toolName} ${toolNameCount} times in recent turns. If your current approach isn't yielding results, a different strategy might help.`,
    };
  }

  return { kind: "none" };
}

export interface ToolResultTurnCounts {
  turnSuccesses: number;
  turnFailures: number;
}

export function countTrailingToolResultOutcomes(
  messages: Array<{ role: string; content?: unknown }>,
): ToolResultTurnCounts {
  let turnSuccesses = 0;
  let turnFailures = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "tool") break;
    const content = typeof message.content === "string" ? message.content : "";
    if (
      content.startsWith("Error:") ||
      content.includes("does not appear to be") ||
      content.includes("No element with tag") ||
      content.includes("Click intercepted")
    ) {
      turnFailures++;
    } else {
      turnSuccesses++;
    }
  }
  return { turnSuccesses, turnFailures };
}

export function updateConsecutiveAllFailTurns(params: {
  previousCount: number;
  turnSuccesses: number;
  turnFailures: number;
}): number {
  return params.turnFailures > 0 && params.turnSuccesses === 0
    ? params.previousCount + 1
    : 0;
}

export type SameToolFailureTrackingDecision =
  | { kind: "none"; count: number }
  | { kind: "warn"; count: number; message: string }
  | { kind: "exit"; count: number; message: string };

export function updateSameToolFailureTracking(params: {
  blockedActions: BlockedAction[];
  toolFailCounts: Map<string, number>;
  toolName: ToolName;
  argsKey: string;
  resultContent: string;
  turn: number;
  bufferSize: number;
  warnThreshold: number;
  exitThreshold: number;
}): SameToolFailureTrackingDecision {
  const isFail =
    params.resultContent.startsWith("Error:") ||
    params.resultContent.includes("does not appear to be") ||
    params.resultContent.includes("No element with tag") ||
    params.resultContent.includes("Click intercepted");
  const failKey = `${params.toolName}:${params.argsKey}`;

  if (!isFail) {
    params.toolFailCounts.delete(failKey);
    return { kind: "none", count: 0 };
  }

  params.blockedActions.push({
    tool: params.toolName,
    argsKey: params.argsKey,
    error: params.resultContent.split("\n")[0].slice(0, 80),
    turn: params.turn,
  });
  if (params.blockedActions.length > params.bufferSize) {
    params.blockedActions.shift();
  }

  const count = (params.toolFailCounts.get(failKey) || 0) + 1;
  params.toolFailCounts.set(failKey, count);

  if (count >= params.exitThreshold) {
    return {
      kind: "exit",
      count,
      message: `The same tool call (${params.toolName}) has failed ${count} times with the same arguments. The agent is stuck in a loop. Send a follow-up with different instructions.`,
    };
  }

  if (count === params.warnThreshold) {
    return {
      kind: "warn",
      count,
      message: `WARNING: ${params.toolName} has failed ${count} times with similar arguments. Stop repeating this approach. Try a fundamentally different strategy — use a different tool, different element, or scroll/navigate to find an alternative path.`,
    };
  }

  return { kind: "none", count };
}

export type ExplorationBudgetDecision =
  | { consecutiveTurns: number; message: null }
  | { consecutiveTurns: number; message: string };

export function updateExplorationBudget(params: {
  previousCount: number;
  toolNames: string[];
  explorationOnlyTools: Set<string>;
  maxConsecutive: number;
}): ExplorationBudgetDecision {
  const allDiscovery = params.toolNames.every((toolName) =>
    params.explorationOnlyTools.has(toolName),
  );
  if (!allDiscovery) return { consecutiveTurns: 0, message: null };

  const consecutiveTurns = params.previousCount + 1;
  if (consecutiveTurns < params.maxConsecutive) {
    return { consecutiveTurns, message: null };
  }

  return {
    consecutiveTurns,
    message:
      `You've spent ${consecutiveTurns} consecutive turns only reading/inspecting without acting. ` +
      "Use what you've gathered - click, type, scroll, navigate - or escalate if stuck.",
  };
}

/**
 * Normalize a tool result into a fingerprint for dead-end detection.
 * Strips variable parts (IDs, numbers) so different-but-equivalent errors match.
 */
export function normalizeOutcome(result: string): string {
  return result
    .replace(/\[(\d+)\]/g, "«$1»") // protect [N] element refs
    .replace(/\b\d+\b/g, "N") // normalize other numbers
    .replace(/«(\d+)»/g, "[$1]") // restore element refs
    .slice(0, 120)
    .trim();
}

/** Simple djb2 hash for short strings. */
export function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

/**
 * Compute a fingerprint from the current snapshot for outcome-aware redundancy checks.
 * Includes a text hash so that text-only changes (e.g. counter "3 more" → "2 more")
 * register as a different page state even when URL and element count stay the same.
 */
export function getSnapshotFingerprint(
  snapshot: {
    url?: string;
    elements?: { length: number };
    visibleContent?: string;
    pageContent?: string;
  } | null,
): string {
  if (!snapshot) return "none|0|0";
  const text = (
    snapshot.pageContent ??
    snapshot.visibleContent ??
    ""
  ).replace(/\s+/g, " ");
  const textSample =
    text.length <= 900
      ? text
      : `${text.slice(0, 300)}|${text.slice(Math.max(0, text.length - 600))}`;
  return `${snapshot.url ?? "unknown"}|${snapshot.elements?.length ?? 0}|${text.length}|${djb2(textSample)}`;
}

/**
 * Build a clear, selector-based briefing for the executor model at plan-then-act handoff.
 * Extracts element references from the planner model's tool calls and resolves them
 * to human-readable selectors so the executor model knows exactly which elements matter.
 */
export function buildHandoffBriefing(
  history: LLMMessage[],
  snapshot: DomSnapshot | null,
): string {
  const parts: string[] = [];

  // 1. Extract the planner model's reasoning text (last assistant text content)
  let reasoning = "";
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (
      msg.role === "assistant" &&
      typeof msg.content === "string" &&
      msg.content.trim()
    ) {
      reasoning = stripThinkTags(msg.content).trim().slice(0, 500);
      break;
    }
  }
  if (reasoning) {
    parts.push(`Planner model observations:\n${reasoning}`);
  }

  // 2. Extract all element IDs referenced in the last few assistant tool calls
  if (snapshot && snapshot.elements.length > 0) {
    const elementMap = new Map(snapshot.elements.map((el) => [el.tag, el]));
    const referencedIds = new Map<number, string>(); // id → action taken

    // Walk the last several messages to find tool calls from the planner model
    const recentAssistants = history
      .filter(
        (m) =>
          m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0,
      )
      .slice(-4); // last 4 assistant turns with tool calls

    for (const msg of recentAssistants) {
      for (const tc of msg.tool_calls!) {
        try {
          const args = JSON.parse(tc.function.arguments);
          const ids: number[] = [];
          if (args.id != null) ids.push(Number(args.id));
          if (args.sourceId != null) ids.push(Number(args.sourceId));
          if (args.targetId != null) ids.push(Number(args.targetId));

          for (const id of ids) {
            if (!isNaN(id) && !referencedIds.has(id)) {
              referencedIds.set(id, tc.function.name);
            }
          }
        } catch {
          /* skip unparseable args */
        }
      }
    }

    // Build element descriptions
    if (referencedIds.size > 0) {
      const lines: string[] = [];
      for (const [id, action] of referencedIds) {
        const el = elementMap.get(id);
        if (!el) continue;
        // CSS-like selector: tagName#id.class "text"
        const idAttr = el.attributes.id ? `#${el.attributes.id}` : "";
        const classes = el.attributes.class
          ? "." + el.attributes.class.split(/\s+/).slice(0, 3).join(".")
          : "";
        const text = el.text.slice(0, 50);
        lines.push(
          `- [${id}] ${el.tagName}${idAttr}${classes} "${text}" — ${action}`,
        );
      }
      if (lines.length > 0) {
        parts.push(`Elements identified:\n${lines.join("\n")}`);
      }
    }
  }

  return parts.join("\n\n");
}

/** Filler prefix patterns — text-only responses that start with these are low-information */
const FILLER_PREFIXES = [
  "i'm ready",
  "we need to",
  "the task",
  "i will now",
  "i'll",
  "we have",
  "i'm now",
  "the next step",
];

/**
 * Classify a text-only LLM response as filler (low-information narration)
 * vs. genuine reasoning that may contain useful analysis.
 */
export function isFillerText(text: string): boolean {
  const trimmed = text.trim();
  // Short text with no tool call is definitionally filler in an agent context
  if (trimmed.length < 60) return true;
  // Filler prefix pattern
  const lower = trimmed.toLowerCase();
  if (FILLER_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  // High non-alphanumeric ratio (catches "We have..............." patterns)
  const alphanumCount = trimmed.replace(/[^a-zA-Z0-9]/g, "").length;
  if (alphanumCount / trimmed.length < 0.6) return true;
  return false;
}

/** Patterns that indicate the LLM is simulating tool calls in text instead of using the API. */
const HALLUCINATION_PATTERNS = [
  /functions\.\w+/,
  /\bto\s*=\s*functions\./,
  /\bjson\s*\{/i,
  /"function"\s*:\s*"/,
  /"tool"\s*:\s*"/,
  /\btool_call\b/i,
];

/**
 * Detect when the LLM is hallucinating tool calls as plain text.
 * Requires text > 150 chars AND >= 2 distinct pattern matches to reduce false positives.
 */
export function isHallucinatedToolCall(text: string): boolean {
  if (text.length <= 150) return false;
  let matchCount = 0;
  for (const pattern of HALLUCINATION_PATTERNS) {
    if (pattern.test(text)) {
      matchCount++;
      if (matchCount >= 2) return true;
    }
  }
  return false;
}

// ── Turn-level error classification for retry decisions ──

export type TurnErrorClass =
  | "hallucination"
  | "network"
  | "empty_response"
  | "credits_exhausted"
  | "user_abort"
  | "bad_request"
  | "unknown";

/** Retryable error classes (up to MAX_TURN_RETRIES). */
export const RETRYABLE_ERRORS = new Set<TurnErrorClass>([
  "hallucination",
  "network",
  "empty_response",
]);

/** Max retries per turn before falling through to escalation path. */
export const MAX_TURN_RETRIES = 2;

/** Backoff delays in ms for each retry attempt (index = retryCount - 1). */
export const TURN_RETRY_BACKOFF_MS = [0, 500];

/**
 * Classify a turn-level error for retry decisions.
 * Called inside the LLM call catch block and after empty-response detection.
 */
export function classifyTurnError(
  error: unknown,
  hallucinationDetected: boolean,
): TurnErrorClass {
  if (hallucinationDetected) return "hallucination";

  if (error instanceof Error) {
    if (error.name === "AbortError") return "user_abort";
  }

  // HTTP status-based classification
  const status = (error as any)?.status;
  if (status === 402) return "credits_exhausted";
  if (status === 400 || status === 422) return "bad_request";
  if (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  )
    return "network";

  // Fetch/network failures
  if (error instanceof TypeError && error.message.includes("fetch"))
    return "network";

  return "unknown";
}

/**
 * Build a compact summary of what the agent tried before a strategy pivot.
 * Includes both successes and failures so the next model knows what was
 * already accomplished vs what went wrong.
 */
export function extractAttemptSummary(messages: LLMMessage[]): string {
  const successes: string[] = [];
  const failures: string[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "tool") continue;

    const content = typeof msg.content === "string" ? msg.content : "";
    const isFail =
      content.startsWith("Error:") ||
      content.includes("does not appear to be") ||
      content.includes("No element with tag") ||
      content.includes("Click intercepted") ||
      content.includes("REJECTED");

    // Find the corresponding assistant tool_call
    const toolCallId = msg.tool_call_id;
    if (!toolCallId) continue;

    let toolName = "unknown";
    let argSnippet = "";
    for (let j = i - 1; j >= 0; j--) {
      const aMsg = messages[j];
      if (aMsg.role === "assistant" && aMsg.tool_calls) {
        const tc = aMsg.tool_calls.find((c) => c.id === toolCallId);
        if (tc) {
          toolName = tc.function.name;
          try {
            const args = JSON.parse(tc.function.arguments);
            const parts: string[] = [];
            if (args.id != null) parts.push(`[${args.id}]`);
            if (args.text) parts.push(`"${String(args.text).slice(0, 30)}"`);
            if (args.url) parts.push(String(args.url).slice(0, 40));
            if (args.direction) parts.push(args.direction);
            if (args.summary)
              parts.push(`"${String(args.summary).slice(0, 30)}"`);
            argSnippet = parts.join(" ");
          } catch {
            /* */
          }
          break;
        }
      }
    }

    const key = `${toolName} ${argSnippet}`.trim();

    if (isFail) {
      const errorSnippet = content.split("\n")[0].slice(0, 60);
      // Deduplicate repeated failures
      const existing = failures.find((f) => f.startsWith(`- ${key}`));
      if (!existing) failures.push(`- ${key} — ${errorSnippet}`);
    } else {
      // Skip internal/noise tools for success tracking
      if (["read_page", "wait", "escalate"].includes(toolName)) continue;
      const resultSnippet = content.split("\n")[0].slice(0, 60);
      successes.push(`- ${key} → ${resultSnippet}`);
    }

    // Cap total entries
    if (successes.length + failures.length >= 15) break;
  }

  const sections: string[] = [];
  if (successes.length > 0) {
    sections.push(`Completed actions (DO NOT redo):\n${successes.join("\n")}`);
  }
  if (failures.length > 0) {
    sections.push(`Failed actions (DO NOT retry):\n${failures.join("\n")}`);
  }
  if (sections.length === 0) {
    return "No specific actions recorded.";
  }
  return sections.join("\n\n").slice(0, 800);
}

export function userExplicitlyRequestedTabManagement(query: string): boolean {
  const normalized = query.toLowerCase();
  return (
    /\b(new tab|another tab|open tab|create tab)\b/.test(normalized) ||
    /\b(switch tab|switch to tab|go to tab)\b/.test(normalized) ||
    /\bswitch to \d+\b/.test(normalized) ||
    /\b(close tab|close this tab|close current tab)\b/.test(normalized) ||
    /\b(multiple tabs|multi-tab|compare tabs)\b/.test(normalized)
  );
}

/**
 * Determine whether a planless task still requires an explicit page-grounding
 * read before done(). This targets summarize/read/report style tasks where the
 * model otherwise tends to answer from URL/title alone.
 */
export function requiresGroundingReadBeforeDone(query: string): boolean {
  const normalized = query.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return false;

  const trivialPageQuestions = [
    /\bwhat(?:'s| is) the title\b/,
    /\bwhat(?:'s| is) the url\b/,
    /\bwhat page is this\b/,
    /\bwhich page is this\b/,
    /\bwhat site is this\b/,
    /\bwhat domain is this\b/,
  ];
  if (trivialPageQuestions.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  const pageReadTasks = [
    /\bsummari[sz]e\b/,
    /\bsummary\b/,
    /\bdescribe (?:this|the) page\b/,
    /\breport (?:on|about) (?:this|the) page\b/,
    /\breview (?:this|the) page\b/,
    /\bextract\b.+\b(page|article|post|document|readme|content)\b/,
    /\bmain points?\b/,
    /\bkey points?\b/,
    /\bheadlines?\b/,
    /\bwhat does (?:this|the) page say\b/,
    /\bread (?:this|the) page\b/,
    /\bfrom (?:this|the) page\b/,
    /\b(article|post|document|readme|page content)\b.+\b(summarize|summary|describe|report|extract)\b/,
  ];

  return pageReadTasks.some((pattern) => pattern.test(normalized));
}

export interface DoneTaskContractGuardResult {
  blocked: boolean;
  reason: string | null;
  summaryCoverage: TaskContractCoverage;
  missingReturnTarget: boolean;
}

/**
 * Reject done() when the final summary drops required task entities/results or
 * when a round-trip task has not actually returned to the required page.
 */
export function evaluateDoneTaskContractGuard(params: {
  query: string;
  summary: string;
  snapshot: DomSnapshot | null;
}): DoneTaskContractGuardResult {
  const contract = buildTaskContract(params.query);
  const hasObligations =
    contract.requiresRoundTrip ||
    contract.requiredEntities.length > 0 ||
    contract.requiredNumbers.length > 0;

  const summaryCoverage = assessTaskContractCoverage({
    contract,
    text: params.summary,
  });

  if (!hasObligations) {
    return {
      blocked: false,
      reason: null,
      summaryCoverage,
      missingReturnTarget: false,
    };
  }

  const returnTargetCoverage = contract.requiresRoundTrip
    ? assessTaskContractCoverage({
        contract: {
          ...contract,
          requiredEntities: [],
          requiredNumbers: [],
        },
        text: snapshotSearchText(params.snapshot),
        requireReturnTarget: true,
      })
    : null;

  const reasons: string[] = [];
  if (summaryCoverage.missingEntities.length > 0) {
    reasons.push(
      `final summary is missing required targets: ${summaryCoverage.missingEntities.join(", ")}`,
    );
  }
  if (summaryCoverage.missingNumbers.length > 0) {
    reasons.push(
      `final summary is missing required values: ${summaryCoverage.missingNumbers.join(", ")}`,
    );
  }
  if (summaryCoverage.missingExhaustiveCoverage) {
    reasons.push(
      "final summary does not confirm exhaustive coverage of the requested items",
    );
  }
  if (summaryCoverage.missingMultiReturnCoverage) {
    reasons.push(
      "final summary does not cover all required requested results",
    );
  }
  if (returnTargetCoverage?.missingReturnTarget) {
    reasons.push(
      `you have not actually returned to the required page before finishing`,
    );
  }

  return {
    blocked: reasons.length > 0,
    reason: reasons.length > 0 ? reasons.join("; ") : null,
    summaryCoverage,
    missingReturnTarget: Boolean(returnTargetCoverage?.missingReturnTarget),
  };
}

/**
 * Build the first-turn recovery nudge for text-only responses.
 * Summarize/report tasks should re-ground with read_page before done().
 */
export function buildFirstTurnTextOnlyNudge(query: string): string {
  if (requiresGroundingReadBeforeDone(query)) {
    return (
      "Your response was text only. This task requires grounding from the current page. " +
      "Call read_page first, then call done({\"summary\": \"...\"}) once you have verified the page content."
    );
  }

  return (
    "If that was your answer to the user's question, wrap it in done({\"summary\": \"...\"}) to deliver it. " +
    "If you need to act on the page, call the appropriate tool."
  );
}

// ─── Grounding helpers ───────────────────────────────────────────────

/** Tools that count as "observing the page" — used by the blind-action gate. */
export const GROUNDING_OBSERVATION_TOOLS = new Set<string>([
  ToolName.READ_PAGE,
  ToolName.FIND_ELEMENT,
  ToolName.READ_ELEMENT,
  ToolName.XRAY_PAGE,
  ToolName.SCROLL_PAGE,
]);

const STEP_PATTERNS = [
  /\/step(\d+)/i, // URL path: /step3
  /step\s+(\d+)/i, // prose: "step 3", "Step 5"
  /on step\s+(\d+)/i, // "You are on step 5"
];

/**
 * Extract a step number from a string (URL, title, or page content).
 * Returns the first match or null.
 */
export function extractStepIndicator(source: string): { step: number } | null {
  for (const re of STEP_PATTERNS) {
    const m = source.match(re);
    if (m) return { step: parseInt(m[1], 10) };
  }
  return null;
}

/** Keyword groups for page-type mismatch detection. */
const PAGE_TYPE_RULES: Array<{
  instructionKeywords: RegExp;
  pageKeywords: RegExp;
  pageExclude?: RegExp;
}> = [
  {
    // instruction says checkout/form, but page is a cart
    instructionKeywords:
      /\b(checkout|check out|fill out|complete the form|payment)\b/i,
    pageKeywords: /\b(cart|shopping cart|your cart|bag)\b/i,
    pageExclude: /\bcheckout\b/i,
  },
  {
    // instruction says search, but page is a product/article
    instructionKeywords:
      /\b(search for|search the|find results|search results)\b/i,
    pageKeywords: /\b(product|article|item detail|order confirmation)\b/i,
  },
];

export interface ContradictionResult {
  mismatch: boolean;
  details: string;
}

/**
 * Deterministic contradiction detector.
 * Compares instruction claims against actual page state from the snapshot.
 * Returns null when no contradiction is found (conservative — avoids false positives).
 */
export function detectInstructionContradiction(
  instruction: string,
  snapshot: DomSnapshot,
): ContradictionResult | null {
  const pageText = [
    snapshot.url,
    snapshot.title,
    snapshot.pageContent ?? "",
  ].join(" ");

  // 1. Step mismatch: instruction says step N, page says step M
  const instrStep = extractStepIndicator(instruction);
  const pageStep = extractStepIndicator(pageText);
  if (instrStep && pageStep && instrStep.step !== pageStep.step) {
    return {
      mismatch: true,
      details: `Instruction references step ${instrStep.step}, but the page is on step ${pageStep.step} (URL: ${snapshot.url}, title: "${snapshot.title}").`,
    };
  }

  // 2. Page-type mismatch: instruction expects one page type, snapshot shows another
  for (const rule of PAGE_TYPE_RULES) {
    if (rule.instructionKeywords.test(instruction)) {
      const combinedPage = `${snapshot.title} ${snapshot.url}`;
      if (
        rule.pageKeywords.test(combinedPage) &&
        (!rule.pageExclude || !rule.pageExclude.test(combinedPage))
      ) {
        return {
          mismatch: true,
          details: `Instruction expects "${instruction.slice(0, 80)}", but the current page appears to be a different type (title: "${snapshot.title}", URL: ${snapshot.url}).`,
        };
      }
    }
  }

  return null;
}

// ─── Structured Failure Context (for escalation → replan) ───────────

/** Structured analysis of why the executor got stuck, passed to the planner on replan. */
export interface StructuredFailureContext {
  stuckStepGoal: string;
  stuckStepIndex: number;
  turnsSpent: number;
  toolsAttempted: string[];
  specificErrors: string[];
  untriedAlternatives: string[];
  pageState: string; // current URL + brief page description
}

/**
 * Build structured failure context from subgoal attempts for the planner.
 * This gives the planner model precise information about what was tried and
 * what failed, so it can produce a better replan.
 */
export function buildStructuredFailureContext(
  attempts: SubgoalAttempt[],
  stuckStepGoal: string,
  stuckStepIndex: number,
  turnsSpent: number,
  pageUrl: string,
): StructuredFailureContext {
  const toolsAttempted = [...new Set(attempts.map((a) => a.tool))];
  const specificErrors: string[] = [];
  for (const a of attempts) {
    if (a.wasFailure) {
      const errorLine = `${a.tool}(${a.args}) → ${a.outcome}`;
      if (!specificErrors.some((e) => e.startsWith(a.tool + "("))) {
        specificErrors.push(errorLine.slice(0, 120));
      }
    }
  }
  const untriedAlternatives = ALTERNATIVE_TOOLS.filter(
    (t) => !toolsAttempted.includes(t),
  );

  return {
    stuckStepGoal,
    stuckStepIndex,
    turnsSpent,
    toolsAttempted,
    specificErrors: specificErrors.slice(0, 5),
    untriedAlternatives,
    pageState: pageUrl,
  };
}

/**
 * Format a StructuredFailureContext into a string for inclusion in the replan prompt.
 */
export function formatStructuredFailureContext(
  ctx: StructuredFailureContext,
): string {
  const lines: string[] = [
    `Stuck step ${ctx.stuckStepIndex + 1}: "${ctx.stuckStepGoal}"`,
    `Turns spent: ${ctx.turnsSpent}`,
    `Tools attempted: ${ctx.toolsAttempted.join(", ")}`,
  ];
  if (ctx.specificErrors.length > 0) {
    lines.push(
      `Errors:\n${ctx.specificErrors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }
  if (ctx.untriedAlternatives.length > 0) {
    lines.push(`Untried alternatives: ${ctx.untriedAlternatives.join(", ")}`);
  }
  lines.push(`Current page: ${ctx.pageState}`);
  return lines.join("\n");
}

// ─── Cumulative Failure Brief (§3.4) ────────────────────────────────

/** A single tool attempt tracked for the cumulative failure brief. */
export interface SubgoalAttempt {
  turn: number;
  tool: string;
  args: string; // truncated JSON args (first 100 chars)
  outcome: string; // first line of tool result
  wasFailure: boolean; // error, intercepted, no effect
  snapshotFp: string; // page state fingerprint at time of action
}

/** Failure-pattern keywords → human-readable insights. */
const FAILURE_SYNTHESIS_RULES: Array<{
  test: (a: SubgoalAttempt) => boolean;
  note: string;
}> = [
  {
    test: (a) => a.outcome.includes("covered by"),
    note: "Element is covered by another element",
  },
  {
    test: (a) =>
      a.tool === "dismiss_overlays" && /no overlays/i.test(a.outcome),
    note: "Covering element is NOT an overlay",
  },
  {
    test: (a) => a.tool === "hide_element" && a.wasFailure,
    note: "Covering element cannot be hidden",
  },
  {
    test: (a) => a.tool === "execute_js" && /undefined/i.test(a.outcome),
    note: "JS approach returned undefined",
  },
];

/** Alternative tools to suggest when the agent is stuck. */
const ALTERNATIVE_TOOLS = [
  "click_coordinates",
  "scroll_page",
  "press_key",
  "navigate",
  "execute_js",
  "find_element",
];

/**
 * Build a cumulative failure brief from tracked subgoal attempts.
 * Synthesizes what was tried, what failed, and suggests untried alternatives.
 * Returns empty string if fewer than 3 attempts (not enough data to synthesize).
 * Max output: 600 chars.
 */
export function buildFailureBrief(attempts: SubgoalAttempt[]): string {
  if (attempts.length < 3) return "";

  const lines: string[] = [];

  // 1. Format each attempt
  for (const a of attempts.slice(-10)) {
    const outcome = a.wasFailure ? `FAIL: ${a.outcome}` : a.outcome;
    lines.push(`T${a.turn}: ${a.tool} ${a.args} → ${outcome}`);
  }

  // 2. Deterministic synthesis: extract insights from failure patterns
  const insights = new Set<string>();
  for (const rule of FAILURE_SYNTHESIS_RULES) {
    if (attempts.some(rule.test)) {
      insights.add(rule.note);
    }
  }

  // 3. List untried alternative tools
  const triedTools = new Set(attempts.map((a) => a.tool));
  const untried = ALTERNATIVE_TOOLS.filter((t) => !triedTools.has(t));

  // 4. Assemble the brief
  const sections: string[] = [];
  sections.push(`Attempts (${attempts.length}):\n${lines.join("\n")}`);
  if (insights.size > 0) {
    sections.push(`Insights: ${[...insights].join("; ")}`);
  }
  if (untried.length > 0) {
    sections.push(`Untried tools: ${untried.join(", ")}`);
  }

  return sections.join("\n").slice(0, 600);
}
