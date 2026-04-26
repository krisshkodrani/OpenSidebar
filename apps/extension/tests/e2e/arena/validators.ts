import type { E2EHarness } from "../helpers/harness";
import {
  extractDoneSummary,
  filterTraceFilesByWorkspace,
  findAllNewTraceFiles,
  readTrace,
  type TraceTurn,
} from "../helpers/diagnostics";
import {
  assertNodeIsolation,
  getMonitoredEvents,
  waitForOutcome,
  waitForTaskCompletion,
} from "../helpers/utils";
import type { ArenaTask } from "./tasks";

export interface ArenaRunContext {
  task: ArenaTask;
  harness: E2EHarness;
  workspaceId: string;
}

export interface ArenaValidatorResult {
  ok: boolean;
  reason: string;
  details: string[];
  data?: Record<string, unknown>;
  traceFiles: string[];
  traceTurns: TraceTurn[];
  doneSummary: string;
}

export type ArenaValidator = (
  context: ArenaRunContext,
) => Promise<ArenaValidatorResult>;

function getTaskCompletionSummary(events: any[], fallback = ""): string {
  const completion = [...events]
    .reverse()
    .find((event: any) => event.type === "TASK_COMPLETION");
  const summary = completion?.payload?.summary;
  return typeof summary === "string" && summary.trim().length > 0
    ? summary
    : fallback;
}

async function collectTraceData(
  harness: E2EHarness,
  workspaceId: string,
): Promise<{
  traceFiles: string[];
  traceTurns: TraceTurn[];
  doneSummary: string;
}> {
  const traceFiles = filterTraceFilesByWorkspace(
    findAllNewTraceFiles(harness.tracesBefore),
    workspaceId,
  );
  const traceTurns = traceFiles.flatMap((filePath) => readTrace(filePath));
  const doneSummary = extractDoneSummary(traceFiles);
  return { traceFiles, traceTurns, doneSummary };
}

function buildResult(
  ok: boolean,
  reason: string,
  details: string[],
  traceFiles: string[],
  traceTurns: TraceTurn[],
  doneSummary: string,
  data?: Record<string, unknown>,
): ArenaValidatorResult {
  return {
    ok,
    reason,
    details,
    traceFiles,
    traceTurns,
    doneSummary,
    ...(data ? { data } : {}),
  };
}

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function includesAny(text: string, values: readonly string[]): boolean {
  return values.some((value) => text.includes(value));
}

async function supportTicketTriaged(
  context: ArenaRunContext,
): Promise<ArenaValidatorResult> {
  const { harness, workspaceId } = context;

  const outcome = await waitForOutcome(
    harness.page,
    harness.ctx.serviceWorker,
    async () => {
      const result = await harness.page.evaluate(
        () => (window as any).ticketResult ?? null,
      );
      if (!result) return null;
      if (!result.statusChanged || result.commentsAdded < 1) return null;
      return result;
    },
    context.task.timeoutMs,
    workspaceId,
  );

  const { traceFiles, traceTurns, doneSummary } = await collectTraceData(
    harness,
    workspaceId,
  );

  if (!outcome.ok) {
    return buildResult(
      false,
      outcome.reason,
      ["Ticket triage did not reach a successful final state."],
      traceFiles,
      traceTurns,
      doneSummary,
    );
  }

  const result = outcome.result as any;
  const comment = String(result.lastComment ?? "").toLowerCase();
  const mentionsIssue =
    comment.includes("csv") ||
    comment.includes("export") ||
    comment.includes("timeout") ||
    comment.includes("report");

  const ok =
    result.currentStatus === "In Progress" &&
    result.commentsAdded >= 1 &&
    result.lastCommentInternal === true &&
    mentionsIssue;

  return buildResult(
    ok,
    ok ? "validated" : "ticket_state_mismatch",
    [
      `status=${result.currentStatus}`,
      `comments=${result.commentsAdded}`,
      `internal=${String(result.lastCommentInternal)}`,
    ],
    traceFiles,
    traceTurns,
    doneSummary,
    {
      status: result.currentStatus,
      commentsAdded: result.commentsAdded,
      lastCommentInternal: result.lastCommentInternal,
    },
  );
}

