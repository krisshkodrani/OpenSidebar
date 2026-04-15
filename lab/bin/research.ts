import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import {
  applyLabEnvironment,
  captureCommand,
  GBRAIN_DB_PATH,
  GBRAIN_REPO,
  HERMES_HOME,
  HERMES_REPO,
  LAB_DIR,
  PROJECT_ROOT,
} from "./common.js";
import {
  assessNoteContent,
  buildFailedResearchArtifact,
  buildResearchModelConfig,
  buildResearchPrompt,
  buildSavedNote,
  extractAssistantNoteFromSession,
  extractNoteContent,
  normalizeNoteName,
  type ResearchMode,
} from "./research-helpers.js";

applyLabEnvironment();

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: npm run lab:research -- "your research question"');
  console.error('   or: npm run lab:research -- --save my-note "your research question"');
  console.error('   optional: --mode local|external');
  process.exit(1);
}

const hermesProbe = captureCommand("python", ["-m", "hermes_cli.main", "--help"], {
  cwd: PROJECT_ROOT,
  env: process.env,
});

if (hermesProbe.status !== 0) {
  console.error("Hermes CLI is not installed. Install it in lab/agents/hermes/repo first.");
  process.exit(1);
}

let saveTarget: string | null = null;
const saveIndex = args.indexOf("--save");
if (saveIndex !== -1) {
  saveTarget = args[saveIndex + 1] || null;
  args.splice(saveIndex, saveTarget ? 2 : 1);
}

let mode: ResearchMode = "local";
const modeIndex = args.indexOf("--mode");
if (modeIndex !== -1) {
  const value = (args[modeIndex + 1] || "").trim().toLowerCase();
  if (value !== "local" && value !== "external") {
    console.error('Invalid --mode value. Expected "local" or "external".');
    process.exit(1);
  }
  mode = value;
  args.splice(modeIndex, 2);
}

const contextFiles: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] !== "--context-file") continue;
  const value = args[i + 1];
  if (value) {
    contextFiles.push(value);
    args.splice(i, 2);
    i -= 1;
  } else {
    args.splice(i, 1);
    i -= 1;
  }
}

const query = args.join(" ").trim();
if (!query) {
  console.error("Research query is empty.");
  process.exit(1);
}

const researchProfile = prepareHermesResearchProfile();

const saveInstruction = saveTarget
  ? `Produce the full research note content in your final answer. Do not try to write files yourself; the wrapper will save the note to lab/research/${normalizeNoteName(saveTarget)}.`
  : "Print a concise final research note. Do not make code changes unless strictly needed for the research task.";

const contextBundle = buildContextBundle(contextFiles);
const prompt = buildResearchPrompt({
  mode,
  query,
  saveInstruction,
  contextBundle,
});

const result = captureCommand(
  "python",
  [
    "-m",
    "hermes_cli.main",
    "chat",
    "-q",
    prompt,
    "--max-turns",
    "1",
    "-Q",
  ],
  {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
      OPENROUTER_API_KEY: researchProfile.allowOpenRouterFallback
        ? process.env.OPENROUTER_API_KEY ?? ""
        : "",
    },
  },
);

if (result.stderr.trim()) {
  process.stderr.write(result.stderr);
}

if (result.status !== 0) {
  if (result.stdout.trim()) process.stdout.write(result.stdout);
  process.exit(result.status);
}

const stdout = result.stdout.trim();
if (!stdout) {
  console.error("Hermes returned no output.");
  process.exit(1);
}

const noteContent = extractNoteContent(stdout) || extractNoteFromSession(stdout);
if (!noteContent) {
  console.error("Hermes completed, but no research note could be extracted from stdout or session history.");
  process.exit(1);
}

const assessment = assessNoteContent(noteContent, { forSave: Boolean(saveTarget) });
if (!saveTarget) {
  if (assessment.status === "failed") {
    console.error(`Hermes returned unusable output: ${assessment.reason}`);
    process.exit(1);
  }
  process.stdout.write(`${assessment.normalized}\n`);
  process.exit(0);
}

if (assessment.status !== "success") {
  const failedDir = resolve(LAB_DIR, "research", "_failed");
  mkdirSync(failedDir, { recursive: true });
  const failedPath = resolve(failedDir, normalizeNoteName(saveTarget));
  writeFileSync(
    failedPath,
    buildFailedResearchArtifact({
      query,
      mode,
      assessment,
      rawStdout: noteContent,
    }),
    "utf-8",
  );
  console.error(
    `Hermes returned ${assessment.status} research output (${assessment.reason}). Saved diagnostic artifact to ${failedPath}`,
  );
  process.exit(2);
}

process.stdout.write(`${assessment.normalized}\n`);

const researchDir = resolve(LAB_DIR, "research");
mkdirSync(researchDir, { recursive: true });
const fileName = normalizeNoteName(saveTarget);
const notePath = resolve(researchDir, fileName);
const finalNote = buildSavedNote(assessment.normalized, query, mode);
writeFileSync(notePath, finalNote, "utf-8");

