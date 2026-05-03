import {
  formatSeenRowRanges,
  formatSeenRows,
  getMoneyTableNextActionHint,
  parseMoneyAmount,
  parseSeenRowRanges,
  type MoneyTableAggregate,
} from "./money-table-aggregate";

export interface AgentLoopMoneyTableHost {
  context: {
    getSnapshot?: () => {
      pageContent?: string;
      visibleContent?: string;
    } | null;
    getWorkingNotes?: () => string;
    setWorkingNotes(note: string): void;
  };
  lastPlanIndex: number;
  moneyTableAggregate: MoneyTableAggregate | null;
  originalQuery: string;
  planSubtasks: Array<{
    description?: string;
  }>;
  selectedSkillId: string | null;
}

export function isMoneyTableAggregateTask(
  loop: AgentLoopMoneyTableHost,
): boolean {
  const taskText =
    `${loop.originalQuery}\n${loop.planSubtasks[loop.lastPlanIndex]?.description ?? ""}`.toLowerCase();
  return (
    /\b(highest|max(?:imum)?|largest|most)\b/.test(taskText) &&
    /\b(salary|pay|compensation|price|cost|amount|revenue|budget)\b/.test(
      taskText,
    )
  );
}

export function hydrateMoneyTableAggregateFromWorkingNotes(
  loop: AgentLoopMoneyTableHost,
): MoneyTableAggregate | null {
  const notes = loop.context.getWorkingNotes?.() ?? "";
  if (!notes.includes("Paginated table aggregate:")) return null;
  const candidate = notes.match(
    /current highest ([^;]+?) candidate is (.+?) at (\$\s*[\d,]+(?:\.\d+)?)/i,
  );
  if (!candidate) return null;

  const totalMatch =
    notes.match(/seen rows [\d,\-\s]+\/(\d+)/i) ??
    notes.match(/rows read \d+\/(\d+)/i);
  const seenMatch = notes.match(/seen rows ([\d,\-\s]+)\/\d+/i);
  const seenRows = seenMatch
    ? parseSeenRowRanges(seenMatch[1])
    : new Set<number>();
  const totalRows = totalMatch ? Number(totalMatch[1]) : null;
  const bestAmount = parseMoneyAmount(candidate[3]);
  if (bestAmount === null) return null;

  return {
    mode: "max",
    label: candidate[1],
    bestName: candidate[2],
    bestAmount,
    bestDisplay: candidate[3],
    seenRows,
    totalRows: totalRows && Number.isFinite(totalRows) ? totalRows : null,
    currentStart: null,
    currentEnd: null,
  };
}