async function ticketEscalatedWithAccountContext(
  context: ArenaRunContext,
): Promise<ArenaValidatorResult> {
  const { harness, workspaceId } = context;

  const outcome = await waitForOutcome(
    harness.page,
    harness.ctx.serviceWorker,
    async () => {
      const result = await harness.page.evaluate(
        () => (window as any).ticketResult ?? null,
      );
      if (!result) return null;
      if (!result.statusChanged || !result.priorityChanged) return null;
      if (result.commentsAdded < 1) return null;
      return result;
    },
    context.task.timeoutMs,
    workspaceId,
  );

  const { traceFiles, traceTurns, doneSummary } = await collectTraceData(
    harness,
    workspaceId,
  );

  if (!outcome.ok) {
    return buildResult(
      false,
      outcome.reason,
      ["Ticket escalation task did not reach a successful final state."],
      traceFiles,
      traceTurns,
      doneSummary,
    );
  }

  const result = outcome.result as any;
  const comment = normalizeText(result.lastComment);
  const hasIssue = includesAny(comment, ["csv", "export", "timeout", "report"]);
  const hasAccountContext = includesAny(comment, [
    "enterprise",
    "clientcorp",
    "clt-9402",
    "org id",
  ]);
  const hasNextStep = includesAny(comment, [
    "next",
    "investigate",
    "engineering",
    "reproduce",
    "escalat",
  ]);
  const ok =
    result.currentStatus === "In Progress" &&
    result.currentPriority === "Urgent" &&
    result.lastCommentInternal === true &&
    hasIssue &&
    hasAccountContext &&
    hasNextStep;

  return buildResult(
    ok,
    ok ? "validated" : "ticket_escalation_incomplete",
    [
      `status=${String(result.currentStatus ?? "")}`,
      `priority=${String(result.currentPriority ?? "")}`,
      `internal=${String(result.lastCommentInternal)}`,
      `hasIssue=${String(hasIssue)}`,
      `hasAccountContext=${String(hasAccountContext)}`,
      `hasNextStep=${String(hasNextStep)}`,
    ],
    traceFiles,
    traceTurns,
    doneSummary,
    {
      status: result.currentStatus,
      priority: result.currentPriority,
      hasIssue,
      hasAccountContext,
      hasNextStep,
    },
  );
}

async function enterpriseFormSubmitted(
  context: ArenaRunContext,
): Promise<ArenaValidatorResult> {
  const { harness, workspaceId } = context;

  const outcome = await waitForOutcome(
    harness.page,
    harness.ctx.serviceWorker,
    async () =>
      (await harness.page.evaluate(() => (window as any).formResult ?? null)) ||
      null,
    context.task.timeoutMs,
    workspaceId,
  );

  const { traceFiles, traceTurns, doneSummary } = await collectTraceData(
    harness,
    workspaceId,
  );

  if (!outcome.ok) {
    return buildResult(
      false,
      outcome.reason,
      ["Enterprise request form did not submit successfully."],
      traceFiles,
      traceTurns,
      doneSummary,
    );
  }

  const result = outcome.result as any;
  const ok =
    result?.name === "Jane Smith" &&
    result?.email === "jane@example.com" &&
    result?.category === "Enterprise" &&
    result?.company === "Acme Corp" &&
    /premium/i.test(String(result?.budget ?? "")) &&
    /^REF-/.test(String(result?.refNumber ?? ""));

  return buildResult(
    ok,
    ok ? "validated" : "form_result_mismatch",
    [
      `name=${String(result?.name ?? "")}`,
      `email=${String(result?.email ?? "")}`,
      `category=${String(result?.category ?? "")}`,
      `company=${String(result?.company ?? "")}`,
    ],
    traceFiles,
    traceTurns,
    doneSummary,
    {
      refNumber: result?.refNumber,
      category: result?.category,
      company: result?.company,
    },
  );
}

