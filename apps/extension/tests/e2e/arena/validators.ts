import type { E2EHarness } from "../helpers/harness";
import {
  extractDoneSummary,
  extractLatestReadPageText,
  filterTraceFilesByWorkspace,
  findAllNewTraceFiles,
  readRunCompletionForTraceFiles,
  readTrace,
  traceFilesContainText,
  type TraceTurn,
} from "../helpers/diagnostics";
import {
  assertNodeIsolation,
  getMonitoredEvents,
  stopAgent,
  waitForOutcome,
  waitForMonitoredEvent,
  waitForTaskCompletion,
} from "../helpers/utils";
import type { ArenaTask } from "./tasks";
import {
  validateCheckoutOutcome,
  validateDianaSalaryAnswer,
  validateEnterpriseFormResult,
  validateKanbanColumns,
  validateProcurementOutcome,
  validateReleaseCoordinationReply,
  validateStagedApplication,
  validateSupportTriageComment,
  validateWorkspaceClarificationQuestion,
  type ProcurementStoreState,
} from "./validation-policy";

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
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function includesAny(text: string, values: readonly string[]): boolean {
  return values.some((value) => text.includes(value));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type TicketValidationState = {
  statusChanged: boolean;
  currentStatus: string;
  priorityChanged: boolean;
  currentPriority: string;
  commentsAdded: number;
  lastComment: string;
  lastCommentInternal: boolean;
};

function parseTicketValidationState(
  text: string,
): TicketValidationState | null {
  const statusMatch = text.match(
    /id="status-select"[\s\S]{0,300}?selected="([^"]+)"/,
  );
  const priorityMatch = text.match(
    /id="priority-select"[\s\S]{0,300}?selected="([^"]+)"/,
  );
  if (!statusMatch || !priorityMatch) return null;

  const compact = text.replace(/\s+/g, " ").trim();
  const marker = "You (Support Agent) Internal";
  const commentsAdded = compact.split(marker).length - 1;
  const lastCommentSection =
    commentsAdded > 0 ? compact.split(marker).pop() || "" : "";
  const lastComment = lastCommentSection
    .replace(/^\d{1,2}:\d{2}:\d{2}\s+/, "")
    .split(" Add Comment ")[0]
    .trim();

  return {
    statusChanged: statusMatch[1] !== "Open",
    currentStatus: statusMatch[1],
    priorityChanged: priorityMatch[1] !== "High",
    currentPriority: priorityMatch[1],
    commentsAdded,
    lastComment,
    lastCommentInternal: commentsAdded > 0,
  };
}

async function readTicketValidationState(
  page: E2EHarness["page"],
): Promise<TicketValidationState | null> {
  return (
    (await page.evaluate(() => {
      const statusSelect =
        document.querySelector<HTMLSelectElement>("#status-select");
      const prioritySelect =
        document.querySelector<HTMLSelectElement>("#priority-select");
      if (!statusSelect || !prioritySelect) return null;

      const pageText = document.body.innerText.replace(/\s+/g, " ").trim();
      const marker = "You (Support Agent) Internal";
      const commentsAdded = pageText.split(marker).length - 1;
      const lastCommentSection =
        commentsAdded > 0 ? pageText.split(marker).pop() || "" : "";
      const lastComment = lastCommentSection
        .replace(/^\d{1,2}:\d{2}:\d{2}\s+/, "")
        .split(" Add Comment ")[0]
        .trim();

      return {
        statusChanged: statusSelect.value !== "Open",
        currentStatus: statusSelect.value,
        priorityChanged: prioritySelect.value !== "High",
        currentPriority: prioritySelect.value,
        commentsAdded,
        lastComment,
        lastCommentInternal: commentsAdded > 0,
      };
    })) || null
  );
}

