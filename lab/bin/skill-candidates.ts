import { resolve } from "path";
import { applyLabEnvironment, LAB_DIR, PROJECT_ROOT, runCommand } from "./common.js";

applyLabEnvironment();

const args = process.argv.slice(2);
const days = readFlag("--days", "7");
const limit = readFlag("--limit", "200");
const save = readFlag("--save", `skill-candidates-${new Date().toISOString().slice(0, 10)}`);

const analyzeExitCode = runCommand("npx", ["tsx", "lab/bin/analyze-traces.ts", "--days", days, "--limit", limit], {
  cwd: PROJECT_ROOT,
});

if (analyzeExitCode !== 0) {
  process.exit(analyzeExitCode);
}

const latestTraceNote = resolve(LAB_DIR, "knowledge", `trace-analysis-${new Date().toISOString().slice(0, 10)}.md`);

const question = [
  "Investigate the latest traces for possible new workflow skills to create and produce a prioritized list of candidates.",
  "Use the current repo context, the latest trace-analysis note, and existing workflow-skills direction.",
  "Focus on recurring workflow shapes, repeated pathologies, and where generic tools or generic prompting appear to be hitting their limit.",
  "For each candidate include: candidate name, trigger/workflow shape, why it should be a skill rather than a tool or harness fix, what traces or E2E classes it seems tied to, and overfitting risk.",
  "Also include a short section for issues that should NOT become skills and should instead become harness, verifier, memory, or tool changes.",
].join(" ");

process.exit(
  runCommand(
    "npx",
    [
      "tsx",
      "lab/bin/research.ts",
      "--save",
      save,
      "--context-file",
      latestTraceNote,
      question,
    ],
    { cwd: PROJECT_ROOT },
  ),
);

function readFlag(name: string, fallback: string): string {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : fallback;
}
