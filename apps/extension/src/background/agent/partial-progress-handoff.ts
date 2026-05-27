import type {
  DomSnapshot,
  HandoffEvidence,
  HandoffItem,
  HandoffState,
  PartialHandoffReason,
  PartialProgressHandoff,
  ToolName,
} from "../../types";

const MAX_COMPLETED = 5;
const MAX_EVIDENCE = 5;
const MAX_REMAINING = 5;
const MAX_UNCERTAINTY = 5;
const MAX_ITEM_CHARS = 220;
const MAX_EVIDENCE_CHARS = 420;

export interface ProgressLedger {
  observedFacts: HandoffEvidence[];
  completedActions: HandoffItem[];
  attemptedActions: HandoffItem[];
  currentState: HandoffState;
  remainingHints: HandoffItem[];
  uncertainty: HandoffItem[];
  lastUsefulTurn: number | null;
}

export interface ToolProgressInput {
  toolName: ToolName | string;
  args: Record<string, unknown>;
  result: string;
  turn: number;
  url?: string;
}

export function createProgressLedger(): ProgressLedger {
  return {
    observedFacts: [],
    completedActions: [],
    attemptedActions: [],
    currentState: {},
    remainingHints: [],
    uncertainty: [],
    lastUsefulTurn: null,
  };
}

export function updateProgressLedgerState(
  ledger: ProgressLedger,
  snapshot: DomSnapshot | null | undefined,
  activeSubtask?: string,
  lastAction?: string,
): void {
  if (snapshot) {
    ledger.currentState = trimState({
      ...ledger.currentState,
      url: snapshot.url || ledger.currentState.url,
      title: snapshot.title || ledger.currentState.title,
      pageKind: inferPageKind(snapshot),
    });
  }
  if (activeSubtask && activeSubtask.trim()) {
    ledger.currentState.activeSubtask = truncateClean(
      activeSubtask,
      MAX_ITEM_CHARS,
    );
    addUniqueItem(ledger.remainingHints, {
      text: `Finish: ${ledger.currentState.activeSubtask}`,
      confidence: "medium",
      source: "planner",
    });
  }
  if (lastAction && lastAction.trim()) {
    ledger.currentState.lastAction = truncateClean(lastAction, MAX_ITEM_CHARS);
  }
}

export function recordProgressLedgerToolResult(
  ledger: ProgressLedger,
  input: ToolProgressInput,
): void {
  const toolName = String(input.toolName);
  const result = truncateClean(input.result, MAX_EVIDENCE_CHARS);
  const actionText = truncateClean(
    `Ran ${toolName}${formatArgs(input.args)}`,
    MAX_ITEM_CHARS,
  );
  addUniqueItem(ledger.attemptedActions, {
    text: actionText,
    confidence: "medium",
    source: "tool",
  });

  if (!result) return;

  ledger.lastUsefulTurn = input.turn;
  addUniqueItem(ledger.completedActions, {
    text:
      toolName === "read_page"
        ? "Read the current page for task context."
        : truncateClean(`${actionText}: ${result}`, MAX_ITEM_CHARS),
    confidence: "high",
    source: "tool",
  });

  if (toolName === "read_page") {
    const fact = extractReadableFact(input.result);
    if (fact) {
      addUniqueEvidence(ledger.observedFacts, {
        label: "Page evidence",
        value: fact,
        source: "read_page",
        ...(input.url ? { url: input.url } : {}),
        turn: input.turn,
      });
    }
    return;
  }

  if (toolName === "inspect_chart") {
    addUniqueEvidence(ledger.observedFacts, {
      label: "Chart evidence",
      value: result,
      source: "tool_result",
      ...(input.url ? { url: input.url } : {}),
      turn: input.turn,
    });
    return;
  }

  if (toolName === "read_element" || toolName === "xray_page") {
    addUniqueEvidence(ledger.observedFacts, {
      label: `${toolName} result`,
      value: result,
      source: "tool_result",
      ...(input.url ? { url: input.url } : {}),
      turn: input.turn,
    });
  }
}

