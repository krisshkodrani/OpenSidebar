interface ToolCallLike {
  name: string;
  args: Record<string, unknown>;
}

interface ToolExecutionLike {
  name: string;
  success: boolean;
  text: string;
}

interface TraceEntryLike {
  workspaceId?: string | null;
  turnNumber?: number;
  url?: string;
  title?: string;
  toolCalls?: Array<{
    name?: string;
    args?: Record<string, unknown>;
  }>;
  toolResults?: Array<{
    name?: string;
    success?: boolean;
    result?: string;
    error?: string;
  }>;
  snapshot?: {
    url?: string;
    title?: string;
    pageContent?: string;
    scroll?: {
      y?: number;
      maxY?: number;
    };
  };
  llmResponse?: {
    content?: string | null;
    toolCalls?: Array<{
      function?: {
        name?: string;
        arguments?: string | Record<string, unknown>;
      };
      name?: string;
      args?: Record<string, unknown>;
    }>;
  };
  toolExecutions?: Array<{
    toolName?: string;
    success?: boolean;
    result?: string;
    error?: string;
  }>;
}

export interface RuntimeDiagnostic {
  type:
    | "mixed_workspace_ids"
    | "unexpected_workspace_id"
    | "repeated_done_rejection"
    | "stalled_right_click_loop"
    | "stalled_scroll_loop"
    | "stalled_go_back_loop";
  severity: "high" | "medium";
  message: string;
  turnNumber?: number;
}

interface ParsedTurn {
  workspaceId: string | null;
  turnNumber: number;
  url: string;
  title: string;
  pageContent: string;
  scrollY: number | null;
  maxY: number | null;
  llmContent: string;
  toolCalls: ToolCallLike[];
  toolExecutions: ToolExecutionLike[];
}

const RIGHT_CLICK_SUCCESS_HINTS = [
  "context menu",
  "rename",
  "menu opened",
  "opened menu",
];

const DONE_REJECTION_HINTS = [
  "rejected",
  "reject",
  "incomplete",
  "not complete",
  "planner rejected",
];

export function analyzeAgentRuntimeDiagnostics(
  entries: TraceEntryLike[],
  options: { expectedWorkspaceId?: string | null } = {},
): RuntimeDiagnostic[] {
  const turns = entries
    .map((entry) => parseTurn(entry))
    .filter((turn): turn is ParsedTurn => turn !== null);
  if (turns.length === 0) return [];

  const diagnostics: RuntimeDiagnostic[] = [];
  diagnostics.push(...diagnoseWorkspaceIsolation(turns, options.expectedWorkspaceId ?? null));
  diagnostics.push(...diagnoseDoneRejectionLoop(turns));
  diagnostics.push(...diagnoseRightClickLoops(turns));
  diagnostics.push(...diagnoseScrollLoops(turns));
  diagnostics.push(...diagnoseGoBackLoops(turns));
  return diagnostics;
}

export function formatRuntimeDiagnostics(diagnostics: RuntimeDiagnostic[]): string {
  if (diagnostics.length === 0) return "";

  const lines = ["Runtime diagnostics:"];
  for (const diagnostic of diagnostics) {
    const turnPart = typeof diagnostic.turnNumber === "number"
      ? ` T${diagnostic.turnNumber}`
      : "";
    lines.push(`  [${diagnostic.severity}] ${diagnostic.type}${turnPart}: ${diagnostic.message}`);
  }
  return lines.join("\n");
}

function diagnoseWorkspaceIsolation(
  turns: ParsedTurn[],
  expectedWorkspaceId: string | null,
): RuntimeDiagnostic[] {
  const diagnostics: RuntimeDiagnostic[] = [];
  const workspaceIds = Array.from(
    new Set(turns.map((turn) => turn.workspaceId).filter((value): value is string => Boolean(value))),
  );

  if (workspaceIds.length > 1) {
    diagnostics.push({
      type: "mixed_workspace_ids",
      severity: "high",
      turnNumber: turns[0]?.turnNumber,
      message: `Trace contains multiple workspace IDs: ${workspaceIds.join(", ")}.`,
    });
  }

  if (
    expectedWorkspaceId &&
    workspaceIds.length > 0 &&
    workspaceIds.some((workspaceId) => workspaceId !== expectedWorkspaceId)
  ) {
    diagnostics.push({
      type: "unexpected_workspace_id",
      severity: "high",
      turnNumber: turns[0]?.turnNumber,
      message: `Expected workspace ${expectedWorkspaceId} but saw ${workspaceIds.join(", ")}.`,
    });
  }

  return diagnostics;
}

