#!/usr/bin/env tsx
/**
 * Progressive E2E runner — runs each test file individually, writes a
 * per-test report, and maintains a running summary.  Avoids the monolithic
 * 14-hour vitest run that can hang on resource leaks.
 *
 * Usage:
 *   npx tsx scripts/run-e2e-progressive.ts            # run all
 *   npx tsx scripts/run-e2e-progressive.ts login       # run only matching
 *   npx tsx scripts/run-e2e-progressive.ts --resume    # skip already-reported tests
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const E2E_DIR = path.resolve(__dirname, "../tests/e2e");
const dirArg = process.argv.find((a) => a.startsWith("--dir="));
const REPORT_DIR = dirArg
  ? path.resolve(dirArg.split("=")[1])
  : path.resolve(__dirname, "../docs/e2e-reports/natural-v2");
const SUMMARY_FILE = path.join(REPORT_DIR, "_summary.md");
const CONFIG = path.resolve(E2E_DIR, "vitest.e2e.config.ts");

// ── helpers ──────────────────────────────────────────────────────────────

function extractPrompts(filePath: string): string[] {
  const src = fs.readFileSync(filePath, "utf-8");
  const prompts: string[] = [];
  // Match const prompt = "..." or const prompt = `...` or const prompt = [...].join(...)
  const singleLine = /const prompt\s*=\s*(?:"([^"]+)"|`([^`]+)`|'([^']+)')/g;
  for (const m of src.matchAll(singleLine)) {
    prompts.push(m[1] || m[2] || m[3]);
  }
  // Also capture multi-line template literals assigned with =
  if (prompts.length === 0) {
    const multiLine =
      /const prompt\s*=\s*\n?\s*(?:"([^"]+(?:"[^"]*"[^"]+)*)"|`([\s\S]*?)`)/g;
    for (const m of src.matchAll(multiLine)) {
      prompts.push((m[1] || m[2]).replace(/\s+/g, " ").trim());
    }
  }
  // Template literal with string concat
  if (prompts.length === 0) {
    const concat =
      /const prompt\s*=[\s\S]*?(?:"([\s\S]*?)"|'([\s\S]*?)')\s*\+[\s\S]*?;/g;
    for (const m of src.matchAll(concat)) {
      // Just grab what we can
      prompts.push((m[1] || m[2] || "").replace(/\s+/g, " ").trim());
    }
  }
  // Continuation tests: count sendUserChat calls as turns (each is a prompt)
  if (prompts.length === 0) {
    const sendCalls = [...src.matchAll(/sendUserChat\(\s*h\.ctx,\s*\n?\s*"([^"]+)/g)];
    for (const m of sendCalls) {
      prompts.push(m[1].replace(/\s+/g, " ").trim());
    }
    // Also try string concat pattern: sendUserChat(\n  h.ctx,\n  "..." +\n  "...",
    if (prompts.length === 0) {
      const concatCalls = [
        ...src.matchAll(
          /await\s+sendUserChat\(\s*\n?\s*h\.ctx,\s*\n?\s*"([^"]*)/g,
        ),
      ];
      for (const m of concatCalls) {
        prompts.push(m[1].replace(/\s+/g, " ").trim());
      }
    }
  }
  return prompts;
}

function parseTestOutput(output: string): {
  passed: number;
  failed: number;
  tests: { name: string; passed: boolean; time: number }[];
  trace: string;
  tools: string;
  doneSummary: string;
  passLines: string[];
  failLines: string[];
  diagnostics: string;
} {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
  const tests: { name: string; passed: boolean; time: number }[] = [];
  let passed = 0;
  let failed = 0;

  // Parse individual test results
  for (const m of clean.matchAll(
    /([✓×])\s+(?:E2E:.*?>\s+)?(.+?)\s+(\d+)ms/g,
  )) {
    const ok = m[1] === "✓";
    tests.push({ name: m[2].trim(), passed: ok, time: parseInt(m[3], 10) });
    if (ok) passed++;
    else failed++;
  }

  // Extract trace block
  const traceMatch = clean.match(
    /={10,}\n\s*AGENT TRACE[\s\S]*?={10,}/g,
  );
  const trace = traceMatch ? traceMatch.join("\n\n") : "";

  // Extract tools used
  const toolsMatch = clean.match(/\[e2e\] Tools used: (.+)/);
  const tools = toolsMatch ? toolsMatch[1] : "";

  // Extract done summary
  const doneMatch = clean.match(/\[e2e\] (?:Done summary|Trace done\(\)): ([\s\S]*?)(?=\n\[|$)/);
  const doneSummary = doneMatch ? doneMatch[1].trim() : "";

  // PASS / FAIL lines
  const passLines = [...clean.matchAll(/\[e2e\] PASS[^\n]*/g)].map(
    (m) => m[0],
  );
  const failLines = [...clean.matchAll(/\[e2e\] FAIL[^\n]*/g)].map(
    (m) => m[0],
  );

  // Diagnostics
  const diagMatch = clean.match(
    /FAILURE DIAGNOSTICS:[\s\S]*?(?=\n\[(?:e2e|sw)|$)/g,
  );
  const diagnostics = diagMatch ? diagMatch.join("\n") : "";

  // Failure reason arrows
  const failReasons = [...clean.matchAll(/→ (.+)/g)].map((m) => m[1]);

  return {
    passed,
    failed,
    tests,
    trace,
    tools,
    doneSummary,
    passLines,
    failLines,
    diagnostics:
      diagnostics +
      (failReasons.length > 0
        ? "\nFailure reasons:\n" + failReasons.map((r) => `  - ${r}`).join("\n")
        : ""),
  };
}

