/**
 * E2E suite report — collects per-test results and prints a formatted summary.
 *
 * Module-level singleton. Registers a beforeExit handler so the report prints
 * even on unexpected exits.
 */

import { existsSync, readFileSync } from "fs";

interface TestRecord {
  name: string;
  passed: boolean | null;
  durationMs: number;
  traceFiles: string[];
}

interface TraceCostData {
  turns: number;
  cost: number;
}

function extractCostFromTraces(traceFiles: string[]): TraceCostData {
  let totalCost = 0;
  let totalTurns = 0;

  for (const filePath of traceFiles) {
    if (!existsSync(filePath)) continue;
    const raw = readFileSync(filePath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        totalTurns++;
        const cost = entry.llmResponse?.usage?.cost;
        if (typeof cost === "number") {
          totalCost += cost;
        }
      } catch {
        // Skip malformed lines
      }
    }
  }

  return { turns: totalTurns, cost: totalCost };
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatCost(cost: number): string {
  if (cost === 0) return "-";
  if (cost < 0.001) return `$${cost.toFixed(5)}`;
  return `$${cost.toFixed(3)}`;
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

function padLeft(s: string, len: number): string {
  return s.length >= len ? s : " ".repeat(len - s.length) + s;
}

class SuiteReport {
  private records: TestRecord[] = [];
  private printed = false;

  record(
    name: string,
    passed: boolean | null,
    durationMs: number,
    traceFiles: string[],
  ): void {
    this.records.push({ name, passed, durationMs, traceFiles });
  }

  printSummary(): void {
    if (this.printed || this.records.length === 0) return;
    this.printed = true;

    const COL_NAME = 26;
    const COL_RESULT = 6;
    const COL_TURNS = 5;
    const COL_COST = 9;
    const COL_TIME = 8;
    const LINE_WIDTH = 62;

    const border = "\u2550".repeat(LINE_WIDTH);
    const divider = "\u2500".repeat(LINE_WIDTH);

    const rows: Array<{
      name: string;
      result: string;
      turns: number;
      cost: number;
      time: string;
      durationMs: number;
    }> = [];

    let totalCost = 0;
    let totalDuration = 0;
    let passCount = 0;

    for (const rec of this.records) {
      const { turns, cost } = extractCostFromTraces(rec.traceFiles);
      totalCost += cost;
      totalDuration += rec.durationMs;
      if (rec.passed) passCount++;

      rows.push({
        name: rec.name,
        result: rec.passed == null ? "UNK" : rec.passed ? "PASS" : "FAIL",
        turns,
        cost,
        time: formatDuration(rec.durationMs),
        durationMs: rec.durationMs,
      });
    }

    const lines: string[] = [];
    lines.push("");
    lines.push(`  ${border}`);
    lines.push(`    E2E SUITE REPORT`);
    lines.push(`  ${border}`);

    // Header row
    lines.push(
      `  ${padRight("Test", COL_NAME)}  ${padRight("Result", COL_RESULT)}  ${padLeft("Turns", COL_TURNS)}  ${padLeft("Cost", COL_COST)}  ${padLeft("Time", COL_TIME)}`,
    );
    lines.push(`  ${divider}`);

    // Data rows
    for (const row of rows) {
      lines.push(
        `  ${padRight(row.name, COL_NAME)}  ${padRight(row.result, COL_RESULT)}  ${padLeft(String(row.turns), COL_TURNS)}  ${padLeft(formatCost(row.cost), COL_COST)}  ${padLeft(row.time, COL_TIME)}`,
      );
    }

    lines.push(`  ${divider}`);
    lines.push(
      `  Total: ${passCount}/${this.records.length} passed  |  ${formatCost(totalCost)}  |  ${formatDuration(totalDuration)}`,
    );
    lines.push(`  ${border}`);
    lines.push("");

    console.log(lines.join("\n"));
  }
}

export const suiteReport = new SuiteReport();

process.on("beforeExit", () => {
  suiteReport.printSummary();
});