function diagnoseDoneRejectionLoop(turns: ParsedTurn[]): RuntimeDiagnostic[] {
  let streak = 0;
  let firstTurn: ParsedTurn | null = null;

  for (const turn of turns) {
    const calledDone = turn.toolCalls.some((toolCall) => toolCall.name === "done");
    const doneRejected = turn.toolExecutions.some(
      (execution) =>
        execution.name === "done" &&
        (!execution.success || includesAny(execution.text, DONE_REJECTION_HINTS)),
    );

    if (calledDone && doneRejected) {
      streak += 1;
      firstTurn ??= turn;
      if (streak >= 2) {
        return [{
          type: "repeated_done_rejection",
          severity: "medium",
          turnNumber: firstTurn.turnNumber,
          message: `done() was rejected ${streak} times on the same trace, which usually indicates premature completion bias.`,
        }];
      }
      continue;
    }

    streak = 0;
    firstTurn = null;
  }

  return [];
}

function diagnoseRightClickLoops(turns: ParsedTurn[]): RuntimeDiagnostic[] {
  const diagnostics: RuntimeDiagnostic[] = [];
  let group: ParsedTurn[] = [];
  let activeUrl = "";
  let activeTarget: string | null = null;

  const flush = () => {
    if (group.length < 3) {
      group = [];
      activeUrl = "";
      activeTarget = null;
      return;
    }

    const combinedText = group.map(buildTurnText).join(" ");
    const hasSuccessHint = includesAny(combinedText, RIGHT_CLICK_SUCCESS_HINTS);
    if (!hasSuccessHint) {
      diagnostics.push({
        type: "stalled_right_click_loop",
        severity: "medium",
        turnNumber: group[0].turnNumber,
        message: `right_click repeated ${group.length} times on ${activeTarget ?? "the same target"} without a visible menu transition.`,
      });
    }

    group = [];
    activeUrl = "";
    activeTarget = null;
  };

  for (const turn of turns) {
    const rightClick = turn.toolCalls.find((toolCall) => toolCall.name === "right_click");
    if (!rightClick) {
      flush();
      continue;
    }

    const target = stringifyTarget(rightClick.args);
    if (
      group.length > 0 &&
      (turn.url !== activeUrl || target !== activeTarget)
    ) {
      flush();
    }

    if (group.length === 0) {
      activeUrl = turn.url;
      activeTarget = target;
    }

    group.push(turn);
  }

  flush();
  return diagnostics;
}

function diagnoseScrollLoops(turns: ParsedTurn[]): RuntimeDiagnostic[] {
  const diagnostics: RuntimeDiagnostic[] = [];
  let group: ParsedTurn[] = [];
  let activeUrl = "";

  const flush = () => {
    if (group.length < 3) {
      group = [];
      activeUrl = "";
      return;
    }

    const first = group[0];
    const last = group[group.length - 1];
    const firstY = first.scrollY ?? 0;
    const lastY = last.scrollY ?? firstY;
    const totalDelta = Math.abs(lastY - firstY);
    const maxY = last.maxY ?? first.maxY ?? 0;

    if (totalDelta < 150 && maxY > 0) {
      diagnostics.push({
        type: "stalled_scroll_loop",
        severity: "medium",
        turnNumber: first.turnNumber,
        message: `scroll_page repeated ${group.length} times on the same URL with only ${totalDelta}px of net scroll progress.`,
      });
    }

    group = [];
    activeUrl = "";
  };

  for (const turn of turns) {
    const scrolled = turn.toolCalls.some((toolCall) => toolCall.name === "scroll_page");
    if (!scrolled) {
      flush();
      continue;
    }

    if (group.length > 0 && turn.url !== activeUrl) {
      flush();
    }

    if (group.length === 0) {
      activeUrl = turn.url;
    }

    group.push(turn);
  }

  flush();
  return diagnostics;
}

