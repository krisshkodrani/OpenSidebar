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
    .reduce((sum, message) => sum + contentToString(message.content).length, 0);
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
  const ranges = sectionRanges(systemContent);
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