async function dianaSalaryFound(
  context: ArenaRunContext,
): Promise<ArenaValidatorResult> {
  const { harness, workspaceId } = context;

  const outcome = await waitForOutcome(
    harness.page,
    harness.ctx.serviceWorker,
    async () => {
      const result = await harness.page.evaluate(
        () => (window as any).tableResult ?? null,
      );
      if (result && result.dianaFound) return result;
      return null;
    },
    context.task.timeoutMs,
    workspaceId,
  );

  const { traceFiles, traceTurns, doneSummary } = await collectTraceData(
    harness,
    workspaceId,
  );

  if (!outcome.ok) {
    return buildResult(
      false,
      outcome.reason,
      ["Employee directory lookup did not find Diana Chen."],
      traceFiles,
      traceTurns,
      doneSummary,
    );
  }

  const result = outcome.result as any;
  const ok = result?.dianaFound === true && Boolean(result?.dianaSalary);

  return buildResult(
    ok,
    ok ? "validated" : "salary_not_found",
    [`salary=${String(result?.dianaSalary ?? "")}`],
    traceFiles,
    traceTurns,
    doneSummary,
    { salary: result?.dianaSalary },
  );
}

async function hoverMenuProductLookup(
  context: ArenaRunContext,
): Promise<ArenaValidatorResult> {
  const { harness, workspaceId } = context;

  const outcome = await waitForOutcome(
    harness.page,
    harness.ctx.serviceWorker,
    async () => {
      const result = await harness.page.evaluate(
        () => (window as any).hoverResult ?? null,
      );
      if (result?.searchCompleted === true) return result;
      return null;
    },
    context.task.timeoutMs,
    workspaceId,
  );

  const { traceFiles, traceTurns, doneSummary } = await collectTraceData(
    harness,
    workspaceId,
  );

  if (!outcome.ok) {
    return buildResult(
      false,
      outcome.reason,
      ["Menu lookup task did not complete the SKU search."],
      traceFiles,
      traceTurns,
      doneSummary,
    );
  }

  const result = outcome.result as any;
  const searchQuery = normalizeText(result.searchQuery);
  const ok =
    result.categorySelected === "Electronics" &&
    result.searchCompleted === true &&
    searchQuery.includes("sku-4829");

  return buildResult(
    ok,
    ok ? "validated" : "menu_lookup_incomplete",
    [
      `category=${String(result.categorySelected ?? "")}`,
      `searchQuery=${String(result.searchQuery ?? "")}`,
    ],
    traceFiles,
    traceTurns,
    doneSummary,
    {
      categorySelected: result.categorySelected,
      searchQuery: result.searchQuery,
    },
  );
}

async function highestSalaryAnswered(
  context: ArenaRunContext,
): Promise<ArenaValidatorResult> {
  const { harness, workspaceId } = context;

  const outcome = await waitForTaskCompletion(
    harness.ctx,
    context.task.timeoutMs,
    workspaceId,
  );

  const { traceFiles, traceTurns, doneSummary } = await collectTraceData(
    harness,
    workspaceId,
  );
  const summary = getTaskCompletionSummary(outcome.events, doneSummary);
  const normalized = normalizeText(summary);
  const namesHighestEmployee =
    normalized.includes("isla wright") ||
    (normalized.includes("isla") && normalized.includes("wright"));
  const namesSalary =
    normalized.includes("113,854") ||
    normalized.includes("113854") ||
    normalized.includes("$113");

  const ok = outcome.ok && namesHighestEmployee && namesSalary;
  return buildResult(
    ok,
    ok ? "validated" : outcome.ok ? "highest_salary_answer_incomplete" : outcome.reason,
    [
      `namesHighestEmployee=${String(namesHighestEmployee)}`,
      `namesSalary=${String(namesSalary)}`,
      `summary=${summary.slice(0, 160) || "-"}`,
    ],
    traceFiles,
    traceTurns,
    summary,
    {
      expectedEmployee: "Isla Wright",
      expectedSalary: "$113,854",
      namesHighestEmployee,
      namesSalary,
    },
  );
}