console.log(`\nSaved research note to ${notePath}`);
console.log("\n--- Re-indexing lab/research ---");
const importResult = captureCommand(
  process.platform === "win32" ? "cmd" : "bun",
  process.platform === "win32"
    ? ["/c", "bun", "run", "src/cli.ts", "import", researchDir, "--no-embed"]
    : ["run", "src/cli.ts", "import", researchDir, "--no-embed"],
  {
    cwd: GBRAIN_REPO,
    env: {
      ...process.env,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
    },
  },
);

if (importResult.stdout.trim()) process.stdout.write(importResult.stdout);
if (importResult.stderr.trim()) process.stderr.write(importResult.stderr);

if (importResult.status === 0 || /Import complete/i.test(importResult.stdout)) {
  process.exit(0);
}

console.warn("Re-index step did not report success cleanly. The research note was still saved.");
process.exit(0);

function extractNoteFromSession(output: string): string {
  const sessionMatch = output.match(/session_id:\s*([^\s]+)/i);
  if (!sessionMatch) return "";
  const sessionPath = resolve(
    PROJECT_ROOT,
    "data",
    "lab-home",
    ".hermes",
    "sessions",
    `session_${sessionMatch[1]}.json`,
  );
  if (!existsSync(sessionPath)) return "";

  try {
    const raw = readFileSync(sessionPath, "utf-8");
    return extractAssistantNoteFromSession(raw);
  } catch {
    return "";
  }
}

function prepareHermesResearchProfile(): { allowOpenRouterFallback: boolean } {
  mkdirSync(HERMES_HOME, { recursive: true });
  mkdirSync(resolve(HERMES_HOME, "sessions"), { recursive: true });

  const hasFireworks = Boolean(process.env.FIREWORKS_API_KEY);
  const hasOpenAi = Boolean(process.env.OPENAI_API_KEY);
  const hasOpenRouter = Boolean(process.env.OPENROUTER_API_KEY);

  if (!hasFireworks && !hasOpenAi && !hasOpenRouter) {
    console.error("lab:research needs FIREWORKS_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY in the project .env.");
    process.exit(1);
  }

  const modelConfig = buildResearchModelConfig({
    hasFireworks,
    hasOpenAi,
    hasOpenRouter,
  });

  writeFileSync(resolve(HERMES_HOME, "config.yaml"), `${modelConfig.configText}\n`, "utf-8");
  return { allowOpenRouterFallback: modelConfig.allowOpenRouterFallback };
}

function buildContextBundle(extraFiles: string[]): string {
  const packageJson = safeRead(resolve(PROJECT_ROOT, "package.json"), 3000);
  const labReadme = safeRead(resolve(LAB_DIR, "README.md"), 5000);
  const agentsReadme = safeRead(resolve(LAB_DIR, "agents", "README.md"), 4000);
  const labResearchFiles = listMarkdownNames(resolve(LAB_DIR, "research"));
  const labKnowledgeFiles = listMarkdownNames(resolve(LAB_DIR, "knowledge"));
  const extraSections = extraFiles
    .map((filePath) => {
      const resolvedPath = resolve(PROJECT_ROOT, filePath);
      return [`## Attached context: ${filePath}`, safeRead(resolvedPath, 12000)].join("\n");
    })
    .join("\n\n");

  const statusLines = [
    `- Lab root: ${LAB_DIR}`,
    `- Project root: ${PROJECT_ROOT}`,
    `- Hermes repo present: ${existsSync(HERMES_REPO) ? "yes" : "no"}`,
    `- GBrain DB initialized: ${existsSync(GBRAIN_DB_PATH) ? "yes" : "no"}`,
    `- OPENROUTER_API_KEY present: ${process.env.OPENROUTER_API_KEY ? "yes" : "no"}`,
    `- FIREWORKS_API_KEY present: ${process.env.FIREWORKS_API_KEY ? "yes" : "no"}`,
    `- OPENAI_API_KEY present: ${process.env.OPENAI_API_KEY ? "yes" : "no"}`,
  ].join("\n");

  return [
    "## Local Status",
    statusLines,
    "",
    "## package.json excerpt",
    packageJson,
    "",
    "## lab/README.md excerpt",
    labReadme,
    "",
    "## lab/agents/README.md excerpt",
    agentsReadme,
    "",
    "## lab/research files",
    labResearchFiles.join("\n") || "- none",
    "",
    "## lab/knowledge files",
    labKnowledgeFiles.join("\n") || "- none",
    ...(extraSections ? ["", extraSections] : []),
  ].join("\n");
}

function safeRead(path: string, maxChars: number): string {
  if (!existsSync(path)) return "[missing]";
  const raw = readFileSync(path, "utf-8");
  return raw.length <= maxChars ? raw : `${raw.slice(0, maxChars)}\n...[truncated]`;
}

function listMarkdownNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".md"))
      .sort()
      .map((name) => `- ${name}`);
  } catch {
    return [];
  }
}
