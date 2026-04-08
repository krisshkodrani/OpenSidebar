/**
 * E2E suite report — collects per-test results and writes both a console
 * summary table AND a dated markdown critique report to docs/.
 *
 * Module-level singleton. Registers a beforeExit handler so the report
 * is always written, even on unexpected exits.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { readTrace, TraceTurn } from "./diagnostics";

const PROJECT_ROOT = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "../../..");

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

interface TraceAnalysis extends TraceCostData {
  toolCounts: Record<string, number>;
  repeatedTools: string[];
  model: string | undefined;
  turnDetails: TraceTurn[];
}

function analyzeTraces(traceFiles: string[]): TraceAnalysis {
  let totalCost = 0;
  let totalTurns = 0;
  const toolCounts: Record<string, number> = {};
  let model: string | undefined;
  const allTurns: TraceTurn[] = [];

  for (const filePath of traceFiles) {
    if (!existsSync(filePath)) continue;

    // Extract cost from raw JSON (faster than full parse)
    const raw = readFileSync(filePath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        totalTurns++;
        const cost = entry.llmResponse?.usage?.cost;
        if (typeof cost === "number") totalCost += cost;
        if (!model && entry.llmRequest?.model) model = entry.llmRequest.model;
      } catch {}
    }

    // Detailed turn data for critique
    const turns = readTrace(filePath);
    allTurns.push(...turns);
    for (const turn of turns) {
      for (const tc of turn.toolCalls) {
        toolCounts[tc.name] = (toolCounts[tc.name] || 0) + 1;
      }
    }
  }

  // Detect repeated consecutive tool calls (stagnation signal)
  const repeatedTools: string[] = [];
  for (let i = 1; i < allTurns.length; i++) {
    const prev = allTurns[i - 1].toolCalls.map((t) => t.name).join(",");
    const curr = allTurns[i].toolCalls.map((t) => t.name).join(",");
    if (prev && prev === curr && !repeatedTools.includes(prev)) {
      repeatedTools.push(prev);
    }
  }

  return { turns: totalTurns, cost: totalCost, toolCounts, repeatedTools, model, turnDetails: allTurns };
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

    const analyses = this.records.map((rec) => ({
      rec,
      analysis: analyzeTraces(rec.traceFiles),
    }));

    // Console table
    this.printConsoleTable(analyses);

    // Markdown critique report
    this.writeMarkdownReport(analyses);
  }

  private printConsoleTable(
    analyses: Array<{ rec: TestRecord; analysis: TraceAnalysis }>,
  ): void {
    const COL_NAME = 26;
    const COL_RESULT = 6;
    const COL_TURNS = 5;
    const COL_COST = 9;
    const COL_TIME = 8;
    const LINE_WIDTH = 62;

    const border = "\u2550".repeat(LINE_WIDTH);
    const divider = "\u2500".repeat(LINE_WIDTH);

    let totalCost = 0;
    let totalDuration = 0;
    let passCount = 0;

    const lines: string[] = [];
    lines.push("");
    lines.push(`  ${border}`);
    lines.push(`    E2E SUITE REPORT`);
    lines.push(`  ${border}`);
    lines.push(
      `  ${padRight("Test", COL_NAME)}  ${padRight("Result", COL_RESULT)}  ${padLeft("Turns", COL_TURNS)}  ${padLeft("Cost", COL_COST)}  ${padLeft("Time", COL_TIME)}`,
    );
    lines.push(`  ${divider}`);

    for (const { rec, analysis } of analyses) {
      totalCost += analysis.cost;
      totalDuration += rec.durationMs;
      if (rec.passed) passCount++;

      const result = rec.passed == null ? "UNK" : rec.passed ? "PASS" : "FAIL";
      lines.push(
        `  ${padRight(rec.name, COL_NAME)}  ${padRight(result, COL_RESULT)}  ${padLeft(String(analysis.turns), COL_TURNS)}  ${padLeft(formatCost(analysis.cost), COL_COST)}  ${padLeft(formatDuration(rec.durationMs), COL_TIME)}`,
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

  private writeMarkdownReport(
    analyses: Array<{ rec: TestRecord; analysis: TraceAnalysis }>,
  ): void {
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const timeStr = now.toISOString().split("T")[1].split(".")[0];

    let totalCost = 0;
    let totalDuration = 0;
    let passCount = 0;
    let failCount = 0;

    for (const { rec, analysis } of analyses) {
      totalCost += analysis.cost;
      totalDuration += rec.durationMs;
      if (rec.passed) passCount++;
      else if (rec.passed === false) failCount++;
    }

    const model = analyses.find((a) => a.analysis.model)?.analysis.model || "unknown";
    const md: string[] = [];

    // Header
    md.push(`# E2E Test Report`);
    md.push("");
    md.push(`**Date:** ${dateStr} ${timeStr}`);
    md.push(`**Model:** ${model}`);
    md.push(`**Result:** ${passCount}/${analyses.length} passed${failCount > 0 ? ` (${failCount} failed)` : ""}`);
    md.push(`**Total Cost:** ${formatCost(totalCost)}`);
    md.push(`**Total Time:** ${formatDuration(totalDuration)}`);
    md.push("");

    // Results table
    md.push("## Results");
    md.push("");
    md.push("| Test | Result | Turns | Cost | Time |");
    md.push("|------|--------|------:|-----:|-----:|");

    for (const { rec, analysis } of analyses) {
      const result = rec.passed == null ? "UNK" : rec.passed ? "PASS" : "**FAIL**";
      md.push(
        `| ${rec.name} | ${result} | ${analysis.turns} | ${formatCost(analysis.cost)} | ${formatDuration(rec.durationMs)} |`,
      );
    }
    md.push("");

    // Per-test trace details
    md.push("## Test Details");
    md.push("");

    for (const { rec, analysis } of analyses) {
      const result = rec.passed == null ? "UNK" : rec.passed ? "PASS" : "FAIL";
      md.push(`### ${rec.name} — ${result}`);
      md.push("");

      // Tool usage summary
      if (Object.keys(analysis.toolCounts).length > 0) {
        const sorted = Object.entries(analysis.toolCounts).sort((a, b) => b[1] - a[1]);
        md.push(`**Tools used:** ${sorted.map(([name, count]) => `${name}(${count})`).join(", ")}`);
        md.push("");
      }

      // Turn-by-turn trace (compact)
      if (analysis.turnDetails.length > 0) {
        md.push("<details>");
        md.push(`<summary>Trace (${analysis.turnDetails.length} turns)</summary>`);
        md.push("");
        md.push("```");
        for (const turn of analysis.turnDetails) {
          const tier = turn.modelTier ? `[${turn.modelTier}]` : "";
          const ms = turn.durationMs ? ` (${(turn.durationMs / 1000).toFixed(1)}s)` : "";
          if (turn.toolCalls.length > 0) {
            for (const tc of turn.toolCalls) {
              const args = Object.entries(tc.args)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => `${k}=${typeof v === "string" ? `"${(v as string).slice(0, 40)}"` : v}`)
                .join(", ");
              md.push(`T${turn.turnNumber} ${tier} -> ${tc.name}(${args})${ms}`);
            }
          } else if (turn.llmContent) {
            md.push(`T${turn.turnNumber} ${tier} -- "${turn.llmContent.slice(0, 80).replace(/\n/g, " ")}"${ms}`);
          }
          for (const tr of turn.toolResults) {
            const icon = tr.success ? "ok" : "FAIL";
            md.push(`    ${icon}: ${tr.result.slice(0, 100)}`);
          }
        }
        md.push("```");
        md.push("</details>");
        md.push("");
      }
    }

    // Critique section
    md.push("## Critique");
    md.push("");

    const critiques: string[] = [];

    for (const { rec, analysis } of analyses) {
      // Flag high turn count
      if (analysis.turns > 15) {
        critiques.push(
          `- **${rec.name}**: Used ${analysis.turns} turns — consider if the agent is exploring too much or failing to find elements efficiently.`,
        );
      }

      // Flag repeated tool calls (stagnation)
      if (analysis.repeatedTools.length > 0) {
        critiques.push(
          `- **${rec.name}**: Repeated consecutive tool calls detected: ${analysis.repeatedTools.join(", ")}. Possible stagnation or retry loop.`,
        );
      }

      // Flag failures
      if (rec.passed === false) {
        critiques.push(
          `- **${rec.name}**: FAILED — review trace for root cause.`,
        );
      }

      // Flag high cost
      if (analysis.cost > 0.05) {
        critiques.push(
          `- **${rec.name}**: Cost ${formatCost(analysis.cost)} — higher than typical. Check if unnecessary perception calls or long context.`,
        );
      }
    }

    if (critiques.length === 0) {
      md.push("No issues detected. All tests passed within expected turn counts and costs.");
    } else {
      md.push(...critiques);
    }
    md.push("");

    // Write file
    const reportsDir = resolve(PROJECT_ROOT, "notes", "reports");
    if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
    const reportPath = resolve(reportsDir, `e2e-report-${dateStr}.md`);
    writeFileSync(reportPath, md.join("\n"), "utf-8");
    console.log(`\n[report] Written to ${reportPath}`);
  }
}

export const suiteReport = new SuiteReport();

process.on("beforeExit", () => {
  suiteReport.printSummary();
});