async function workspaceChoiceDeferred(
  context: ArenaRunContext,
): Promise<ArenaValidatorResult> {
  const { harness, workspaceId } = context;

  const outcome = await waitForTaskCompletion(
    harness.ctx,
    context.task.timeoutMs,
    workspaceId,
  );

  const { traceFiles, traceTurns, doneSummary } = await collectTraceData(
    harness,
    workspaceId,
  );
  const selected = await harness.page.evaluate(
    () => (window as any).__workspaceSelection ?? null,
  );
  const summary = getTaskCompletionSummary(outcome.events, doneSummary);
  const normalized = normalizeText(summary);
  const asksForContext = includesAny(normalized, [
    "which workspace",
    "which one",
    "need",
    "clarify",
    "clarification",
    "alpha or beta",
    "not specified",
  ]);
  const ok = selected === null && asksForContext;

  return buildResult(
    ok,
    ok ? "validated" : "workspace_choice_not_deferred",
    [
      `selected=${selected === null ? "none" : JSON.stringify(selected)}`,
      `asksForContext=${String(asksForContext)}`,
      `completionReason=${outcome.reason}`,
      `summary=${summary.slice(0, 160) || "-"}`,
    ],
    traceFiles,
    traceTurns,
    summary,
    {
      selected,
      asksForContext,
      completionReason: outcome.reason,
    },
  );
}

async function emailMeetingReplySent(
  context: ArenaRunContext,
): Promise<ArenaValidatorResult> {
  const { harness, workspaceId } = context;

  const outcome = await waitForOutcome(
    harness.page,
    harness.ctx.serviceWorker,
    async () => {
      const result = await harness.page.evaluate(
        () => (window as any).emailResult ?? null,
      );
      if (result?.sent === true) return result;
      return null;
    },
    context.task.timeoutMs,
    workspaceId,
  );

  const { traceFiles, traceTurns, doneSummary } = await collectTraceData(
    harness,
    workspaceId,
  );

  if (!outcome.ok) {
    return buildResult(
      false,
      outcome.reason,
      ["Email reply task did not send a reply."],
      traceFiles,
      traceTurns,
      doneSummary,
    );
  }

  const result = outcome.result as any;
  const message = normalizeText(result.message);
  const hasSchedule =
    message.includes("friday") &&
    (message.includes("10 am") || message.includes("10:00"));
  const hasAgenda =
    includesAny(message, ["roadmap", "ai integration"]) &&
    message.includes("budget") &&
    includesAny(message, ["hiring", "candidate"]);
  const ok =
    result.to === "david.park@company.com" &&
    result.sent === true &&
    hasSchedule &&
    hasAgenda;

  return buildResult(
    ok,
    ok ? "validated" : "email_reply_incomplete",
    [
      `to=${String(result.to ?? "")}`,
      `hasSchedule=${String(hasSchedule)}`,
      `hasAgenda=${String(hasAgenda)}`,
    ],
    traceFiles,
    traceTurns,
    doneSummary,
    {
      to: result.to,
      hasSchedule,
      hasAgenda,
    },
  );
}

async function releaseCoordinationReplySent(
  context: ArenaRunContext,
): Promise<ArenaValidatorResult> {
  const { harness, workspaceId } = context;

  const outcome = await waitForOutcome(
    harness.page,
    harness.ctx.serviceWorker,
    async () => {
      const result = await harness.page.evaluate(
        () => (window as any).chatResult ?? null,
      );
      if (result?.sent === true) return result;
      return null;
    },
    context.task.timeoutMs,
    workspaceId,
  );

  const { traceFiles, traceTurns, doneSummary } = await collectTraceData(
    harness,
    workspaceId,
  );

  if (!outcome.ok) {
    return buildResult(
      false,
      outcome.reason,
      ["Release coordination task did not send a chat reply."],
      traceFiles,
      traceTurns,
      doneSummary,
    );
  }

  const result = outcome.result as any;
  const message = normalizeText(result.message);
  const hasTiming = includesAny(message, [
    "wednesday",
    "wed",
    "after onboarding",
    "not set",
    "not confirmed",
    "green light",
  ]);
  const hasChangelogOwner =
    message.includes("release owner") || message.includes("alice");
  const hasBlocker = includesAny(message, [
    "onboarding",
    "progress indicator",
    "edge case",
    "green light",
  ]);
  const ok = result.sent === true && hasTiming && hasChangelogOwner && hasBlocker;

  return buildResult(
    ok,
    ok ? "validated" : "release_coordination_reply_incomplete",
    [
      `hasTiming=${String(hasTiming)}`,
      `hasChangelogOwner=${String(hasChangelogOwner)}`,
      `hasBlocker=${String(hasBlocker)}`,
    ],
    traceFiles,
    traceTurns,
    doneSummary,
    {
      hasTiming,
      hasChangelogOwner,
      hasBlocker,
    },
  );
}

