#!/usr/bin/env tsx
/**
 * Progressive E2E runner — runs each test file individually, writes a
 * per-test report, and maintains a running summary.  Avoids the monolithic
 * 14-hour vitest run that can hang on resource leaks.
 *
 * Usage:
 *   pnpm exec tsx scripts/run-e2e-progressive.ts            # run all
 *   pnpm exec tsx scripts/run-e2e-progressive.ts login       # run only matching
 *   pnpm exec tsx scripts/run-e2e-progressive.ts --resume    # skip already-reported tests
 */

import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

function runWithTimeout(
  cmd: string,
  args: string[],
  opts: { cwd: string; timeout: number; env: Record<string, string | undefined> },
): Promise<{ stdout: string; exitCode: number }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let killed = false;

    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env as NodeJS.ProcessEnv,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });

    child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      killed = true;
      // On Windows, taskkill /T kills the process tree
      try {
        execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: "ignore" });
      } catch {
        child.kill("SIGKILL");
      }
    }, opts.timeout);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout: stdout + "\n" + stderr,
        exitCode: killed ? 1 : (code ?? 1),
      });
    });

    child.on("error", () => {
      clearTimeout(timer);
      resolve({ stdout: stdout + "\n" + stderr, exitCode: 1 });
    });
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");
const VITEST_CLI = path.resolve(PROJECT_ROOT, "node_modules/vitest/vitest.mjs");

const E2E_DIR = path.resolve(__dirname, "../apps/extension/tests/e2e");
const TRACE_DIR = path.resolve(__dirname, "../traces");
const RUN_TRACE_DIR = path.join(TRACE_DIR, "runs");
const dirArg = process.argv.find((a) => a.startsWith("--dir="));
const REPORT_DIR = dirArg
  ? path.resolve(dirArg.split("=")[1])
  : path.resolve(__dirname, "../.artifacts/e2e-progressive/natural-v2");
const SUMMARY_FILE = path.join(REPORT_DIR, "_summary.md");
const CONFIG = path.resolve(E2E_DIR, "vitest.e2e.config.ts");
const TRACE_INDEX_FILE = path.join(TRACE_DIR, "index.jsonl");

interface TraceSessionSummary {
  sessionId: string;
  outcome: string;
  failureCategory?: string;
  failureCode?: string;
  failureDetail?: string;
}

interface SkillNodeSummary {
  nodeId: string;
  skillId: string;
  reason?: string;
  outcome?: string;
  failureType?: string;
  failureReason?: string;
  summary?: string;
}

interface SkillAnalytics {
  skillIds: string[];
  nodeSkills: SkillNodeSummary[];
  sessions: TraceSessionSummary[];
}

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

function snapshotTraceFiles(): Set<string> {
  if (!fs.existsSync(TRACE_DIR)) return new Set();
  return new Set(
    fs
      .readdirSync(TRACE_DIR)
      .filter((f) => f.endsWith(".jsonl") && f !== "index.jsonl"),
  );
}

function findAllNewTraceFiles(before: Set<string>): string[] {
  if (!fs.existsSync(TRACE_DIR)) return [];
  return fs
    .readdirSync(TRACE_DIR)
    .filter((f) => f.endsWith(".jsonl") && f !== "index.jsonl")
    .filter((f) => !before.has(f))
    .map((f) => path.join(TRACE_DIR, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function extractRunIdsFromTraceFiles(traceFiles: string[]): string[] {
  const runIds = new Set<string>();
  for (const filePath of traceFiles) {
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (typeof entry?.runId === "string" && entry.runId.length > 0) {
          runIds.add(entry.runId);
        }
      } catch {}
    }
  }
  return [...runIds];
}

function readTraceSessionIndex(): Map<string, TraceSessionSummary> {
  const bySessionId = new Map<string, TraceSessionSummary>();
  if (!fs.existsSync(TRACE_INDEX_FILE)) return bySessionId;
  const raw = fs.readFileSync(TRACE_INDEX_FILE, "utf-8");
  const lines = raw.trim().split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const sessionId =
        typeof entry?.sessionId === "string" ? entry.sessionId : "";
      if (!sessionId) continue;
      bySessionId.set(sessionId, {
        sessionId,
        outcome: typeof entry?.outcome === "string" ? entry.outcome : "unknown",
        failureCategory:
          typeof entry?.failureCategory === "string"
            ? entry.failureCategory
            : undefined,
        failureCode:
          typeof entry?.failureCode === "string"
            ? entry.failureCode
            : undefined,
        failureDetail:
          typeof entry?.failureDetail === "string"
            ? entry.failureDetail
            : undefined,
      });
    } catch {}
  }
  return bySessionId;
}

