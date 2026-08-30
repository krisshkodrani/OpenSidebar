import type { DomSnapshot, TaggedElement } from "../../types";
import { getPromptDefinition } from "../../prompts";
import type { LLMMessage, TokenUsage } from "../llm/types";
import { estimateImagePromptUsage } from "./agent-telemetry";

export type ContextMode =
  | "full"
  | "action_compact"
  | "form_compact"
  | "navigation_compact"
  | "extraction_full"
  | "visual_full";

export interface PromptSectionMetrics {
  templateId: string;
  templateVersion: string;
  sectionSignatureHash: string;
  staticRulesChars: number;
  systemMessagePrefixChars: number;
  personaAndTaskChars: number;
  planStatusChars: number;
  workingNotesChars: number;
  pageContextChars: number;
  lastActionOutcomeChars: number;
  visibleElementsChars: number;
  pageContentChars: number;
  pageInterpretationChars: number;
  toolCapabilityCatalogChars: number;
  toolOutputChars: number;
  distillationSummaryChars: number;
  systemTotalChars: number;
  historyChars: number;
  estimatedPromptTokens: number;
  actualPromptTokens?: number;
  estimatorErrorPct?: number;
  imagePromptCount?: number;
  lowDetailImagePromptCount?: number;
  highDetailImagePromptCount?: number;
  autoDetailImagePromptCount?: number;
  estimatedImagePromptTokens?: number;
}

export interface ContextModeTelemetry {
  active: ContextMode;
  shadowCandidate: ContextMode;
  reasons: string[];
  fallbackReason?: string;
}

export interface DomPromptDeltaMetrics {
  shadowOnly: true;
  previousFingerprint: string;
  currentFingerprint: string;
  cause: "last_action" | "navigation" | "form_validation" | "render_update" | "polling" | "unknown";
  addedCount: number;
  removedCount: number;
  changedCount: number;
  stableActionableCount: number;
  estimatedFullChars: number;
  estimatedDeltaChars: number;
  breakEven: boolean;
  stability: {
    stableTagReusePct: number;
    changedHashPct: number;
    removedActionablePct: number;
    remappedSuspicion: boolean;
  };
}

export interface StructuredRuntimeStateShadowMetrics {
  shadowOnly: true;
  proseStateChars: number;
  estimatedStructuredChars: number;
  estimatedSavingsChars: number;
  estimatedSavingsPct: number;
  preservedRationaleChars: number;
  mixedFormatExpected: boolean;
  comprehensionGateRequired: true;
  fields: {
    planStatusChars: number;
    workingNotesChars: number;
    lastActionOutcomeChars: number;
    toolOutputChars: number;
    distillationSummaryChars: number;
  };
}

export interface ContextSpendTelemetry {
  turn: number;
  promptTokensSinceProgress: number;
  totalTokensSinceProgress: number;
  turnsSinceProgress: number;
  lastProgressTurn: number;
  lastProgressSignal: string | null;
  threshold: "none" | "distill" | "compact" | "pivot";
}

export type ProgressSignalStrength = "strong" | "medium" | "weak";

export interface ContextProgressSignal {
  strength: ProgressSignalStrength;
  label: string;
  observed: boolean;
}

const PROMPT_SECTION_HEADERS = [
  "## Core Loop",
  "## Priority Order",
  "## Direct Action Rules",
  "## Discovery Rules",
  "## Stuck Rules",
  "## Anti-Patterns",
  "## Working Notes",
  "## Plan",
  "## Page Interpretation",
  "## Form Submission Rules",
  "## done() Requirements",
  "## Tool Reminders",
  "## Page Context",
  "## Turn Status",
  "## Last Action Outcome",
  "## Visible Elements",
  "## Page Content",
  "## Available Tool Capabilities",
] as const;

type DynamicPromptSectionKey =
  | "planStatusChars"
  | "workingNotesChars"
  | "pageContextChars"
  | "lastActionOutcomeChars"
  | "visibleElementsChars"
  | "pageContentChars"
  | "pageInterpretationChars"
  | "toolCapabilityCatalogChars";