export function updateMoneyTableAggregate(
  loop: AgentLoopMoneyTableHost,
  result: string,
): string | null {
  if (!isMoneyTableAggregateTask(loop)) return null;

  const lines = result
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const range = result.match(
    /Showing\s+(\d+)\s*(?:-|\u2012|\u2013|\u2014)\s*(\d+)\s+of\s+(\d+)/i,
  );
  let rangeStart: number | null = null;
  let rangeEnd: number | null = null;
  let totalRows: number | null = null;
  if (range) {
    rangeStart = Number(range[1]);
    rangeEnd = Number(range[2]);
    totalRows = Number(range[3]);
  } else {
    const totalSummary = result.match(
      /\b(\d+)\s+(?:rows|records|employees|items)\b[^.\n]*\b(\d+)\s+per\s+page\b/i,
    );
    if (totalSummary) {
      totalRows = Number(totalSummary[1]);
    }
  }

  const aggregate =
    loop.moneyTableAggregate ??
    hydrateMoneyTableAggregateFromWorkingNotes(loop) ??
    ({
      mode: "max",
      label: "money value",
      bestName: null,
      bestAmount: null,
      bestDisplay: null,
      seenRows: new Set<number>(),
      totalRows: null,
      currentStart: null,
      currentEnd: null,
    } satisfies MoneyTableAggregate);
  if (totalRows && Number.isFinite(totalRows)) {
    aggregate.totalRows = totalRows;
  }

  if (
    rangeStart !== null &&
    rangeEnd !== null &&
    Number.isFinite(rangeStart) &&
    Number.isFinite(rangeEnd)
  ) {
    aggregate.currentStart = rangeStart;
    aggregate.currentEnd = rangeEnd;
    for (let row = rangeStart; row <= rangeEnd; row++) {
      aggregate.seenRows.add(row);
    }
  }

  const visibleRowIds = new Set<number>();
  const compactResult = result.replace(/\s+/g, " ");
  const compactRowPattern =
    /\b(\d{1,6})\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})\s+[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\s+[A-Za-z][A-Za-z&/ -]{0,60}?\s+(\$\s*[\d,]+(?:\.\d+)?)/g;
  let compactRow: RegExpExecArray | null;
  while ((compactRow = compactRowPattern.exec(compactResult)) !== null) {
    const rowId = Number(compactRow[1]);
    const name = compactRow[2].trim();
    const display = compactRow[3].trim();
    const amount = parseMoneyAmount(display);
    if (!Number.isFinite(rowId) || amount === null) continue;

    visibleRowIds.add(rowId);
    if (aggregate.bestAmount === null || amount > aggregate.bestAmount) {
      aggregate.bestAmount = amount;
      aggregate.bestDisplay = display;
      aggregate.bestName = name;
    }
  }

  for (let idx = 0; idx < lines.length; idx++) {
    const amount = parseMoneyAmount(lines[idx]);
    if (amount === null) continue;

    let name: string | null = null;
    let emailLineIndex: number | null = null;
    for (let back = idx - 1; back >= Math.max(0, idx - 5); back--) {
      if (lines[back].includes("@") && back > 0) {
        emailLineIndex = back;
        name = lines[back - 1];
        break;
      }
    }
    if (!name || /^[#\d]+$/.test(name)) continue;

    if (emailLineIndex !== null) {
      for (
        let back = emailLineIndex - 2;
        back >= Math.max(0, emailLineIndex - 7);
        back--
      ) {
        if (/^\d+$/.test(lines[back])) {
          const rowId = Number(lines[back]);
          if (Number.isFinite(rowId)) {
            visibleRowIds.add(rowId);
          }
          break;
        }
      }
    }

    if (aggregate.bestAmount === null || amount > aggregate.bestAmount) {
      aggregate.bestAmount = amount;
      aggregate.bestDisplay = lines[idx];
      aggregate.bestName = name;
    }
  }

  if (visibleRowIds.size > 0) {
    for (const row of visibleRowIds) aggregate.seenRows.add(row);
    if (rangeStart === null || rangeEnd === null) {
      const sorted = Array.from(visibleRowIds).sort((a, b) => a - b);
      aggregate.currentStart = sorted[0];
      aggregate.currentEnd = sorted[sorted.length - 1];
    }
  }

  loop.moneyTableAggregate = aggregate;
  if (!aggregate.bestName || !aggregate.bestDisplay) return null;

  const coverage = formatSeenRows(aggregate);
  const complete =
    aggregate.totalRows !== null &&
    aggregate.totalRows > 0 &&
    aggregate.seenRows.size >= aggregate.totalRows;
  const note =
    `Paginated table aggregate: current highest ${aggregate.label} candidate is ` +
    `${aggregate.bestName} at ${aggregate.bestDisplay}; rows read ${coverage}; ` +
    `seen rows ${formatSeenRowRanges(aggregate.seenRows)}/${aggregate.totalRows ?? "unknown"}. ` +
    (complete
      ? "The scan is exhaustive; call done with this candidate unless the current page contradicts it."
      : `The scan is not exhaustive yet. Next action: ${getMoneyTableNextActionHint(aggregate)}.`);
  loop.context.setWorkingNotes(note);
  return `[Aggregation state: ${note}]`;
}

export function updateMoneyTableAggregateFromSnapshot(
  loop: AgentLoopMoneyTableHost,
): void {
  const snapshot = loop.context.getSnapshot?.();
  const pageText = snapshot?.pageContent || snapshot?.visibleContent || "";
  if (!pageText.trim()) return;
  updateMoneyTableAggregate(loop, pageText);
}

export function getIncompleteMoneyTableAggregateDoneRejection(
  loop: AgentLoopMoneyTableHost,
): string | null {
  if (!isMoneyTableAggregateTask(loop)) return null;
  updateMoneyTableAggregateFromSnapshot(loop);
  const aggregate =
    loop.moneyTableAggregate ?? hydrateMoneyTableAggregateFromWorkingNotes(loop);
  if (!aggregate?.bestName || !aggregate.bestDisplay) return null;

  const complete =
    aggregate.totalRows !== null &&
    aggregate.totalRows > 0 &&
    aggregate.seenRows.size >= aggregate.totalRows;
  if (complete) return null;

  return (
    `The paginated table scan is not exhaustive yet: current candidate is ` +
    `${aggregate.bestName} at ${aggregate.bestDisplay}, with rows read ` +
    `${formatSeenRows(aggregate)} and seen rows ` +
    `${formatSeenRowRanges(aggregate.seenRows)}/${aggregate.totalRows ?? "unknown"}. ` +
    `Continue scanning remaining table pages before reporting the highest value. ` +
    `Next action: ${getMoneyTableNextActionHint(aggregate)}.`
  );
}

export function getIncorrectMoneyTableAggregateDoneRejection(
  loop: AgentLoopMoneyTableHost,
  summary: string,
): string | null {
  if (!isMoneyTableAggregateTask(loop)) return null;
  updateMoneyTableAggregateFromSnapshot(loop);
  const aggregate =
    loop.moneyTableAggregate ?? hydrateMoneyTableAggregateFromWorkingNotes(loop);
  if (!aggregate?.bestName || !aggregate.bestDisplay) return null;

  const complete =
    aggregate.totalRows !== null &&
    aggregate.totalRows > 0 &&
    aggregate.seenRows.size >= aggregate.totalRows;
  if (!complete) return null;

  const normalizedSummary = summary.toLowerCase();
  const normalizedName = aggregate.bestName.toLowerCase();
  const bestDigits = aggregate.bestDisplay.replace(/[^\d]/g, "");
  const summaryDigits = summary.replace(/[^\d]/g, "");
  if (
    normalizedSummary.includes(normalizedName) &&
    bestDigits.length > 0 &&
    summaryDigits.includes(bestDigits)
  ) {
    return null;
  }

  return (
    `The exhaustive table scan found ${aggregate.bestName} at ` +
    `${aggregate.bestDisplay}, but the done() summary did not report that ` +
    `tracked highest candidate. Report ${aggregate.bestName} at ` +
    `${aggregate.bestDisplay}.`
  );
}

export function isCompletedMoneyTableAggregateSummary(
  loop: AgentLoopMoneyTableHost,
  summary: string,
): boolean {
  if (loop.selectedSkillId !== "paginated-table-scan") return false;
  if (!isMoneyTableAggregateTask(loop)) return false;
  updateMoneyTableAggregateFromSnapshot(loop);
  const aggregate =
    loop.moneyTableAggregate ?? hydrateMoneyTableAggregateFromWorkingNotes(loop);
  if (!aggregate?.bestName || !aggregate.bestDisplay) return false;

  const complete =
    aggregate.totalRows !== null &&
    aggregate.totalRows > 0 &&
    aggregate.seenRows.size >= aggregate.totalRows;
  if (!complete) return false;

  return getIncorrectMoneyTableAggregateDoneRejection(loop, summary) === null;
}