export function buildPartialProgressHandoff(params: {
  ledger: ProgressLedger;
  task: string;
  reason: PartialHandoffReason;
  turnsUsed: number;
  maxTurns: number;
  generatedAt?: string;
}): PartialProgressHandoff {
  const completed = params.ledger.completedActions.slice(-MAX_COMPLETED);
  const evidence = params.ledger.observedFacts.slice(-MAX_EVIDENCE);
  const remaining =
    params.ledger.remainingHints.length > 0
      ? params.ledger.remainingHints.slice(-MAX_REMAINING)
      : [
          {
            text: "Resume from the current page, verify the state still matches this handoff, then finish the original request.",
            confidence: "medium" as const,
            source: "planner" as const,
          },
        ];
  const uncertainty = params.ledger.uncertainty.slice(-MAX_UNCERTAINTY);
  if (!hasUsefulProgress(params.ledger)) {
    uncertainty.push({
      text: "No durable page evidence was captured before the run stopped.",
      confidence: "high",
      source: "trace",
    });
  } else if (params.reason === "max_turns") {
    uncertainty.push({
      text: "The original task is incomplete because the turn budget was exhausted before done() could verify completion.",
      confidence: "high",
      source: "trace",
    });
  }

  const handoff: PartialProgressHandoff = {
    schemaVersion: "2026-05-26",
    reason: params.reason,
    status: "partial_handoff",
    task: params.task,
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    turnsUsed: params.turnsUsed,
    maxTurns: params.maxTurns,
    completed,
    evidence,
    currentState: trimState(params.ledger.currentState),
    remaining,
    uncertainty: dedupeItems(uncertainty).slice(-MAX_UNCERTAINTY),
    suggestedContinuationPrompt: "",
  };
  handoff.suggestedContinuationPrompt =
    buildSuggestedContinuationPrompt(handoff);
  return handoff;
}

export function formatPartialProgressHandoffSummary(
  handoff: PartialProgressHandoff,
): string {
  const hasUsefulProgress = hasUsefulPartialProgressHandoff(handoff);
  const reason = formatHandoffReason(handoff.reason);
  const lines = [
    hasUsefulProgress
      ? `Status: Partial - ${reason}`
      : `Status: Incomplete - ${reason}`,
    "",
    hasUsefulProgress
      ? formatUsefulHandoffIntro(handoff, reason)
      : formatEmptyHandoffIntro(handoff, reason),
    "",
    ...formatItemSection("What was completed", handoff.completed),
    ...formatEvidenceSection("Evidence gathered", handoff.evidence),
    ...formatStateSection(handoff.currentState),
    ...formatItemSection("What remains", handoff.remaining),
    ...formatItemSection("Uncertainty", handoff.uncertainty),
    "Suggested continuation:",
    handoff.suggestedContinuationPrompt,
  ];
  return lines.join("\n").trim();
}

export function hasUsefulPartialProgressHandoff(
  handoff: PartialProgressHandoff | null | undefined,
): boolean {
  return Boolean(
    handoff &&
      (handoff.completed.length > 0 || handoff.evidence.length > 0),
  );
}

function hasUsefulProgress(ledger: ProgressLedger): boolean {
  return ledger.completedActions.length > 0 || ledger.observedFacts.length > 0;
}

function formatUsefulHandoffIntro(
  handoff: PartialProgressHandoff,
  reason: string,
): string {
  if (handoff.reason === "max_turns") {
    return (
      `I reached the turn limit (${handoff.turnsUsed}/${handoff.maxTurns}) ` +
      "before finishing the task. This is incomplete, but the useful progress " +
      "below can be used to continue."
    );
  }
  return (
    `The run stopped because of ${reason} before finishing the task. ` +
    "This is incomplete, but the useful progress below can be used to continue."
  );
}

function formatEmptyHandoffIntro(
  handoff: PartialProgressHandoff,
  reason: string,
): string {
  if (handoff.reason === "max_turns") {
    return (
      `I reached the turn limit (${handoff.turnsUsed}/${handoff.maxTurns}) ` +
      "before finishing the task. No durable progress was captured, but the " +
      "uncertainty and continuation prompt below can be used for a fresh attempt."
    );
  }
  return (
    `The run stopped because of ${reason} before finishing the task. ` +
    "No durable progress was captured, but the uncertainty and continuation " +
    "prompt below can be used for a fresh attempt."
  );
}

function formatHandoffReason(reason: PartialHandoffReason): string {
  switch (reason) {
    case "max_turns":
      return "turn budget exhausted";
    case "timeout":
      return "timeout";
    case "tool_error":
      return "tool error";
    case "provider_error":
      return "provider error";
    case "manual_stop":
      return "manual stop";
  }
}

function buildSuggestedContinuationPrompt(
  handoff: PartialProgressHandoff,
): string {
  const found = [
    ...handoff.evidence.map((item) => `- ${item.label}: ${item.value}`),
    ...handoff.completed.map((item) => `- ${item.text}`),
  ].slice(0, 6);
  const remaining = handoff.remaining.map((item) => `- ${item.text}`);
  const state = [
    handoff.currentState.title ? `page title: ${handoff.currentState.title}` : "",
    handoff.currentState.url ? `URL: ${handoff.currentState.url}` : "",
    handoff.currentState.activeSubtask
      ? `active step: ${handoff.currentState.activeSubtask}`
      : "",
  ]
    .filter(Boolean)
    .join("; ");

  return [
    "Continue from the previous partial handoff. The prior run found:",
    found.length > 0 ? found.join("\n") : "- No durable evidence was captured.",
    state ? `\nCurrent state to verify first: ${state}` : "",
    "\nDo not redo completed checks unless the page state has changed. First verify the current page still matches the handoff, then finish:",
    remaining.length > 0
      ? remaining.join("\n")
      : "- Finish the original request from the current page.",
  ]
    .filter((part) => part !== "")
    .join("\n");
}