const DYNAMIC_HEADER_KEYS: Record<string, DynamicPromptSectionKey> = {
  "## Working Notes": "workingNotesChars",
  "## Plan": "planStatusChars",
  "## Page Context": "pageContextChars",
  "## Last Action Outcome": "lastActionOutcomeChars",
  "## Visible Elements": "visibleElementsChars",
  "## Page Content": "pageContentChars",
  "## Page Interpretation": "pageInterpretationChars",
  "## Available Tool Capabilities": "toolCapabilityCatalogChars",
};

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function contentToString(content: LLMMessage["content"]): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  return content
    .map((part) => (part.type === "text" ? part.text : "[image]"))
    .join("");
}

function sectionRanges(systemContent: string): Map<string, number> {
  const positions = PROMPT_SECTION_HEADERS.map((header) => ({
    header,
    index: systemContent.indexOf(header),
  }))
    .filter((entry) => entry.index >= 0)
    .sort((a, b) => a.index - b.index);
  const ranges = new Map<string, number>();
  for (let i = 0; i < positions.length; i += 1) {
    const current = positions[i];
    const next = positions[i + 1];
    ranges.set(
      current.header,
      (next ? next.index : systemContent.length) - current.index,
    );
  }
  return ranges;
}

function historyCharCount(messages: LLMMessage[]): number {
  return messages
    .slice(1)
    .filter((message) => !isToolCapabilityCatalog(message))
    .reduce((sum, message) => sum + contentToString(message.content).length, 0);
}

/**
 * The tool-capability catalog (#107) rides as a synthetic trailing message. It
 * is prompt scaffolding, not conversation, so counting it as history would
 * inflate `historyChars` and double-count against
 * `toolCapabilityCatalogChars`.
 */
function isToolCapabilityCatalog(message: LLMMessage): boolean {
  return contentToString(message.content).startsWith(
    "## Available Tool Capabilities",
  );
}

function toolOutputCharCount(messages: LLMMessage[]): number {
  return messages.reduce((sum, message) => {
    if (message.role !== "tool") return sum;
    return sum + contentToString(message.content).length;
  }, 0);
}

function distillationSummaryCharCount(messages: LLMMessage[]): number {
  return messages.reduce((sum, message) => {
    const content = contentToString(message.content);
    if (
      content.includes("[DISTILLED HISTORY") ||
      content.includes("[COMPRESSED HISTORY") ||
      content.includes("Prior turns (compressed")
    ) {
      return sum + content.length;
    }
    return sum;
  }, 0);
}

export function buildPromptSectionMetrics(args: {
  messages: LLMMessage[];
  estimatedPromptTokens: number;
}): PromptSectionMetrics {
  const systemContent =
    args.messages[0]?.role === "system"
      ? contentToString(args.messages[0].content)
      : "";
  const prompt = getPromptDefinition("agent.system");
  // Section headers no longer all live in message 0. LP-21 phase 2 moved the
  // page-state block into a trailing message and #107 moved the tool catalog
  // into one, so scanning only messages[0] silently reported 0 chars for every
  // section that had moved. Scan the non-system messages too, and let a later
  // occurrence win — the volatile copy is the live one.
  const ranges = sectionRanges(systemContent);
  for (const message of args.messages.slice(1)) {
    for (const [header, size] of sectionRanges(
      contentToString(message.content),
    )) {
      ranges.set(header, size);
    }
  }
  const sectionSignatureHash = fnv1a([...ranges.keys()].join("|"));
  const pageContextIndex = systemContent.indexOf("## Page Context");
  const toolRemindersIndex = systemContent.indexOf("## Tool Reminders");
  const staticRulesChars =
    toolRemindersIndex >= 0
      ? (ranges.get("## Tool Reminders") ?? 0) + toolRemindersIndex
      : pageContextIndex >= 0
        ? pageContextIndex
        : systemContent.length;
  const systemMessagePrefixChars =
    pageContextIndex >= 0 ? pageContextIndex : systemContent.length;
  const imageUsage = estimateImagePromptUsage(args.messages);
  const metrics: PromptSectionMetrics = {
    templateId: prompt.id,
    templateVersion: prompt.version,
    sectionSignatureHash,
    staticRulesChars,
    systemMessagePrefixChars,
    personaAndTaskChars: Math.max(0, systemMessagePrefixChars - staticRulesChars),
    planStatusChars: 0,
    workingNotesChars: 0,
    pageContextChars: 0,
    lastActionOutcomeChars: 0,
    visibleElementsChars: 0,
    pageContentChars: 0,
    pageInterpretationChars: 0,
    toolCapabilityCatalogChars: 0,
    toolOutputChars: toolOutputCharCount(args.messages),
    distillationSummaryChars: distillationSummaryCharCount(args.messages),
    systemTotalChars: systemContent.length,
    historyChars: historyCharCount(args.messages),
    estimatedPromptTokens: args.estimatedPromptTokens,
    imagePromptCount: imageUsage.imageCount,
    lowDetailImagePromptCount: imageUsage.lowDetailCount,
    highDetailImagePromptCount: imageUsage.highDetailCount,
    autoDetailImagePromptCount: imageUsage.autoDetailCount,
    estimatedImagePromptTokens: imageUsage.estimatedTokens,
  };

  for (const [header, key] of Object.entries(DYNAMIC_HEADER_KEYS)) {
    metrics[key] = ranges.get(header) ?? 0;
  }

  return metrics;
}