async function waitForTicketEscalationState(context: ArenaRunContext): Promise<{
  outcomeOk: boolean;
  reason: string;
  result: TicketValidationState | null;
  traceFiles: string[];
  traceTurns: TraceTurn[];
  doneSummary: string;
}> {
  const { harness, workspaceId, task } = context;
  const start = Date.now();
  let lastTraceFiles: string[] = [];
  let lastTraceTurns: TraceTurn[] = [];
  let lastDoneSummary = "";
  let lastResult: TicketValidationState | null = null;

  while (Date.now() - start < task.timeoutMs) {
    const collected = await collectTraceData(harness, workspaceId);
    lastTraceFiles = collected.traceFiles;
    lastTraceTurns = collected.traceTurns;
    lastDoneSummary = collected.doneSummary;

    const pageResult = await readTicketValidationState(harness.page).catch(
      () => null,
    );
    const traceResult = parseTicketValidationState(
      extractLatestReadPageText(lastTraceFiles),
    );
    lastResult = pageResult ?? traceResult ?? lastResult;

    const runCompletion = readRunCompletionForTraceFiles(lastTraceFiles);
    if (lastResult && runCompletion?.status === "completed") {
      return {
        outcomeOk: true,
        reason: pageResult ? "page_state" : "trace_page_state",
        result: lastResult,
        traceFiles: lastTraceFiles,
        traceTurns: lastTraceTurns,
        doneSummary: lastDoneSummary || runCompletion.summary,
      };
    }

    if (runCompletion?.status === "partial") {
      return {
        outcomeOk: false,
        reason: "task_partial",
        result: lastResult,
        traceFiles: lastTraceFiles,
        traceTurns: lastTraceTurns,
        doneSummary: lastDoneSummary || runCompletion.summary,
      };
    }

    if (runCompletion?.status === "failed") {
      return {
        outcomeOk: false,
        reason: "task_failed",
        result: lastResult,
        traceFiles: lastTraceFiles,
        traceTurns: lastTraceTurns,
        doneSummary: lastDoneSummary || runCompletion.summary,
      };
    }

    await sleep(2_000);
  }

  return {
    outcomeOk: false,
    reason: "timeout",
    result: lastResult,
    traceFiles: lastTraceFiles,
    traceTurns: lastTraceTurns,
    doneSummary: lastDoneSummary,
  };
}