function formatItemSection(title: string, items: HandoffItem[]): string[] {
  if (items.length === 0) return [title + ":", "- None captured.", ""];
  return [
    title + ":",
    ...items.map((item) => `- ${item.text} (${item.confidence})`),
    "",
  ];
}

function formatEvidenceSection(
  title: string,
  items: HandoffEvidence[],
): string[] {
  if (items.length === 0) return [title + ":", "- None captured.", ""];
  return [
    title + ":",
    ...items.map((item) => {
      const suffix = item.url ? ` [${item.source}, turn ${item.turn ?? "?"}]` : ` [${item.source}]`;
      return `- ${item.label}: ${item.value}${suffix}`;
    }),
    "",
  ];
}

function formatStateSection(state: HandoffState): string[] {
  const parts = [
    state.title ? `Title: ${state.title}` : null,
    state.url ? `URL: ${state.url}` : null,
    state.pageKind ? `Page kind: ${state.pageKind}` : null,
    state.activeSubtask ? `Active step: ${state.activeSubtask}` : null,
    state.lastAction ? `Last action: ${state.lastAction}` : null,
  ].filter(Boolean);
  return [
    "Current page/state:",
    ...(parts.length > 0 ? parts.map((part) => `- ${part}`) : ["- Unknown."]),
    "",
  ];
}

function extractReadableFact(result: string): string {
  const withoutPrefix = result
    .replace(/^Page content:\s*/i, "")
    .replace(/^Visible page content:\s*/i, "")
    .trim();
  return truncateClean(withoutPrefix, MAX_EVIDENCE_CHARS);
}

function inferPageKind(snapshot: DomSnapshot): string | undefined {
  const elementRoles = snapshot.elements.map((element) => element.role);
  if (elementRoles.includes("table")) return "table";
  if (snapshot.elements.some((element) => element.tagName === "form")) {
    return "form";
  }
  if (snapshot.elements.some((element) => element.role === "button")) {
    return "interactive page";
  }
  return snapshot.pageContent || snapshot.visibleContent ? "document" : undefined;
}

function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args)
    .filter(([, value]) => value !== undefined)
    .slice(0, 3);
  if (entries.length === 0) return "";
  const text = entries
    .map(([key, value]) => `${key}=${formatArgValue(value)}`)
    .join(", ");
  return ` (${text})`;
}

function formatArgValue(value: unknown): string {
  if (typeof value === "string") return truncateClean(value, 80);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value == null) return "null";
  return truncateClean(JSON.stringify(value), 80);
}

function addUniqueItem(target: HandoffItem[], item: HandoffItem): void {
  const normalized = normalizeText(item.text);
  if (!normalized) return;
  if (target.some((existing) => normalizeText(existing.text) === normalized)) {
    return;
  }
  target.push({ ...item, text: truncateClean(item.text, MAX_ITEM_CHARS) });
  while (target.length > MAX_COMPLETED) target.shift();
}

function addUniqueEvidence(
  target: HandoffEvidence[],
  item: HandoffEvidence,
): void {
  const normalized = normalizeText(`${item.label}:${item.value}`);
  if (!normalized) return;
  if (
    target.some(
      (existing) => normalizeText(`${existing.label}:${existing.value}`) === normalized,
    )
  ) {
    return;
  }
  target.push({
    ...item,
    value: truncateClean(item.value, MAX_EVIDENCE_CHARS),
  });
  while (target.length > MAX_EVIDENCE) target.shift();
}

function dedupeItems(items: HandoffItem[]): HandoffItem[] {
  const seen = new Set<string>();
  const output: HandoffItem[] = [];
  for (const item of items) {
    const key = normalizeText(item.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function trimState(state: HandoffState): HandoffState {
  return {
    ...(state.url ? { url: truncateClean(state.url, 500) } : {}),
    ...(state.title ? { title: truncateClean(state.title, MAX_ITEM_CHARS) } : {}),
    ...(state.pageKind
      ? { pageKind: truncateClean(state.pageKind, MAX_ITEM_CHARS) }
      : {}),
    ...(state.activeSubtask
      ? { activeSubtask: truncateClean(state.activeSubtask, MAX_ITEM_CHARS) }
      : {}),
    ...(state.lastAction
      ? { lastAction: truncateClean(state.lastAction, MAX_ITEM_CHARS) }
      : {}),
  };
}

function truncateClean(value: string, maxChars: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "...";
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}