function rationaleCharCount(messages: LLMMessage[]): number {
  const rationalePattern = /\b(because|blocked|blocker|reason|rationale|hypothesis|uncertain|unknown|why)\b/i;
  return messages.reduce((sum, message) => {
    const content = contentToString(message.content);
    if (!content) return sum;
    return (
      sum +
      content
        .split(/\r?\n/)
        .filter((line) => rationalePattern.test(line))
        .reduce((lineSum, line) => lineSum + line.length, 0)
    );
  }, 0);
}

export function buildStructuredRuntimeStateShadowMetrics(args: {
  promptSections: PromptSectionMetrics;
  messages: LLMMessage[];
}): StructuredRuntimeStateShadowMetrics {
  const fields = {
    planStatusChars: args.promptSections.planStatusChars,
    workingNotesChars: args.promptSections.workingNotesChars,
    lastActionOutcomeChars: args.promptSections.lastActionOutcomeChars,
    toolOutputChars: args.promptSections.toolOutputChars,
    distillationSummaryChars: args.promptSections.distillationSummaryChars,
  };
  const proseStateChars = Object.values(fields).reduce(
    (sum, chars) => sum + chars,
    0,
  );
  const preservedRationaleChars = Math.min(
    proseStateChars,
    rationaleCharCount(args.messages),
  );
  const compactableChars = Math.max(0, proseStateChars - preservedRationaleChars);
  const estimatedStructuredChars =
    proseStateChars === 0
      ? 0
      : Math.ceil(compactableChars * 0.45) + preservedRationaleChars + 120;
  const estimatedSavingsChars = Math.max(
    0,
    proseStateChars - estimatedStructuredChars,
  );
  const estimatedSavingsPct =
    proseStateChars > 0
      ? Math.round((estimatedSavingsChars / proseStateChars) * 10000) / 100
      : 0;

  return {
    shadowOnly: true,
    proseStateChars,
    estimatedStructuredChars,
    estimatedSavingsChars,
    estimatedSavingsPct,
    preservedRationaleChars,
    mixedFormatExpected:
      fields.toolOutputChars > 0 || fields.distillationSummaryChars > 0,
    comprehensionGateRequired: true,
    fields,
  };
}

export function attachActualPromptTokens(
  metrics: PromptSectionMetrics,
  actualPromptTokens: number,
): PromptSectionMetrics {
  const estimated = metrics.estimatedPromptTokens;
  const estimatorErrorPct =
    actualPromptTokens > 0
      ? ((estimated - actualPromptTokens) / actualPromptTokens) * 100
      : 0;
  return {
    ...metrics,
    actualPromptTokens,
    estimatorErrorPct: Math.round(estimatorErrorPct * 100) / 100,
  };
}

