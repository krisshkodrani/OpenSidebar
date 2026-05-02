export type MoneyTableAggregate = {
  mode: "max";
  label: string;
  bestName: string | null;
  bestAmount: number | null;
  bestDisplay: string | null;
  seenRows: Set<number>;
  totalRows: number | null;
  currentStart: number | null;
  currentEnd: number | null;
};

export function parseMoneyAmount(value: string): number | null {
  const match = value.match(/\$\s*([\d,]+)(?:\.\d+)?/);
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

export function formatSeenRows(aggregate: MoneyTableAggregate): string {
  const seen = aggregate.seenRows.size;
  const total = aggregate.totalRows;
  return total && total > 0 ? `${seen}/${total}` : `${seen}`;
}

export function formatSeenRowRanges(seenRows: Set<number>): string {
  const rows = Array.from(seenRows).sort((a, b) => a - b);
  if (rows.length === 0) return "none";
  const ranges: string[] = [];
  let start = rows[0];
  let prev = rows[0];
  for (const row of rows.slice(1)) {
    if (row === prev + 1) {
      prev = row;
      continue;
    }
    ranges.push(start === prev ? String(start) : `${start}-${prev}`);
    start = row;
    prev = row;
  }
  ranges.push(start === prev ? String(start) : `${start}-${prev}`);
  return ranges.join(",");
}

export function parseSeenRowRanges(value: string): Set<number> {
  const rows = new Set<number>();
  for (const part of value.split(",")) {
    const range = part.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!range) continue;
    const start = Number(range[1]);
    const end = Number(range[2] ?? range[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    for (let row = start; row <= end; row++) rows.add(row);
  }
  return rows;
}

function findFirstMissingRow(aggregate: MoneyTableAggregate): number | null {
  const total = aggregate.totalRows;
  if (!total || total <= 0) return null;
  for (let row = 1; row <= total; row++) {
    if (!aggregate.seenRows.has(row)) return row;
  }
  return null;
}

function formatMissingRowWindow(
  firstMissingRow: number,
  aggregate: MoneyTableAggregate,
): string {
  const total = aggregate.totalRows ?? firstMissingRow;
  const windowSize =
    aggregate.currentStart !== null && aggregate.currentEnd !== null
      ? Math.max(1, aggregate.currentEnd - aggregate.currentStart + 1)
      : 5;
  const end = Math.min(total, firstMissingRow + windowSize - 1);
  return `${firstMissingRow}-${end}`;
}

export function getMoneyTableNextActionHint(
  aggregate: MoneyTableAggregate,
): string {
  if (!aggregate.totalRows) {
    return "continue through the visible pagination controls until the table shows all pages have been reviewed";
  }
  const firstMissingRow = findFirstMissingRow(aggregate);
  if (firstMissingRow === null) {
    return "call done with this candidate unless the current page contradicts it";
  }
  const missingWindow = formatMissingRowWindow(firstMissingRow, aggregate);
  if (aggregate.currentStart === null || aggregate.currentEnd === null) {
    return `read the current table page, then continue toward rows ${missingWindow}`;
  }
  if (firstMissingRow > aggregate.currentEnd) {
    return `click Next to inspect rows ${missingWindow}; no find_element is needed for page numbers`;
  }
  if (firstMissingRow < aggregate.currentStart) {
    return `go backward toward rows ${missingWindow} using a visible page button or Prev, then resume with Next`;
  }
  return `read the current table page again to capture missing rows ${missingWindow}`;
}