function extractSessionSummariesFromTraceFiles(
  traceFiles: string[],
): TraceSessionSummary[] {
  const bySessionId = readTraceSessionIndex();
  const seen = new Set<string>();
  const sessions: TraceSessionSummary[] = [];
  for (const filePath of traceFiles) {
    const sessionId = path.basename(filePath, ".jsonl");
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    const summary = bySessionId.get(sessionId);
    if (summary) sessions.push(summary);
  }
  return sessions;
}

function extractSkillAnalytics(
  runIds: string[],
  traceFiles: string[],
): SkillAnalytics {
  const skillIds = new Set<string>();
  const nodeSkills = new Map<string, SkillNodeSummary>();

  for (const runId of runIds) {
    const traceFile = path.join(RUN_TRACE_DIR, `${runId}.jsonl`);
    if (!fs.existsSync(traceFile)) continue;
    const raw = fs.readFileSync(traceFile, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry?.traceKind !== "orchestrator.run.event") continue;

        if (
          entry?.type === "plan_decomposed" &&
          Array.isArray(entry?.data?.skills)
        ) {
          for (const item of entry.data.skills) {
            const nodeId =
              typeof item?.nodeId === "string" ? item.nodeId : "";
            const skillId =
              typeof item?.skillId === "string" ? item.skillId : "";
            const reason =
              typeof item?.reason === "string" ? item.reason : undefined;
            if (!nodeId || !skillId) continue;
            skillIds.add(skillId);
            const current = nodeSkills.get(nodeId) ?? { nodeId, skillId };
            current.skillId = skillId;
            if (reason) current.reason = reason;
            nodeSkills.set(nodeId, current);
          }
        }

        if (entry?.type === "node_started") {
          const nodeId =
            typeof entry?.data?.nodeId === "string" ? entry.data.nodeId : "";
          const skillId =
            typeof entry?.data?.selectedSkillId === "string"
              ? entry.data.selectedSkillId
              : "";
          const reason =
            typeof entry?.data?.selectedSkillReason === "string"
              ? entry.data.selectedSkillReason
              : undefined;
          if (!nodeId || !skillId) continue;
          skillIds.add(skillId);
          const current = nodeSkills.get(nodeId) ?? { nodeId, skillId };
          current.skillId = skillId;
          if (reason) current.reason = reason;
          nodeSkills.set(nodeId, current);
        }

        if (entry?.type === "node_verified") {
          const nodeId =
            typeof entry?.data?.nodeId === "string" ? entry.data.nodeId : "";
          if (!nodeId) continue;
          const current =
            nodeSkills.get(nodeId) ?? ({ nodeId, skillId: "unattributed" } as SkillNodeSummary);
          const failureType =
            typeof entry?.data?.failureType === "string"
              ? entry.data.failureType
              : undefined;
          const failureReason =
            typeof entry?.data?.reason === "string" ? entry.data.reason : undefined;
          if (failureType) current.failureType = failureType;
          if (failureReason) current.failureReason = failureReason;
          nodeSkills.set(nodeId, current);
        }

        if (entry?.type === "node_completed") {
          const nodeId =
            typeof entry?.data?.nodeId === "string" ? entry.data.nodeId : "";
          if (!nodeId) continue;
          const current =
            nodeSkills.get(nodeId) ?? ({ nodeId, skillId: "unattributed" } as SkillNodeSummary);
          const outcome =
            typeof entry?.data?.outcome === "string" ? entry.data.outcome : undefined;
          const summary =
            typeof entry?.data?.summary === "string" ? entry.data.summary : undefined;
          if (outcome) current.outcome = outcome;
          if (summary) current.summary = summary;
          nodeSkills.set(nodeId, current);
        }
      } catch {}
    }
  }

  return {
    skillIds: [...skillIds].sort(),
    nodeSkills: [...nodeSkills.values()].sort((a, b) =>
      a.nodeId.localeCompare(b.nodeId),
    ),
    sessions: extractSessionSummariesFromTraceFiles(traceFiles),
  };
}