function hasFormControl(snapshot: DomSnapshot | null | undefined): boolean {
  return (snapshot?.elements ?? []).some((element) => {
    const tagName = element.tagName.toLowerCase();
    const role = element.role?.toLowerCase();
    return (
      tagName === "input" ||
      tagName === "textarea" ||
      tagName === "select" ||
      role === "textbox" ||
      role === "combobox" ||
      role === "checkbox" ||
      role === "radio"
    );
  });
}

export function resolveContextModeTelemetry(args: {
  messages: LLMMessage[];
  snapshot?: DomSnapshot | null;
}): ContextModeTelemetry {
  const text = args.messages.map((message) => contentToString(message.content)).join("\n");
  const lower = text.toLowerCase();
  const reasons: string[] = [];

  if (lower.includes("[image]") || lower.includes("visual-only")) {
    return { active: "full", shadowCandidate: "visual_full", reasons: ["visual_context_present"] };
  }
  if (/\b(summarize|extract|review|analy[sz]e|compare|read all|report)\b/.test(lower)) {
    return { active: "full", shadowCandidate: "extraction_full", reasons: ["extraction_or_review_language"] };
  }
  if (hasFormControl(args.snapshot)) {
    reasons.push("form_controls_visible");
    return { active: "full", shadowCandidate: "form_compact", reasons };
  }
  if (/\b(navigate|open|go to|module|menu|tab)\b/.test(lower)) {
    reasons.push("navigation_language");
    return { active: "full", shadowCandidate: "navigation_compact", reasons };
  }
  reasons.push("default_action_candidate");
  return { active: "full", shadowCandidate: "action_compact", reasons };
}

function elementIdentity(element: TaggedElement): string {
  const attrs = [
    "id",
    "name",
    "type",
    "role",
    "href",
    "aria-label",
    "data-testid",
    "value",
    "checked",
    "selected",
    "aria-checked",
    "aria-selected",
  ]
    .map((key) => element.attributes[key])
    .filter(Boolean)
    .join("|");
  return `${element.tagName}|${element.role}|${element.text}|${attrs}`;
}

function actionable(element: TaggedElement): boolean {
  const tagName = element.tagName.toLowerCase();
  const role = element.role?.toLowerCase();
  return (
    ["button", "input", "textarea", "select", "a"].includes(tagName) ||
    ["button", "textbox", "combobox", "checkbox", "radio", "link", "tab"].includes(role)
  );
}

function snapshotFingerprint(snapshot: DomSnapshot): string {
  const identities = snapshot.elements
    .map((element) => `${element.tag}:${elementIdentity(element)}`)
    .sort()
    .join("\n");
  return fnv1a(`${snapshot.url}|${snapshot.title}|${identities}`);
}

function compactElementChars(element: TaggedElement): number {
  return JSON.stringify({
    tag: element.tag,
    tagName: element.tagName,
    role: element.role,
    text: element.text,
    attributes: element.attributes,
    isDisabled: element.isDisabled,
  }).length;
}