async function migrationPlanReplySent(
  context: ArenaRunContext,
): Promise<ArenaValidatorResult> {
  const { harness, workspaceId } = context;

  const outcome = await waitForOutcome(
    harness.page,
    harness.ctx.serviceWorker,
    async () => {
      const result = await harness.page.evaluate(
        () => (window as any).messagingResult ?? null,
      );
      if (result?.sent === true) return result;
      return null;
    },
    context.task.timeoutMs,
    workspaceId,
  );

  const { traceFiles, traceTurns, doneSummary } = await collectTraceData(
    harness,
    workspaceId,
  );

  if (!outcome.ok) {
    return buildResult(
      false,
      outcome.reason,
      ["Migration plan task did not send a message reply."],
      traceFiles,
      traceTurns,
      doneSummary,
    );
  }

  const result = outcome.result as any;
  const message = normalizeText(result.message);
  const hasDeadline = includesAny(message, ["friday", "freitag"]);
  const hasProgressSummary = includesAny(message, [
    "progress summary",
    "progress report",
    "summary",
    "fortschritt",
    "fortschrittsbericht",
    "zusammenfassung",
    "ergebnisse",
  ]);
  const hasCostPlan = includesAny(message, [
    "cost plan",
    "kostenplan",
    "reserved instances",
    "budget",
  ]);
  const hasOwner = message.includes("markus") && includesAny(message, ["technical", "technisch"]);
  const ok =
    result.sent === true &&
    hasDeadline &&
    hasProgressSummary &&
    hasCostPlan &&
    hasOwner;

  return buildResult(
    ok,
    ok ? "validated" : "migration_plan_reply_incomplete",
    [
      `hasDeadline=${String(hasDeadline)}`,
      `hasProgressSummary=${String(hasProgressSummary)}`,
      `hasCostPlan=${String(hasCostPlan)}`,
      `hasOwner=${String(hasOwner)}`,
    ],
    traceFiles,
    traceTurns,
    doneSummary,
    {
      hasDeadline,
      hasProgressSummary,
      hasCostPlan,
      hasOwner,
    },
  );
}

async function releaseBoardPrioritiesMoved(
  context: ArenaRunContext,
): Promise<ArenaValidatorResult> {
  const { harness, workspaceId } = context;

  const outcome = await waitForOutcome(
    harness.page,
    harness.ctx.serviceWorker,
    async () => {
      const result = await harness.page.evaluate(
        () => (window as any).kanbanResult ?? null,
      );
      const moves = Array.isArray(result?.moves) ? result.moves : [];
      const hasApiDocs = moves.some(
        (move: any) =>
          move.card === "Write API Docs" && move.to === "in-progress",
      );
      const hasCiPipeline = moves.some(
        (move: any) =>
          move.card === "Setup CI Pipeline" && move.to === "in-progress",
      );
      if (hasApiDocs && hasCiPipeline) return result;
      return null;
    },
    context.task.timeoutMs,
    workspaceId,
  );

  const { traceFiles, traceTurns, doneSummary } = await collectTraceData(
    harness,
    workspaceId,
  );

  if (!outcome.ok) {
    return buildResult(
      false,
      outcome.reason,
      ["Kanban priority task did not move both requested cards."],
      traceFiles,
      traceTurns,
      doneSummary,
    );
  }

  const result = outcome.result as any;
  const moves = Array.isArray(result?.moves) ? result.moves : [];
  const requestedMoves = moves.filter(
    (move: any) =>
      (move.card === "Write API Docs" || move.card === "Setup CI Pipeline") &&
      move.from === "todo" &&
      move.to === "in-progress",
  );
  const movedCards = requestedMoves.map((move: any) => `${move.card}->${move.to}`);
  const uniqueMovedCards = new Set(movedCards);
  const ok = requestedMoves.length === 2 && uniqueMovedCards.size === 2;

  return buildResult(
    ok,
    ok ? "validated" : "kanban_duplicate_or_missing_moves",
    [
      `moves=${movedCards.join(",")}`,
      `requestedMoveCount=${requestedMoves.length}`,
      `uniqueRequestedMoveCount=${uniqueMovedCards.size}`,
    ],
    traceFiles,
    traceTurns,
    doneSummary,
    {
      moves: movedCards,
      requestedMoveCount: requestedMoves.length,
      uniqueRequestedMoveCount: uniqueMovedCards.size,
    },
  );
}