function diagnoseGoBackLoops(turns: ParsedTurn[]): RuntimeDiagnostic[] {
  const diagnostics: RuntimeDiagnostic[] = [];
  let group: ParsedTurn[] = [];
  let activeUrl = "";

  const flush = () => {
    if (group.length < 2) {
      group = [];
      activeUrl = "";
      return;
    }

    const uniqueUrls = new Set(group.map((turn) => turn.url).filter(Boolean));
    if (uniqueUrls.size <= 1) {
      diagnostics.push({
        type: "stalled_go_back_loop",
        severity: "medium",
        turnNumber: group[0].turnNumber,
        message: `go_back repeated ${group.length} times without changing URL, which suggests history/objective drift or blocked navigation.`,
      });
    }

    group = [];
    activeUrl = "";
  };

  for (const turn of turns) {
    const wentBack = turn.toolCalls.some((toolCall) => toolCall.name === "go_back");
    if (!wentBack) {
      flush();
      continue;
    }

    if (group.length > 0 && turn.url !== activeUrl) {
      flush();
    }

    if (group.length === 0) {
      activeUrl = turn.url;
    }

    group.push(turn);
  }

  flush();
  return diagnostics;
}

function parseTurn(entry: TraceEntryLike): ParsedTurn | null {
  const directToolCalls = Array.isArray(entry.toolCalls)
    ? entry.toolCalls.map((toolCall) => ({
        name: toolCall.name ?? "",
        args: toolCall.args ?? {},
      })).filter((toolCall) => toolCall.name.length > 0)
    : [];
  const responseToolCalls = Array.isArray(entry.llmResponse?.toolCalls)
    ? entry.llmResponse.toolCalls.map((toolCall) => ({
        name: toolCall.function?.name ?? toolCall.name ?? "",
        args: parseArgs(toolCall.function?.arguments ?? toolCall.args ?? {}),
      })).filter((toolCall) => toolCall.name.length > 0)
    : [];
  const toolCalls = directToolCalls.length > 0 ? directToolCalls : responseToolCalls;

  const directToolResults = Array.isArray(entry.toolResults)
    ? entry.toolResults.map((execution) => ({
        name: execution.name ?? "",
        success: execution.success !== false,
        text: [execution.result ?? "", execution.error ?? ""].filter(Boolean).join(" "),
      })).filter((execution) => execution.name.length > 0)
    : [];
  const rawToolExecutions = Array.isArray(entry.toolExecutions)
    ? entry.toolExecutions.map((execution) => ({
        name: execution.toolName ?? "",
        success: execution.success !== false,
        text: [execution.result ?? "", execution.error ?? ""].filter(Boolean).join(" "),
      })).filter((execution) => execution.name.length > 0)
    : [];
  const toolExecutions = directToolResults.length > 0 ? directToolResults : rawToolExecutions;

  return {
    workspaceId: typeof entry.workspaceId === "string" ? entry.workspaceId : null,
    turnNumber: typeof entry.turnNumber === "number" ? entry.turnNumber : 0,
    url: typeof entry.snapshot?.url === "string" ? entry.snapshot.url : typeof entry.url === "string" ? entry.url : "",
    title: typeof entry.snapshot?.title === "string" ? entry.snapshot.title : typeof entry.title === "string" ? entry.title : "",
    pageContent: typeof entry.snapshot?.pageContent === "string" ? entry.snapshot.pageContent : "",
    scrollY: typeof entry.snapshot?.scroll?.y === "number" ? entry.snapshot.scroll.y : null,
    maxY: typeof entry.snapshot?.scroll?.maxY === "number" ? entry.snapshot.scroll.maxY : null,
    llmContent: typeof entry.llmResponse?.content === "string" ? entry.llmResponse.content : "",
    toolCalls,
    toolExecutions,
  };
}

function parseArgs(raw: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof raw === "object" && raw !== null) {
    return raw;
  }

  if (typeof raw !== "string") {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function buildTurnText(turn: ParsedTurn): string {
  return [
    turn.title,
    turn.pageContent,
    turn.llmContent,
    ...turn.toolExecutions.map((execution) => execution.text),
  ].join(" ").toLowerCase();
}

function includesAny(value: string, needles: string[]): boolean {
  const normalized = value.toLowerCase();
  return needles.some((needle) => normalized.includes(needle));
}

function stringifyTarget(args: Record<string, unknown>): string | null {
  if (typeof args.id === "number" || typeof args.id === "string") {
    return String(args.id);
  }
  return null;
}