export function buildDomPromptDeltaMetrics(args: {
  previous: DomSnapshot | null;
  current: DomSnapshot | null;
  cause?: DomPromptDeltaMetrics["cause"];
}): DomPromptDeltaMetrics | null {
  if (!args.previous || !args.current) return null;

  const previousByTag = new Map(args.previous.elements.map((element) => [element.tag, element]));
  const currentByTag = new Map(args.current.elements.map((element) => [element.tag, element]));
  let addedCount = 0;
  let removedCount = 0;
  let changedCount = 0;
  let stableActionableCount = 0;
  let changedHashCount = 0;
  let removedActionableCount = 0;

  for (const [tag, element] of currentByTag) {
    const previous = previousByTag.get(tag);
    if (!previous) {
      addedCount += 1;
      continue;
    }
    const previousIdentity = elementIdentity(previous);
    const currentIdentity = elementIdentity(element);
    if (previousIdentity !== currentIdentity) {
      changedCount += 1;
      changedHashCount += 1;
    } else if (actionable(element)) {
      stableActionableCount += 1;
    }
  }

  for (const [tag, element] of previousByTag) {
    if (!currentByTag.has(tag)) {
      removedCount += 1;
      if (actionable(element)) removedActionableCount += 1;
    }
  }

  const previousActionable = args.previous.elements.filter(actionable).length;
  const sharedTags = [...currentByTag.keys()].filter((tag) => previousByTag.has(tag)).length;
  const totalCurrent = Math.max(1, args.current.elements.length);
  const estimatedFullChars = args.current.elements.reduce(
    (sum, element) => sum + compactElementChars(element) + 1,
    0,
  );
  const changedChars = args.current.elements.reduce((sum, element) => {
    const previous = previousByTag.get(element.tag);
    if (!previous || elementIdentity(previous) !== elementIdentity(element)) {
      return sum + compactElementChars(element) + 1;
    }
    return sum;
  }, 0);
  const estimatedDeltaChars =
    changedChars + removedCount * 6 + stableActionableCount * 4 + 160;
  const stableTagReusePct = Math.round((sharedTags / totalCurrent) * 10000) / 100;
  const changedHashPct =
    Math.round((changedHashCount / Math.max(1, sharedTags)) * 10000) / 100;
  const removedActionablePct =
    Math.round((removedActionableCount / Math.max(1, previousActionable)) * 10000) / 100;
  const remappedSuspicion = changedHashPct > 25 || removedActionablePct > 20;

  return {
    shadowOnly: true,
    previousFingerprint: snapshotFingerprint(args.previous),
    currentFingerprint: snapshotFingerprint(args.current),
    cause: args.cause ?? "unknown",
    addedCount,
    removedCount,
    changedCount,
    stableActionableCount,
    estimatedFullChars,
    estimatedDeltaChars,
    breakEven: estimatedDeltaChars < estimatedFullChars * 0.8,
    stability: {
      stableTagReusePct,
      changedHashPct,
      removedActionablePct,
      remappedSuspicion,
    },
  };
}

const SEMANTIC_PROGRESS_TOOLS = new Set([
  "apply_list_action",
  "apply_list_filter",
  "apply_list_sort",
  "click_coordinates",
  "click_element",
  "configure_catalog_item",
  "configure_servicenow_form",
  "drag_and_drop",
  "go_back",
  "hover_element",
  "navigate",
  "open_servicenow_module",
  "press_key",
  "select_option",
  "set_checkbox",
  "type_text",
]);

const FIELD_STATE_ATTRS = [
  "value",
  "checked",
  "selected",
  "aria-checked",
  "aria-selected",
  "aria-valuetext",
];

const SEMANTIC_STATE_LINE_PATTERN =
  /\b(success(?:ful(?:ly)?)?|completed?|submitted|saved|created|updated|confirmed|applied|loaded|opened|selected|added|removed|ordered|requested|approved|rejected|resolved|closed|showing|results?|found|matches?|search(?:ed)?|filtered|sorted|validation|required|error|warning)\b/i;

function normalizeSnapshotText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function snapshotLines(snapshot: DomSnapshot | null | undefined): Set<string> {
  const chunks = [
    snapshot?.title,
    snapshot?.visibleContent,
    snapshot?.pageContent,
    ...(snapshot?.skeleton ?? []).map((node) => node.text),
  ].filter((chunk): chunk is string => Boolean(chunk));
  const lines = new Set<string>();
  for (const chunk of chunks) {
    for (const rawLine of chunk.split(/\r?\n/)) {
      const line = normalizeSnapshotText(rawLine);
      if (line.length >= 4) lines.add(line);
    }
  }
  return lines;
}

function meaningfulElementTexts(snapshot: DomSnapshot): Set<string> {
  const lines = new Set<string>();
  for (const element of snapshot.elements) {
    const line = normalizeSnapshotText(element.text);
    if (line.length >= 4 && /[a-z0-9]/i.test(line)) {
      lines.add(line);
    }
  }
  return lines;
}

function elementState(element: TaggedElement | undefined): string {
  if (!element) return "";
  const attrs = FIELD_STATE_ATTRS.map((attr) =>
    attr in element.attributes ? `${attr}=${element.attributes[attr]}` : "",
  )
    .filter(Boolean)
    .join("|");
  return normalizeSnapshotText(`${element.text} ${attrs}`);
}