async function supportTicketTriaged(
  context: ArenaRunContext,
): Promise<ArenaValidatorResult> {
  const { harness, workspaceId } = context;

  const outcome = await waitForOutcome(
    harness.page,
    harness.ctx.serviceWorker,
    async () => {
      const result = await readTicketValidationState(harness.page);
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
  const commentValidation = validateSupportTriageComment(result.lastComment);

  const ok =
    result.currentStatus === "In Progress" &&
    result.commentsAdded >= 1 &&
    result.lastCommentInternal === true &&
    commentValidation.ok;

  return buildResult(
    ok,
    ok ? "validated" : "ticket_state_mismatch",
    [
      `status=${result.currentStatus}`,
      `comments=${result.commentsAdded}`,
      `internal=${String(result.lastCommentInternal)}`,
      `mentionsIssue=${String(commentValidation.checks.issue)}`,
      `mentionsNextStep=${String(commentValidation.checks.nextStep)}`,
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
  const outcome = await waitForTicketEscalationState(context);
  const { traceFiles, traceTurns, doneSummary } = outcome;

  if (!outcome.outcomeOk || !outcome.result) {
    return buildResult(
      false,
      outcome.reason,
      ["Ticket escalation task did not reach a successful final state."],
      traceFiles,
      traceTurns,
      doneSummary,
    );
  }

  const result = outcome.result;
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
  const validation = validateEnterpriseFormResult(result);
  const ok = validation.ok;

  return buildResult(
    ok,
    ok ? "validated" : "form_result_mismatch",
    [
      `name=${String(result?.name ?? "")}`,
      `email=${String(result?.email ?? "")}`,
      `phone=${String(result?.phone ?? "")}`,
      `category=${String(result?.category ?? "")}`,
      `company=${String(result?.company ?? "")}`,
      `requirements=${String(result?.requirements ?? "")}`,
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
  const summary = getTaskCompletionSummary(outcome.events, doneSummary);
  const validation = validateDianaSalaryAnswer(result, summary);
  const ok = validation.ok;

  return buildResult(
    ok,
    ok ? "validated" : "salary_not_found",
    [
      `salary=${String(result?.dianaSalary ?? "")}`,
      `answerNamesDiana=${String(validation.checks.answerNamesDiana)}`,
      `answerHasSalary=${String(validation.checks.answerHasSalary)}`,
    ],
    traceFiles,
    traceTurns,
    summary,
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
  const runCompletion = readRunCompletionForTraceFiles(traceFiles);
  const traceCompleted = runCompletion?.status === "completed";
  const summary = getTaskCompletionSummary(
    outcome.events,
    doneSummary || runCompletion?.summary || "",
  );
  const normalized = normalizeText(summary);
  const namesHighestEmployee =
    normalized.includes("isla wright") ||
    (normalized.includes("isla") && normalized.includes("wright"));
  const namesSalary =
    normalized.includes("113,854") ||
    normalized.includes("113854") ||
    normalized.includes("$113");

  const completionObserved = outcome.ok || traceCompleted;
  const ok = completionObserved && namesHighestEmployee && namesSalary;
  return buildResult(
    ok,
    ok
      ? "validated"
      : completionObserved
        ? "highest_salary_answer_incomplete"
        : outcome.reason,
    [
      `completionObserved=${String(completionObserved)}`,
      `completionSource=${outcome.ok ? "event" : traceCompleted ? "run_trace" : "none"}`,
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
      runCompletionStatus: runCompletion?.status ?? null,
    },
  );
}

async function workspaceChoiceDeferred(
  context: ArenaRunContext,
): Promise<ArenaValidatorResult> {
  const { harness, workspaceId } = context;
  let clarification: any = null;
  let clarificationError = "";
  try {
    clarification = await waitForMonitoredEvent(
      harness.ctx.serviceWorker,
      (event: any) => event.type === "CLARIFICATION_REQUEST",
      context.task.timeoutMs,
      workspaceId,
    );
  } catch (error) {
    clarificationError = error instanceof Error ? error.message : String(error);
  }

  const { traceFiles, traceTurns, doneSummary } = await collectTraceData(
    harness,
    workspaceId,
  );
  const selected = await harness.page.evaluate(
    () => (window as any).__workspaceSelection ?? null,
  );
  const question =
    clarification?.question ?? clarification?.payload?.question ?? "";
  const validation = validateWorkspaceClarificationQuestion(question);
  const ok = selected === null && Boolean(clarification) && validation.ok;

  if (clarification) {
    // The benchmark objective is satisfied by the unanswered clarification.
    // Stop the paused run so its pending-interaction timeout cannot leak into
    // the next Arena case.
    await stopAgent(harness.ctx, workspaceId);
  }

  return buildResult(
    ok,
    ok ? "validated" : "workspace_choice_not_deferred",
    [
      `selected=${selected === null ? "none" : JSON.stringify(selected)}`,
      `clarificationObserved=${String(Boolean(clarification))}`,
      `asksAboutWorkspace=${String(validation.checks.identifiesChoice)}`,
      `requestsUserDecision=${String(validation.checks.requestsUserDecision)}`,
      `question=${String(question).slice(0, 160) || "-"}`,
      `error=${clarificationError || "-"}`,
    ],
    traceFiles,
    traceTurns,
    doneSummary || String(question),
    {
      selected,
      clarificationObserved: Boolean(clarification),
      question,
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
  const validation = validateReleaseCoordinationReply(result.message);
  const ok = result.sent === true && validation.ok;

  return buildResult(
    ok,
    ok ? "validated" : "release_coordination_reply_incomplete",
    [
      `hasTiming=${String(validation.checks.timing)}`,
      `hasChangelogOwner=${String(validation.checks.changelogOwner)}`,
      `hasBlocker=${String(validation.checks.blocker)}`,
    ],
    traceFiles,
    traceTurns,
    doneSummary,
    {
      hasTiming: validation.checks.timing,
      hasChangelogOwner: validation.checks.changelogOwner,
      hasBlocker: validation.checks.blocker,
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
  const hasOwner =
    message.includes("markus") &&
    includesAny(message, ["technical", "technisch"]);
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
      const validation = validateKanbanColumns(result?.columns);
      if (validation.ok) return result;
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
  const validation = validateKanbanColumns(result?.columns);
  const inProgress = Array.isArray(result?.columns?.["in-progress"])
    ? result.columns["in-progress"]
    : [];
  const ok = validation.ok;

  return buildResult(
    ok,
    ok ? "validated" : "kanban_final_state_mismatch",
    [
      `inProgress=${inProgress.join(",")}`,
      `apiDocsInProgress=${String(validation.checks.apiDocsInProgress)}`,
      `ciPipelineInProgress=${String(validation.checks.ciPipelineInProgress)}`,
    ],
    traceFiles,
    traceTurns,
    doneSummary,
    {
      inProgress,
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

async function canvasFinePrintAnswered(
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
  // Outcome-grounded: the value exists only as small canvas pixels, so a
  // correct answer proves the visual pixel path. Whether the agent needed
  // inspect_region or read it from the first-turn high-detail screenshot
  // is capability telemetry, not a pass criterion (a strong VL executor
  // legitimately skips the zoom).
  const hasMargin = /4\.7\s*%/.test(summary);
  const usedRegionZoom = traceFilesContainText(
    traceFiles,
    '"type":"inspect_region"',
  );

  return buildResult(
    hasMargin,
    hasMargin ? "validated" : "fine_print_answer_incorrect",
    [
      `q3Margin47=${String(hasMargin)}`,
      `usedInspectRegion=${String(usedRegionZoom)}`,
      `agentCompletion=${outcome.reason}`,
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
  const validationStartedAt = Date.now();

  const outcome = await waitForOutcome(
    harness.page,
    harness.ctx.serviceWorker,
    async () => {
      const checked = await harness.page.evaluate(
        () => (window as any).__procurementChecked ?? [],
      );
      const stores: ProcurementStoreState[] = await harness.page.evaluate(
        (startedAt) => {
          try {
            const parsed = JSON.parse(
              window.localStorage.getItem("__procurementOrders") ?? "[]",
            );
            if (!Array.isArray(parsed)) return [];
            return parsed
              .filter(
                (entry: any) =>
                  Number(entry?.placedAt ?? 0) >= startedAt &&
                  typeof entry?.slug === "string" &&
                  Array.isArray(entry?.cart),
              )
              .map((entry: any) => ({
                slug: entry.slug,
                orderPlaced: entry.orderPlaced === true,
                cart: entry.cart,
              }));
          } catch {
            return [];
          }
        },
        validationStartedAt,
      );
      for (const page of await harness.ctx.browser.pages()) {
        if (!page.url().includes("/procurement?store=")) continue;
        const slug = new URL(page.url()).searchParams.get("store");
        const state = await page
          .evaluate(() => ({
            orderPlaced: Boolean((window as any).__storeOrderPlaced),
            cart: Array.isArray((window as any).__storeCart)
              ? (window as any).__storeCart
              : [],
          }))
          .catch(() => null);
        if (state) {
          stores.push({
            slug,
            orderPlaced: state.orderPlaced,
            cart: state.cart,
          });
        }
      }
      const validation = validateProcurementOutcome({ checked, stores });
      if (validation.ok) {
        return { checked, stores };
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

  const result = outcome.result as {
    checked?: unknown;
    stores?: ProcurementStoreState[];
  };
  const checked = Array.isArray(result?.checked)
    ? result.checked.map(String)
    : [];
  const stores = Array.isArray(result?.stores) ? result.stores : [];
  const validation = validateProcurementOutcome({ checked, stores });
  const ok = validation.ok;

  return buildResult(
    ok,
    ok ? "validated" : "procurement_items_incomplete",
    [
      `checked=${checked.join(",")}`,
      `keyboardPurchased=${String(validation.checks.keyboardPurchased)}`,
      `deskMatPurchased=${String(validation.checks.deskMatPurchased)}`,
    ],
    traceFiles,
    traceTurns,
    doneSummary,
    {
      checkedCount: checked.length,
      keyboardPurchased: validation.checks.keyboardPurchased,
      deskMatPurchased: validation.checks.deskMatPurchased,
    },
  );
}

async function jobRecommendationsGrounded(
  context: ArenaRunContext,
): Promise<ArenaValidatorResult> {
  const { harness, workspaceId } = context;

  // Grounding evidence: the four relevant listings must plausibly have
  // been inspected (details opened), not all 11 — triaging from excerpts
  // and skipping obviously-irrelevant roles is correct behavior, not a
  // failure (measured 2026-07-05: an agent that opened exactly the 4
  // relevant details + 1 produced a fully grounded answer and was failed
  // by the old >= 8 quota).
  const MIN_VIEWED_JOBS = 4;
  const outcome = await waitForOutcome(
    harness.page,
    harness.ctx.serviceWorker,
    async () => {
      const state = await harness.page.evaluate(
        () => (window as any).__jobBoardState ?? null,
      );
      if (!state) return null;
      if (
        Array.isArray(state.viewedJobs) &&
        state.viewedJobs.length >= MIN_VIEWED_JOBS
      ) {
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
    state.viewedJobs.length >= 4 &&
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
    (event: any) =>
      event.workspaceId == null || event.workspaceId === workspaceId,
  );

  let nodeIsolationOk = true;
  try {
    assertNodeIsolation(wsEvents, traceFiles);
  } catch {
    nodeIsolationOk = false;
  }

  const validation = validateCheckoutOutcome(order, orderCount);
  const ok = validation.ok;

  return buildResult(
    ok,
    ok ? "validated" : "checkout_validation_failed",
    [
      `shipping=${String(order?.shippingMethod ?? "")}`,
      `coupon=${String(order?.coupon ?? "")}`,
      `email=${String(order?.email ?? "")}`,
      `size10=${String(validation.checks.size)}`,
      `singleItem=${String(validation.checks.oneLineItem)}`,
      `orderCount=${orderCount}`,
      `nodeIsolationDiagnostic=${String(nodeIsolationOk)}`,
    ],
    traceFiles,
    traceTurns,
    doneSummary,
    {
      shippingMethod: order?.shippingMethod,
      coupon: order?.coupon,
      email: order?.email,
      size10: validation.checks.size,
      singleItem: validation.checks.oneLineItem,
      orderCount,
      nodeIsolationDiagnostic: nodeIsolationOk,
    },
  );
}

// --- job-pipeline.stage-two-applications ---

/** Job ids that genuinely match the staged-applications candidate profile
 * (remote + React/TS + salary overlap) — the same four postings the
 * jobRecommendationsGrounded relevant-signal list points at. */
const STAGEABLE_JOB_IDS = new Set([
  "sr-fe-1",
  "fe-lead-2",
  "fullstack-3",
  "sr-ui-4",
]);

type StagedApplicationSnapshot = {
  jobId: string | null;
  draft: Record<string, any> | null;
  hasResult: boolean;
};

/** Read every open /ashby-job-application tab's draft state. Tabs can close
 * mid-read, so every page.evaluate failure degrades to a null snapshot. */
async function readStagedApplications(
  harness: E2EHarness,
): Promise<StagedApplicationSnapshot[]> {
  const pages = await harness.ctx.browser.pages();
  const snapshots: StagedApplicationSnapshot[] = [];
  for (const page of pages) {
    const url = page.url();
    if (!url.includes("/ashby-job-application")) continue;
    let jobId: string | null = null;
    try {
      jobId = new URL(url).searchParams.get("job");
    } catch {
      jobId = null;
    }
    const state = await page
      .evaluate(() => ({
        draft: (window as any).ashbyApplicationDraft ?? null,
        hasResult: Boolean((window as any).ashbyApplicationResult),
      }))
      .catch(() => null);
    snapshots.push({
      jobId,
      draft: state?.draft ?? null,
      hasResult: state?.hasResult ?? false,
    });
  }
  return snapshots;
}

async function readBoardViewedJobs(harness: E2EHarness): Promise<string[]> {
  // Union across ALL board tabs: multi-worker runs can open a second, fresh
  // board tab, and returning the first hit would drop the research history
  // that lives in the original tab.
  const viewed = new Set<string>();
  const pages = await harness.ctx.browser.pages();
  for (const page of pages) {
    if (!page.url().includes("/job-board")) continue;
    const tabViewed = await page
      .evaluate(() => (window as any).__jobBoardState?.viewedJobs ?? null)
      .catch(() => null);
    if (Array.isArray(tabViewed)) {
      for (const id of tabViewed) viewed.add(String(id));
    }
  }
  return [...viewed];
}

async function twoApplicationsStagedNotSubmitted(
  context: ArenaRunContext,
): Promise<ArenaValidatorResult> {
  const { harness, workspaceId, task } = context;
  const start = Date.now();
  let traceFiles: string[] = [];
  let traceTurns: TraceTurn[] = [];
  let doneSummary = "";

  // The arena ground truth for this task is the END STATE of the tabs, not the
  // run's self-reported completion status. A run whose node verifier marked it
  // "failed" (e.g. the verifier can only see the active tab and can't confirm a
  // second application in another tab) can still have left two correctly-drafted
  // applications open — and that is a pass. So wait until the run reaches ANY
  // terminal status, then judge the tabs. (Runtime verifier false-negatives on
  // multi-tab tasks are tracked as a separate follow-up.)
  let terminalStatus: "completed" | "partial" | "failed" | null = null;
  while (Date.now() - start < task.timeoutMs) {
    const collected = await collectTraceData(harness, workspaceId);
    traceFiles = collected.traceFiles;
    traceTurns = collected.traceTurns;
    doneSummary = collected.doneSummary;

    const runCompletion = readRunCompletionForTraceFiles(traceFiles);
    if (
      runCompletion?.status === "completed" ||
      runCompletion?.status === "partial" ||
      runCompletion?.status === "failed"
    ) {
      terminalStatus = runCompletion.status;
      doneSummary = doneSummary || runCompletion.summary;
      break;
    }
    await sleep(2_000);
  }

  if (!terminalStatus) {
    return buildResult(
      false,
      "timeout",
      ["Run did not reach a terminal status within the task timeout."],
      traceFiles,
      traceTurns,
      doneSummary,
    );
  }

  const snapshots = await readStagedApplications(harness);
  const viewedJobs = await readBoardViewedJobs(harness);

  const anySubmitted = snapshots.some(
    (snapshot) => snapshot.hasResult || snapshot.draft?.submitted === true,
  );

  const qualifying = snapshots.filter((snapshot) => {
    if (!snapshot.jobId || !STAGEABLE_JOB_IDS.has(snapshot.jobId)) return false;
    return validateStagedApplication(snapshot).ok;
  });
  const stagedJobIds = [
    ...new Set(qualifying.map((snapshot) => snapshot.jobId as string)),
  ];
  const researchGrounded =
    viewedJobs.length > 0 &&
    stagedJobIds.every((id) => viewedJobs.includes(id));

  // Win condition (per product intent): the job-listings tab is still open AND
  // two correctly-drafted, unsubmitted applications are open alongside it.
  const boardOpen = (await harness.ctx.browser.pages()).some((page) =>
    page.url().includes("/job-board"),
  );

  const ok =
    boardOpen && stagedJobIds.length === 2 && !anySubmitted && researchGrounded;

  const reason = ok
    ? "validated"
    : anySubmitted
      ? "application_submitted"
      : stagedJobIds.length !== 2
        ? "staged_tabs_incomplete"
        : !boardOpen
          ? "board_tab_closed"
          : "research_not_grounded";

  return buildResult(
    ok,
    reason,
    [
      `appTabs=${snapshots.length}`,
      `stagedJobs=${stagedJobIds.join(",") || "none"}`,
      ...snapshots.map((snapshot) => {
        const validation = validateStagedApplication(snapshot);
        const failedChecks = Object.entries(validation.checks)
          .filter(([, passed]) => !passed)
          .map(([name]) => name)
          .join(",");
        return `tab job=${snapshot.jobId ?? "?"} fields=${String(
          snapshot.draft?.completeRequestedFields ?? "?",
        )}/9 submitted=${String(
          snapshot.hasResult || snapshot.draft?.submitted === true,
        )} failedChecks=${failedChecks || "none"}`;
      }),
      `viewedJobs=${viewedJobs.length}`,
      `researchGrounded=${String(researchGrounded)}`,
      `boardOpen=${String(boardOpen)}`,
      `runStatus=${terminalStatus}`,
    ],
    traceFiles,
    traceTurns,
    doneSummary,
    {
      stagedJobIds,
      appTabCount: snapshots.length,
      viewedJobs: viewedJobs.length,
      anySubmitted,
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
  canvasFinePrintAnswered,
  firstTwoProcurementItemsComplete,
  jobRecommendationsGrounded,
  singleOrderPlaced,
  twoApplicationsStagedNotSubmitted,
};

export function getArenaValidator(name: string): ArenaValidator | undefined {
  return ARENA_VALIDATORS[name];
}
