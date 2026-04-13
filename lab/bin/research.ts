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

applyLabEnvironment();

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: npm run lab:research -- "your research question"');
  console.error('   or: npm run lab:research -- --save my-note "your research question"');
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

const prompt = [
  "You are the OpenSidebar lab research assistant.",
  "Answer only from the provided local context bundle.",
  "Do not use tools. Do not browse. Do not try to edit files.",
  "Keep conclusions concrete and tied to harness design, workflow skills, E2E behavior, or agent architecture.",
  saveInstruction,
  `Research task: ${query}`,
  "",
  contextBundle,
].join("\n");

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
      OPENROUTER_API_KEY: researchProfile.allowOpenRouterFallback ? process.env.OPENROUTER_API_KEY ?? "" : "",
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
const normalizedNote = normalizeNoteText(noteContent);
process.stdout.write(`${normalizedNote}\n`);

if (!saveTarget) {
  process.exit(0);
}

const researchDir = resolve(LAB_DIR, "research");
mkdirSync(researchDir, { recursive: true });
const fileName = normalizeNoteName(saveTarget);
const notePath = resolve(researchDir, fileName);
const finalNote = buildSavedNote(normalizedNote, query);
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

function normalizeNoteName(input: string): string {
  const trimmed = input.trim();
  const withExt = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
  return withExt.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-");
}

function extractNoteContent(output: string): string {
  const cleaned = output
    .replace(/^session_id:\s*[^\n]+\s*$/im, "")
    .replace(/\n+session_id:\s*[^\n]+$/i, "")
    .trim();
  return isMeaningfulNote(cleaned) ? cleaned : "";
}

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
    const session = JSON.parse(raw) as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const messages = Array.isArray(session.messages) ? session.messages : [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message?.role === "assistant" && typeof message.content === "string") {
        const content = message.content.trim();
        return isMeaningfulNote(content) ? content : "";
      }
    }
  } catch {
    return "";
  }

  return "";
}

function buildSavedNote(content: string, queryText: string): string {
  const trimmed = content.replace(/\n---\s*$/m, "").trimEnd();
  const body = trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
  return `${body}\n---\nGenerated by \`npm run lab:research\` on ${new Date().toISOString()}.\nQuery: ${queryText}\n`;
}

function normalizeNoteText(content: string): string {
  return content
    .replaceAll("Ã¢â€ â€™", "->")
    .replaceAll("Ã¢â‚¬â€", "--")
    .replaceAll("Ã¢â‚¬â€œ", "-")
    .replaceAll("Ã¢â‚¬Â¢", "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/ \n/g, "\n");
}

function isMeaningfulNote(content: string): boolean {
  if (!content) return false;
  if (/^session_id:\s*\S+$/i.test(content)) return false;
  if (/^API call failed after \d+ retries/i.test(content)) return false;
  return /[A-Za-z]/.test(content);
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

  const config = hasFireworks
    ? [
        "model:",
        '  provider: custom',
        '  default: accounts/fireworks/routers/kimi-k2p5-turbo',
        '  base_url: https://api.fireworks.ai/inference/v1',
        '  api_key: ${FIREWORKS_API_KEY}',
        '  api_mode: chat_completions',
        "  max_tokens: 1024",
      ].join("\n")
    : hasOpenAi
    ? [
        "model:",
        '  provider: custom',
        '  default: accounts/fireworks/routers/kimi-k2p5-turbo',
        '  base_url: https://api.fireworks.ai/inference/v1',
        '  api_key: ${FIREWORKS_API_KEY}',
        '  api_mode: chat_completions',
        "  max_tokens: 1024",
      ].join("\n")
    : [
        "model:",
        '  provider: openrouter',
        '  default: google/gemini-2.5-flash',
        "  max_tokens: 1024",
      ].join("\n");

  writeFileSync(resolve(HERMES_HOME, "config.yaml"), `${config}\n`, "utf-8");
  return { allowOpenRouterFallback: !hasFireworks && !hasOpenAi && hasOpenRouter };
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
      return [
        `## Attached context: ${filePath}`,
        safeRead(resolvedPath, 12000),
      ].join("\n");
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