function numericArg(args: Record<string, unknown> | undefined, key: string): number | null {
  const value = args?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArg(args: Record<string, unknown> | undefined, key: string): string {
  const value = args?.[key];
  return typeof value === "string" ? value : "";
}

function detectFieldStateProgress(args: {
  toolName: string;
  toolArgs?: Record<string, unknown>;
  previousSnapshot: DomSnapshot;
  currentSnapshot: DomSnapshot;
}): ContextProgressSignal | null {
  if (!["type_text", "select_option", "set_checkbox"].includes(args.toolName)) {
    return null;
  }
  const tagId =
    numericArg(args.toolArgs, "id") ??
    numericArg(args.toolArgs, "elementId") ??
    numericArg(args.toolArgs, "tag");
  if (tagId == null) return null;
  const previousElement = args.previousSnapshot.elements.find(
    (element) => element.tag === tagId,
  );
  const currentElement = args.currentSnapshot.elements.find(
    (element) => element.tag === tagId,
  );
  if (!currentElement) return null;
  const previousState = elementState(previousElement);
  const currentState = elementState(currentElement);
  if (!currentState || previousState === currentState) return null;

  if (args.toolName === "type_text") {
    const expectedText = normalizeSnapshotText(stringArg(args.toolArgs, "text"));
    if (expectedText && !currentState.includes(expectedText)) return null;
  }

  return {
    strength: "strong",
    label: "field_state_changed",
    observed: true,
  };
}

function detectNewStateLineProgress(args: {
  previousSnapshot: DomSnapshot;
  currentSnapshot: DomSnapshot;
}): ContextProgressSignal | null {
  const previousLines = snapshotLines(args.previousSnapshot);
  const currentLines = snapshotLines(args.currentSnapshot);
  for (const line of currentLines) {
    if (!previousLines.has(line) && SEMANTIC_STATE_LINE_PATTERN.test(line)) {
      return {
        strength: "strong",
        label: "semantic_page_state_changed",
        observed: true,
      };
    }
  }
  return null;
}

function detectNewVisibleTextProgress(args: {
  previousSnapshot: DomSnapshot;
  currentSnapshot: DomSnapshot;
}): ContextProgressSignal | null {
  const previousTexts = meaningfulElementTexts(args.previousSnapshot);
  const currentTexts = meaningfulElementTexts(args.currentSnapshot);
  for (const text of currentTexts) {
    if (!previousTexts.has(text)) {
      return {
        strength: "medium",
        label: "visible_text_added",
        observed: true,
      };
    }
  }
  return null;
}

export function detectSemanticProgressSignals(args: {
  toolName?: string | null;
  toolArgs?: Record<string, unknown>;
  previousSnapshot?: DomSnapshot | null;
  currentSnapshot?: DomSnapshot | null;
}): ContextProgressSignal[] {
  const toolName = args.toolName ?? "";
  if (
    !SEMANTIC_PROGRESS_TOOLS.has(toolName) ||
    !args.previousSnapshot ||
    !args.currentSnapshot
  ) {
    return [];
  }

  const signals: ContextProgressSignal[] = [];
  const fieldSignal = detectFieldStateProgress({
    toolName,
    toolArgs: args.toolArgs,
    previousSnapshot: args.previousSnapshot,
    currentSnapshot: args.currentSnapshot,
  });
  if (fieldSignal) signals.push(fieldSignal);

  const visibleTextSignal = detectNewVisibleTextProgress({
    previousSnapshot: args.previousSnapshot,
    currentSnapshot: args.currentSnapshot,
  });
  if (visibleTextSignal) signals.push(visibleTextSignal);

  const stateLineSignal = detectNewStateLineProgress({
    previousSnapshot: args.previousSnapshot,
    currentSnapshot: args.currentSnapshot,
  });
  if (stateLineSignal) signals.push(stateLineSignal);

  return signals;
}

const OBSERVATION_PROGRESS_TOOLS = new Set([
  "find_element",
  "inspect_catalog_item",
  "inspect_chart",
  "inspect_filter_state",
  "inspect_region",
  "inspect_table",
  "read_element",
  "read_page",
]);

const OBSERVATION_FAILURE_PATTERN =
  /^(?:error|failed|failure|not found|unable|cannot|could not)\b/i;

function normalizeObservationResult(content: string): string {
  return content.replace(/\s+/g, " ").trim();
}

export function buildObservationProgressKey(args: {
  toolName: string;
  resultContent: string;
  snapshotFingerprint?: string;
}): string {
  const normalized = normalizeObservationResult(args.resultContent);
  return [
    args.toolName,
    args.snapshotFingerprint ?? "",
    fnv1a(normalized.slice(0, 4000)),
  ].join(":");
}

export function detectObservationProgressSignals(args: {
  toolName?: string | null;
  resultContent: string;
  alreadySeen: boolean;
}): ContextProgressSignal[] {
  const toolName = args.toolName ?? "";
  if (!OBSERVATION_PROGRESS_TOOLS.has(toolName) || args.alreadySeen) {
    return [];
  }

  const normalized = normalizeObservationResult(args.resultContent);
  if (
    normalized.length < 20 ||
    OBSERVATION_FAILURE_PATTERN.test(normalized)
  ) {
    return [];
  }

  return [
    {
      strength: "medium",
      label: "new_observation",
      observed: true,
    },
    {
      strength: "weak",
      label: "successful_read_tool",
      observed: true,
    },
  ];
}

export class ContextSpendTracker {
  private promptTokensSinceProgress = 0;
  private totalTokensSinceProgress = 0;
  private turnsSinceProgress = 0;
  private lastProgressTurn = 0;
  private lastProgressSignal: string | null = null;
  private highestThreshold: ContextSpendTelemetry["threshold"] = "none";

  reset(): void {
    this.promptTokensSinceProgress = 0;
    this.totalTokensSinceProgress = 0;
    this.turnsSinceProgress = 0;
    this.lastProgressTurn = 0;
    this.lastProgressSignal = null;
    this.highestThreshold = "none";
  }

  recordUsage(turn: number, usage: TokenUsage | undefined): ContextSpendTelemetry {
    this.turnsSinceProgress += 1;
    if (usage) {
      this.promptTokensSinceProgress += Math.max(0, usage.prompt_tokens ?? 0);
      this.totalTokensSinceProgress += Math.max(0, usage.total_tokens ?? 0);
    }
    this.highestThreshold = this.resolveThreshold();
    return this.snapshot(turn);
  }

  recordProgress(
    turn: number,
    signals: Array<{ strength: ProgressSignalStrength; label: string; observed: boolean }>,
  ): boolean {
    const strong = signals.find((signal) => signal.strength === "strong" && signal.observed);
    const observedSignals = signals.filter((signal) => signal.observed);
    const mediumOrWeak = observedSignals.filter((signal) => signal.strength !== "strong");
    const shouldReset = Boolean(strong) || mediumOrWeak.length >= 2;
    if (!shouldReset) return false;
    this.promptTokensSinceProgress = 0;
    this.totalTokensSinceProgress = 0;
    this.turnsSinceProgress = 0;
    this.lastProgressTurn = turn;
    this.lastProgressSignal = strong?.label ?? observedSignals.map((signal) => signal.label).join("+");
    this.highestThreshold = "none";
    return true;
  }

  snapshot(turn: number): ContextSpendTelemetry {
    return {
      turn,
      promptTokensSinceProgress: this.promptTokensSinceProgress,
      totalTokensSinceProgress: this.totalTokensSinceProgress,
      turnsSinceProgress: this.turnsSinceProgress,
      lastProgressTurn: this.lastProgressTurn,
      lastProgressSignal: this.lastProgressSignal,
      threshold: this.highestThreshold,
    };
  }

  private resolveThreshold(): ContextSpendTelemetry["threshold"] {
    if (
      this.turnsSinceProgress >= 8 ||
      this.promptTokensSinceProgress >= 150_000
    ) {
      return "pivot";
    }
    if (
      this.turnsSinceProgress >= 6 ||
      this.promptTokensSinceProgress >= 100_000
    ) {
      return "compact";
    }
    if (
      this.turnsSinceProgress >= 4 ||
      this.promptTokensSinceProgress >= 60_000
    ) {
      return "distill";
    }
    return "none";
  }
}