function writeReport(
  testFile: string,
  prompts: string[],
  result: ReturnType<typeof parseTestOutput>,
  duration: number,
  rawOutput: string,
): void {
  const basename = path.basename(testFile, ".test.ts");
  const reportPath = path.join(REPORT_DIR, `${basename}.md`);
  const overall = result.failed === 0 ? "PASS" : "FAIL";
  const clean = rawOutput.replace(/\x1b\[[0-9;]*m/g, "");

  let md = `# ${basename}\n\n`;
  md += `**Result**: ${overall} (${result.passed} passed, ${result.failed} failed)\n`;
  md += `**Duration**: ${(duration / 1000).toFixed(1)}s\n`;
  md += `**Date**: ${new Date().toISOString().slice(0, 10)}\n\n`;

  // Prompts
  md += `## Prompts Used\n\n`;
  for (const [i, p] of prompts.entries()) {
    md += `### ${prompts.length > 1 ? `Test ${i + 1}` : "Prompt"}\n`;
    md += `> ${p}\n\n`;
  }

  // Per-test results
  if (result.tests.length > 0) {
    md += `## Test Results\n\n`;
    md += `| Test | Result | Time |\n|---|---|---|\n`;
    for (const t of result.tests) {
      md += `| ${t.name} | ${t.passed ? "PASS" : "FAIL"} | ${(t.time / 1000).toFixed(1)}s |\n`;
    }
    md += `\n`;
  }

  // Stats
  md += `## Stats\n\n`;
  md += `- Tools used: ${result.tools || "N/A"}\n`;
  md += `- Done summary: ${result.doneSummary || "N/A"}\n`;
  md += `\n`;

  // Trace
  if (result.trace) {
    md += `## Agent Trace\n\n\`\`\`\n${result.trace}\n\`\`\`\n\n`;
  }

  // Critique & suggested solution (for failures)
  if (result.failed > 0) {
    md += `## Critique\n\n`;
    if (result.diagnostics) {
      md += `\`\`\`\n${result.diagnostics.slice(0, 2000)}\n\`\`\`\n\n`;
    }
    if (result.failLines.length > 0) {
      md += `Failure indicators:\n`;
      for (const l of result.failLines) md += `- ${l}\n`;
      md += `\n`;
    }

    // Auto-categorize failure
    const diag = (result.diagnostics + " " + clean).toLowerCase();
    md += `## Suggested Solution\n\n`;
    if (diag.includes("timeout")) {
      md += `- **Timeout**: Agent ran out of turns/time. Check if planner decomposition produced actionable steps. Consider if the natural prompt needs slight clarification (without reverting to engineered language).\n`;
    }
    if (diag.includes("done") && diag.includes("reject")) {
      md += `- **Premature done()**: Agent called done() before completing all steps. The done() rejection with next-step-hint (Fix 1A) should help. If still failing, the planner may need to produce more explicit step boundaries.\n`;
    }
    if (diag.includes("tab") && diag.includes("block")) {
      md += `- **Tab gate**: Tab tools were blocked. Check if planner step objectives mention tab-related keywords for Fix 3 to activate.\n`;
    }
    if (
      diag.includes("not found") &&
      (diag.includes("scroll") || diag.includes("viewport"))
    ) {
      md += `- **Scroll/find**: Element not found in viewport. Fix 5 should guide scrolling. If still failing, the feed may need more scroll attempts.\n`;
    }
    if (diag.includes("autocomplete") || diag.includes("suggestion")) {
      md += `- **Autocomplete timing**: Agent didn't wait for suggestions. Fix 4 should detect post-type DOM changes.\n`;
    }
    if (!diag.includes("timeout") && !diag.includes("done")) {
      md += `- **General**: Review the trace for the specific failure point. The agent may need perception or tool improvements beyond the current 5 fixes.\n`;
    }
  } else {
    md += `## Critique\n\nAll tests passed. No issues detected.\n\n`;
  }

  fs.writeFileSync(reportPath, md);
  console.log(`  Report: ${reportPath}`);
}

function updateSummary(
  results: {
    file: string;
    passed: number;
    failed: number;
    duration: number;
  }[],
): void {
  let md = `# E2E Progressive Report — Natural Language Prompts v2\n\n`;
  md += `**Date**: ${new Date().toISOString().slice(0, 10)}\n`;
  const totalPass = results.reduce((s, r) => s + r.passed, 0);
  const totalFail = results.reduce((s, r) => s + r.failed, 0);
  const totalTime = results.reduce((s, r) => s + r.duration, 0);
  md += `**Overall**: ${totalPass}/${totalPass + totalFail} passed (${Math.round((totalPass / (totalPass + totalFail || 1)) * 100)}%)\n`;
  md += `**Total time**: ${(totalTime / 1000 / 60).toFixed(1)} min\n\n`;

  md += `| Test File | Pass | Fail | Time | Result |\n`;
  md += `|---|---|---|---|---|\n`;
  for (const r of results) {
    const name = path.basename(r.file, ".test.ts");
    const icon = r.failed === 0 ? "PASS" : "FAIL";
    md += `| [${name}](${name}.md) | ${r.passed} | ${r.failed} | ${(r.duration / 1000).toFixed(0)}s | ${icon} |\n`;
  }

  md += `\n## Compared to v1 (pre-fix baseline)\n\n`;
  md += `Baseline: 30/42 passed (71%) — see \`docs/e2e-report-2026-04-09.md\`\n`;
  md += `Current:  ${totalPass}/${totalPass + totalFail} passed (${Math.round((totalPass / (totalPass + totalFail || 1)) * 100)}%)\n`;

  fs.writeFileSync(SUMMARY_FILE, md);
}

// ── main ─────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const filterArg = args.find((a) => !a.startsWith("--"));
  const resume = args.includes("--resume");

  // Collect test files
  const allFiles = fs
    .readdirSync(E2E_DIR)
    .filter((f) => f.endsWith(".test.ts"))
    .sort();

  const testFiles = filterArg
    ? allFiles.filter((f) => f.includes(filterArg))
    : allFiles;

  if (testFiles.length === 0) {
    console.error(`No test files matching "${filterArg}"`);
    process.exit(1);
  }

  fs.mkdirSync(REPORT_DIR, { recursive: true });

  // Build first
  console.log("Building extension...");
  try {
    execSync("npm run build", { cwd: path.resolve(__dirname, ".."), stdio: "pipe" });
    console.log("Build OK\n");
  } catch (e: any) {
    console.error("Build failed:", e.stderr?.toString().slice(-500));
    process.exit(1);
  }

  const summaryResults: {
    file: string;
    passed: number;
    failed: number;
    duration: number;
  }[] = [];

  // Load existing results if resuming
  if (resume) {
    for (const f of testFiles) {
      const basename = path.basename(f, ".test.ts");
      const reportPath = path.join(REPORT_DIR, `${basename}.md`);
      if (fs.existsSync(reportPath)) {
        const content = fs.readFileSync(reportPath, "utf-8");
        const passMatch = content.match(/(\d+) passed/);
        const failMatch = content.match(/(\d+) failed/);
        const durMatch = content.match(/\*\*Duration\*\*: ([\d.]+)s/);
        if (passMatch && failMatch && durMatch) {
          summaryResults.push({
            file: f,
            passed: parseInt(passMatch[1]),
            failed: parseInt(failMatch[1]),
            duration: parseFloat(durMatch[1]) * 1000,
          });
          console.log(`⏭  Skipping ${basename} (already reported)`);
        }
      }
    }
  }

  const alreadyDone = new Set(summaryResults.map((r) => r.file));

  for (const file of testFiles) {
    if (alreadyDone.has(file)) continue;

    const filePath = path.join(E2E_DIR, file);
    const basename = path.basename(file, ".test.ts");
    const prompts = extractPrompts(filePath);

    console.log(`\n${"═".repeat(60)}`);
    console.log(`  Running: ${file}`);
    console.log(`  Prompt(s): ${prompts.length}`);
    console.log(`${"═".repeat(60)}`);

    const start = Date.now();
    let output = "";
    let exitCode = 0;

    try {
      output = execSync(
        `npx vitest run --config "${CONFIG}" "${filePath}"`,
        {
          cwd: path.resolve(__dirname, ".."),
          timeout: Math.max(720_000, prompts.length * 240_000), // 12 min base, +4 min per user turn
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, FORCE_COLOR: "0" },
        },
      );
    } catch (e: any) {
      exitCode = e.status ?? 1;
      output = (e.stdout || "") + "\n" + (e.stderr || "");
    }

    const duration = Date.now() - start;
    const result = parseTestOutput(output);

    // Fallback if parser found no tests (e.g. crash)
    if (result.tests.length === 0 && exitCode !== 0) {
      result.failed = 1;
      result.diagnostics += "\nTest process crashed or timed out.";
    }

    writeReport(file, prompts, result, duration, output);

    summaryResults.push({
      file,
      passed: result.passed,
      failed: result.failed,
      duration,
    });

    updateSummary(summaryResults);

    const icon = result.failed === 0 ? "✓" : "✗";
    console.log(
      `  ${icon} ${basename}: ${result.passed} pass / ${result.failed} fail (${(duration / 1000).toFixed(0)}s)`,
    );
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log("  DONE — All tests complete");
  const totalPass = summaryResults.reduce((s, r) => s + r.passed, 0);
  const totalFail = summaryResults.reduce((s, r) => s + r.failed, 0);
  console.log(`  Overall: ${totalPass}/${totalPass + totalFail} passed`);
  console.log(`  Summary: ${SUMMARY_FILE}`);
  console.log(`${"═".repeat(60)}`);
}

main();