async function articleFootnoteSourceAnswered(
  context: ArenaRunContext,
): Promise<ArenaValidatorResult> {
  const { harness, workspaceId } = context;

  const outcome = await waitForTaskCompletion(
    harness.ctx,
    context.task.timeoutMs,
    workspaceId,
  );

  const { traceFiles, traceTurns, doneSummary } = await collectTraceData(
    harness,
    workspaceId,
  );

  if (!outcome.ok) {
    return buildResult(
      false,
      outcome.reason,
      ["Article research task did not complete successfully."],
      traceFiles,
      traceTurns,
      doneSummary,
    );
  }

  const summary = getTaskCompletionSummary(outcome.events, doneSummary);
  const normalizedSummary = summary.replace(/\s+/g, " ").toLowerCase();
  const footnoteText = await harness.page.evaluate(() => {
    const blocks = Array.from(document.querySelectorAll(".card div"));
    const footnote = blocks.find((element) =>
      element.textContent?.includes("Footnote 2:"),
    );
    return footnote?.textContent?.trim() ?? "";
  });
  const normalizedFootnote = footnoteText.replace(/\s+/g, " ").toLowerCase();

  const mentionsBuffer = /\bbuffer('?s)?\b/.test(normalizedSummary);
  const mentionsReport = normalizedSummary.includes("report");
  const mentionsSurvey = normalizedSummary.includes("survey");
  const mentionsWorkers =
    normalizedSummary.includes("remote workers") ||
    normalizedSummary.includes("2,500");
  const expectedSourceVisible =
    normalizedFootnote.includes("buffer") &&
    normalizedFootnote.includes("report");
  const found =
    expectedSourceVisible &&
    mentionsBuffer &&
    (mentionsReport || mentionsSurvey || mentionsWorkers);

  return buildResult(
    found,
    found ? "validated" : "source_not_grounded",
    [
      `completionSummary=${summary.slice(0, 140) || "-"}`,
      `footnote=${footnoteText.slice(0, 140) || "-"}`,
      `traceTurns=${traceTurns.length}`,
    ],
    traceFiles,
    traceTurns,
    summary,
  );
}

async function documentFootnoteBriefAnswered(
  context: ArenaRunContext,
): Promise<ArenaValidatorResult> {
  const { harness, workspaceId } = context;

  const outcome = await waitForTaskCompletion(
    harness.ctx,
    context.task.timeoutMs,
    workspaceId,
  );

  const { traceFiles, traceTurns, doneSummary } = await collectTraceData(
    harness,
    workspaceId,
  );

  if (!outcome.ok) {
    return buildResult(
      false,
      outcome.reason,
      ["Document brief task did not complete successfully."],
      traceFiles,
      traceTurns,
      doneSummary,
    );
  }

  const summary = getTaskCompletionSummary(outcome.events, doneSummary);
  const normalized = normalizeText(summary);
  const footnoteText = await harness.page.evaluate(() => {
    const blocks = Array.from(document.querySelectorAll(".card div"));
    const footnote = blocks.find((element) =>
      element.textContent?.includes("Footnote 2:"),
    );
    return footnote?.textContent?.trim() ?? "";
  });
  const normalizedFootnote = normalizeText(footnoteText);
  const sourceVisible =
    normalizedFootnote.includes("buffer") &&
    normalizedFootnote.includes("report");
  const citesSource =
    normalized.includes("buffer") && normalized.includes("report");
  const includesPractice = includesAny(normalized, [
    "documentation",
    "documenting",
    "written down",
    "asynchronous",
    "async",
  ]);
  const ok = sourceVisible && citesSource && includesPractice;

  return buildResult(
    ok,
    ok ? "validated" : "document_brief_incomplete",
    [
      `citesSource=${String(citesSource)}`,
      `includesPractice=${String(includesPractice)}`,
      `footnote=${footnoteText.slice(0, 140) || "-"}`,
    ],
    traceFiles,
    traceTurns,
    summary,
    {
      citesSource,
      includesPractice,
    },
  );
}

async function dashboardMetricsAnswered(
  context: ArenaRunContext,
): Promise<ArenaValidatorResult> {
  const { harness, workspaceId } = context;

  const outcome = await waitForTaskCompletion(
    harness.ctx,
    context.task.timeoutMs,
    workspaceId,
  );

  const { traceFiles, traceTurns, doneSummary } = await collectTraceData(
    harness,
    workspaceId,
  );

  if (!outcome.ok) {
    return buildResult(
      false,
      outcome.reason,
      ["Dashboard metric comparison task did not complete successfully."],
      traceFiles,
      traceTurns,
      doneSummary,
    );
  }

  const summary = getTaskCompletionSummary(outcome.events, doneSummary);
  const normalized = summary.replace(/\s+/g, " ").toLowerCase();
  const hasTickets =
    /open tickets[^0-9]{0,20}47/.test(normalized) ||
    /47[^a-z0-9]{0,20}open tickets/.test(normalized);
  const hasCampaigns =
    /active campaigns[^0-9]{0,20}12/.test(normalized) ||
    /12[^a-z0-9]{0,20}active campaigns/.test(normalized);
  const hasSupportContext = normalized.includes("support");
  const hasMarketingContext = normalized.includes("marketing");

  return buildResult(
    hasTickets && hasCampaigns && hasSupportContext && hasMarketingContext,
    hasTickets && hasCampaigns && hasSupportContext && hasMarketingContext
      ? "validated"
      : "dashboard_answer_incomplete",
    [
      `openTickets47=${String(hasTickets)}`,
      `activeCampaigns12=${String(hasCampaigns)}`,
      `supportContext=${String(hasSupportContext)}`,
      `marketingContext=${String(hasMarketingContext)}`,
    ],
    traceFiles,
    traceTurns,
    summary,
  );
}

async function firstTwoProcurementItemsComplete(
  context: ArenaRunContext,
): Promise<ArenaValidatorResult> {
  const { harness, workspaceId } = context;

  const outcome = await waitForOutcome(
    harness.page,
    harness.ctx.serviceWorker,
    async () => {
      const checked = await harness.page.evaluate(
        () => (window as any).__procurementChecked ?? [],
      );
      if (
        Array.isArray(checked) &&
        checked.includes("item-1") &&
        checked.includes("item-2")
      ) {
        return checked;
      }
      return null;
    },
    context.task.timeoutMs,
    workspaceId,
  );

  const { traceFiles, traceTurns, doneSummary } = await collectTraceData(
    harness,
    workspaceId,
  );

  if (!outcome.ok) {
    return buildResult(
      false,
      outcome.reason,
      ["Procurement workflow did not complete the first two items."],
      traceFiles,
      traceTurns,
      doneSummary,
    );
  }

  const checked = Array.isArray(outcome.result) ? outcome.result : [];
  const ok = checked.includes("item-1") && checked.includes("item-2");

  return buildResult(
    ok,
    ok ? "validated" : "procurement_items_incomplete",
    [`checked=${checked.join(",")}`],
    traceFiles,
    traceTurns,
    doneSummary,
    { checkedCount: checked.length },
  );
}

async function jobRecommendationsGrounded(
  context: ArenaRunContext,
): Promise<ArenaValidatorResult> {
  const { harness, workspaceId } = context;

  const outcome = await waitForOutcome(
    harness.page,
    harness.ctx.serviceWorker,
    async () => {
      const state = await harness.page.evaluate(
        () => (window as any).__jobBoardState ?? null,
      );
      if (!state) return null;
      if (Array.isArray(state.viewedJobs) && state.viewedJobs.length >= 8) {
        return state;
      }
      return null;
    },
    context.task.timeoutMs,
    workspaceId,
  );

  const { traceFiles, traceTurns, doneSummary } = await collectTraceData(
    harness,
    workspaceId,
  );

  if (!outcome.ok) {
    return buildResult(
      false,
      outcome.reason,
      ["Job-board task did not review enough listings."],
      traceFiles,
      traceTurns,
      doneSummary,
    );
  }

  const state = outcome.result as any;
  const summaryLower = doneSummary.toLowerCase();
  const relevantSignals = [
    ["nextera", "senior frontend engineer"],
    ["cloudscale", "frontend tech lead"],
    ["datapulse", "full stack"],
    ["designflow", "senior ui"],
  ];
  const matchedJobs = relevantSignals.filter((job) =>
    job.some((signal) => summaryLower.includes(signal)),
  );
  const ok =
    Array.isArray(state?.viewedJobs) &&
    state.viewedJobs.length >= 8 &&
    matchedJobs.length >= 3;

  return buildResult(
    ok,
    ok ? "validated" : "job_recommendations_weak",
    [
      `viewedJobs=${String(state?.viewedJobs?.length ?? 0)}`,
      `matchedRelevantJobs=${matchedJobs.length}`,
    ],
    traceFiles,
    traceTurns,
    doneSummary,
    {
      viewedJobs: state?.viewedJobs?.length ?? 0,
      matchedRelevantJobs: matchedJobs.length,
    },
  );
}

async function singleOrderPlaced(
  context: ArenaRunContext,
): Promise<ArenaValidatorResult> {
  const { harness, workspaceId } = context;

  const outcome = await waitForOutcome(
    harness.page,
    harness.ctx.serviceWorker,
    async () =>
      (await harness.page.evaluate(() => (window as any).lastOrder ?? null)) ||
      null,
    context.task.timeoutMs,
    workspaceId,
  );

  const { traceFiles, traceTurns, doneSummary } = await collectTraceData(
    harness,
    workspaceId,
  );

  if (!outcome.ok) {
    return buildResult(
      false,
      outcome.reason,
      ["Checkout task did not produce an order."],
      traceFiles,
      traceTurns,
      doneSummary,
    );
  }

  const order = outcome.result as any;
  const orderCount = await harness.page.evaluate(
    () => (window as any).previousOrders?.length ?? 0,
  );
  const allEvents = await getMonitoredEvents(harness.ctx.serviceWorker, 200);
  const wsEvents = allEvents.filter(
    (event: any) => event.workspaceId == null || event.workspaceId === workspaceId,
  );

  let nodeIsolationOk = true;
  try {
    assertNodeIsolation(wsEvents, traceFiles);
  } catch {
    nodeIsolationOk = false;
  }

  const novablast = Array.isArray(order?.items)
    ? order.items.find((item: any) => item.id === "novablast-4")
    : null;
  const ok =
    Boolean(order) &&
    order.shippingMethod === "standard" &&
    order.coupon === "SAVE10" &&
    order.email === "alex@example.com" &&
    Boolean(novablast) &&
    orderCount === 1 &&
    nodeIsolationOk;

  return buildResult(
    ok,
    ok ? "validated" : "checkout_validation_failed",
    [
      `shipping=${String(order?.shippingMethod ?? "")}`,
      `coupon=${String(order?.coupon ?? "")}`,
      `email=${String(order?.email ?? "")}`,
      `orderCount=${orderCount}`,
      `nodeIsolation=${String(nodeIsolationOk)}`,
    ],
    traceFiles,
    traceTurns,
    doneSummary,
    {
      shippingMethod: order?.shippingMethod,
      coupon: order?.coupon,
      email: order?.email,
      orderCount,
      nodeIsolationOk,
    },
  );
}

export const ARENA_VALIDATORS: Record<string, ArenaValidator> = {
  supportTicketTriaged,
  ticketEscalatedWithAccountContext,
  enterpriseFormSubmitted,
  dianaSalaryFound,
  hoverMenuProductLookup,
  highestSalaryAnswered,
  workspaceChoiceDeferred,
  emailMeetingReplySent,
  releaseCoordinationReplySent,
  migrationPlanReplySent,
  releaseBoardPrioritiesMoved,
  articleFootnoteSourceAnswered,
  documentFootnoteBriefAnswered,
  dashboardMetricsAnswered,
  firstTwoProcurementItemsComplete,
  jobRecommendationsGrounded,
  singleOrderPlaced,
};

export function getArenaValidator(name: string): ArenaValidator | undefined {
  return ARENA_VALIDATORS[name];
}