function summarizeSessionOutcomes(sessions: TraceSessionSummary[]): string {
  if (sessions.length === 0) return "N/A";
  const counts = new Map<string, number>();
  for (const session of sessions) {
    counts.set(session.outcome, (counts.get(session.outcome) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([outcome, count]) => `${outcome}=${count}`)
    .join(", ");
}

function writeReport(
  testFile: string,
  prompts: string[],
  result: ReturnType<typeof parseTestOutput>,
  duration: number,
  rawOutput: string,
  skillSummary: SkillAnalytics,
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
  md += `- Skills used: ${skillSummary.skillIds.length > 0 ? skillSummary.skillIds.map((s) => `\`${s}\``).join(", ") : "N/A"}\n`;
  md += `- Trace outcomes: ${summarizeSessionOutcomes(skillSummary.sessions)}\n`;
  md += `\n`;

  if (skillSummary.nodeSkills.length > 0) {
    md += `## Skill Routing\n\n`;
    md += `| Node | Skill | Outcome | Failure Type | Reason |\n|---|---|---|---|---|\n`;
    for (const item of skillSummary.nodeSkills) {
      md += `| ${item.nodeId.slice(0, 8)} | \`${item.skillId}\` | ${item.outcome || "-"} | ${item.failureType || "-"} | ${item.reason || "-"} |\n`;
    }
    md += `\n`;
  }

  const failingSessions = skillSummary.sessions.filter(
    (session) => session.outcome !== "completed",
  );
  if (failingSessions.length > 0) {
    md += `## Trace Failure Summary\n\n`;
    for (const session of failingSessions) {
      md += `- Session \`${session.sessionId.slice(0, 8)}\`: outcome=${session.outcome}`;
      if (session.failureCode && session.failureCode !== "none") {
        md += `; code=\`${session.failureCode}\``;
      }
      if (session.failureCategory && session.failureCategory !== "none") {
        md += `; category=\`${session.failureCategory}\``;
      }
      if (session.failureDetail) {
        md += `; detail=${session.failureDetail}`;
      }
      md += `\n`;
    }
    md += `\n`;
  }

  const skillFailures = skillSummary.nodeSkills.filter(
    (node) =>
      node.failureType ||
      (node.outcome && node.outcome !== "completed"),
  );
  if (skillFailures.length > 0) {
    md += `## Skill Failure Signals\n\n`;
    md += `| Skill | Node | Outcome | Failure Type | Signal |\n|---|---|---|---|---|\n`;
    for (const item of skillFailures) {
      const signal =
        item.failureReason ||
        item.summary ||
        "-";
      md += `| \`${item.skillId}\` | ${item.nodeId.slice(0, 8)} | ${item.outcome || "-"} | ${item.failureType || "-"} | ${signal.replace(/\|/g, "\\|").slice(0, 180)} |\n`;
    }
    md += `\n`;
  }

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
    skillIds: string[];
    sessions: TraceSessionSummary[];
    nodeSkills: SkillNodeSummary[];
  }[],
): void {
  let md = `# E2E Progressive Report — Natural Language Prompts v2\n\n`;
  md += `**Date**: ${new Date().toISOString().slice(0, 10)}\n`;
  const totalPass = results.reduce((s, r) => s + r.passed, 0);
  const totalFail = results.reduce((s, r) => s + r.failed, 0);
  const totalTime = results.reduce((s, r) => s + r.duration, 0);
  md += `**Overall**: ${totalPass}/${totalPass + totalFail} passed (${Math.round((totalPass / (totalPass + totalFail || 1)) * 100)}%)\n`;
  md += `**Total time**: ${(totalTime / 1000 / 60).toFixed(1)} min\n\n`;

  md += `| Test File | Pass | Fail | Time | Result | Skills |\n`;
  md += `|---|---|---|---|---|---|\n`;
  for (const r of results) {
    const name = path.basename(r.file, ".test.ts");
    const icon = r.failed === 0 ? "PASS" : "FAIL";
    md += `| [${name}](${name}.md) | ${r.passed} | ${r.failed} | ${(r.duration / 1000).toFixed(0)}s | ${icon} | ${r.skillIds.length > 0 ? r.skillIds.map((skillId) => `\`${skillId}\``).join(", ") : "-"} |\n`;
  }

  md += `\n## Skill Summary\n\n`;
  const skillUsage = new Map<string, { total: number; passing: number; failing: number }>();
  for (const r of results) {
    for (const skillId of r.skillIds) {
      const current = skillUsage.get(skillId) ?? {
        total: 0,
        passing: 0,
        failing: 0,
      };
      current.total += 1;
      if (r.failed === 0) current.passing += 1;
      else current.failing += 1;
      skillUsage.set(skillId, current);
    }
  }
  if (skillUsage.size === 0) {
    md += `No workflow skills were detected in the linked run traces.\n`;
  } else {
    for (const [skillId, counts] of [...skillUsage.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      md += `- \`${skillId}\`: used in ${counts.total} test file(s); ${counts.passing} passing, ${counts.failing} failing\n`;
    }
  }

  md += `\n## Skill Failure Analytics\n\n`;
  const failureBySkill = new Map<
    string,
    {
      failureTypes: Map<string, number>;
      failureCodes: Map<string, number>;
      outcomes: Map<string, number>;
    }
  >();
  for (const result of results) {
    for (const node of result.nodeSkills) {
      const current =
        failureBySkill.get(node.skillId) ?? {
          failureTypes: new Map<string, number>(),
          failureCodes: new Map<string, number>(),
          outcomes: new Map<string, number>(),
        };
      if (node.outcome) {
        current.outcomes.set(
          node.outcome,
          (current.outcomes.get(node.outcome) ?? 0) + 1,
        );
      }
      if (node.failureType) {
        current.failureTypes.set(
          node.failureType,
          (current.failureTypes.get(node.failureType) ?? 0) + 1,
        );
      }
      failureBySkill.set(node.skillId, current);
    }
    for (const session of result.sessions) {
      if (!session.failureCode || session.failureCode === "none") continue;
      for (const skillId of result.skillIds) {
        const current =
          failureBySkill.get(skillId) ?? {
            failureTypes: new Map<string, number>(),
            failureCodes: new Map<string, number>(),
            outcomes: new Map<string, number>(),
          };
        current.failureCodes.set(
          session.failureCode,
          (current.failureCodes.get(session.failureCode) ?? 0) + 1,
        );
        failureBySkill.set(skillId, current);
      }
    }
  }
  if (failureBySkill.size === 0) {
    md += `No skill-linked failure signals were detected.\n`;
  } else {
    for (const [skillId, stats] of [...failureBySkill.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    )) {
      const topFailureTypes = [...stats.failureTypes.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([value, count]) => `${value}=${count}`)
        .join(", ");
      const topFailureCodes = [...stats.failureCodes.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([value, count]) => `${value}=${count}`)
        .join(", ");
      const outcomes = [...stats.outcomes.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([value, count]) => `${value}=${count}`)
        .join(", ");
      md += `- \`${skillId}\`: outcomes ${outcomes || "n/a"}`;
      if (topFailureTypes) md += `; failure types ${topFailureTypes}`;
      if (topFailureCodes) md += `; failure codes ${topFailureCodes}`;
      md += `\n`;
    }
  }

  md += `\n## Compared to v1 (pre-fix baseline)\n\n`;
  md += `Baseline: 30/42 passed (71%) - see the local E2E reports under \`.artifacts/e2e/\`\n`;
  md += `Current:  ${totalPass}/${totalPass + totalFail} passed (${Math.round((totalPass / (totalPass + totalFail || 1)) * 100)}%)\n`;

  fs.writeFileSync(SUMMARY_FILE, md);
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
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
    execSync("corepack pnpm run build", { cwd: PROJECT_ROOT, stdio: "pipe" });
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
    skillIds: string[];
    sessions: TraceSessionSummary[];
    nodeSkills: SkillNodeSummary[];
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
            skillIds: [],
            sessions: [],
            nodeSkills: [],
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
    const traceBefore = snapshotTraceFiles();
    let output = "";
    let exitCode = 0;

    const timeoutMs = Math.max(720_000, prompts.length * 240_000);
    const runResult = await runWithTimeout(
      process.execPath,
      [VITEST_CLI, "run", "--config", CONFIG, filePath],
      {
        cwd: PROJECT_ROOT,
        timeout: timeoutMs,
        env: { ...process.env, FORCE_COLOR: "0" },
      },
    );
    output = runResult.stdout;
    exitCode = runResult.exitCode;
    const traceFiles = findAllNewTraceFiles(traceBefore);
    const runIds = extractRunIdsFromTraceFiles(traceFiles);
    const skillSummary = extractSkillAnalytics(runIds, traceFiles);

    const duration = Date.now() - start;
    const result = parseTestOutput(output);

    // Fallback if parser found no tests (e.g. crash)
    if (result.tests.length === 0 && exitCode !== 0) {
      result.failed = 1;
      result.diagnostics += "\nTest process crashed or timed out.";
    }

    writeReport(file, prompts, result, duration, output, skillSummary);

    summaryResults.push({
      file,
      passed: result.passed,
      failed: result.failed,
      duration,
      skillIds: skillSummary.skillIds,
      sessions: skillSummary.sessions,
      nodeSkills: skillSummary.nodeSkills,
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

