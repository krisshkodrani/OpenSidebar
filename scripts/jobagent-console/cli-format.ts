/**
 * JobAgent CLI — rendering helpers.
 *
 * Every verb has two audiences: a human reading a terminal and an agent
 * reading stdout through a skill. `--json` serves the second verbatim; these
 * helpers serve the first. Deliberately dependency-free and narrow — plain
 * columns, no colour, no cursor control, so the output survives being pasted
 * into a transcript or captured by a tool runner.
 */

/** Render rows as aligned columns. Empty input renders as a single hint line. */
export function table(
  rows: Array<Record<string, unknown>>,
  columns: string[],
  emptyHint = "(none)",
): string {
  if (rows.length === 0) return emptyHint;
  const cells = rows.map((row) => columns.map((c) => cell(row[c])));
  const widths = columns.map((col, i) =>
    Math.max(col.length, ...cells.map((r) => r[i].length)),
  );
  const line = (values: string[]) =>
    values.map((v, i) => v.padEnd(widths[i])).join("  ").trimEnd();
  return [
    line(columns),
    line(widths.map((w) => "-".repeat(w))),
    ...cells.map(line),
  ].join("\n");
}

/** Render `key: value` pairs with aligned keys. */
export function fields(record: Record<string, unknown>): string {
  const keys = Object.keys(record);
  if (keys.length === 0) return "(empty)";
  const width = Math.max(...keys.map((k) => k.length));
  return keys.map((k) => `${k.padEnd(width)}  ${cell(record[k])}`).join("\n");
}

function cell(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Absolute epoch ms → a short timestamp; absent → "—". */
export function at(ms: number | undefined): string {
  // Explicitly `== null`, not falsy: tests inject epoch 0 and a zero stamp is
  // a timestamp, not a missing one.
  if (ms == null) return "—";
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}

/** Elapsed time between two epoch-ms stamps, as a compact duration. */
export function took(startedAt: number, endedAt?: number): string {
  if (endedAt == null) return "running";
  const s = Math.round((endedAt - startedAt) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}
