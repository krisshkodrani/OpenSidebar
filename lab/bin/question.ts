import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { applyLabEnvironment, LAB_DIR } from "./common.js";

applyLabEnvironment();

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: npm run lab:question -- "research question"');
  console.error('   or: npm run lab:question -- --type pathology --tags skills,traces "research question"');
  process.exit(1);
}

let type = "question";
let tags = "";
let source = "development";

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--type") {
    type = (args[i + 1] || type).trim() || type;
    args.splice(i, 2);
    i -= 1;
    continue;
  }
  if (arg === "--tags") {
    tags = (args[i + 1] || "").trim();
    args.splice(i, 2);
    i -= 1;
    continue;
  }
  if (arg === "--source") {
    source = (args[i + 1] || source).trim() || source;
    args.splice(i, 2);
    i -= 1;
  }
}

const title = args.join(" ").trim();
if (!title) {
  console.error("Question title is empty.");
  process.exit(1);
}

const questionsDir = resolve(LAB_DIR, "questions");
const openDir = resolve(questionsDir, "open");
mkdirSync(openDir, { recursive: true });

const today = new Date().toISOString().slice(0, 10);
const slug = slugify(title);
const fileName = `${today}-${slug}.md`;
const questionPath = resolve(openDir, fileName);

if (existsSync(questionPath)) {
  console.error(`Question file already exists: ${questionPath}`);
  process.exit(1);
}

const normalizedTags = tags
  .split(",")
  .map((tag) => tag.trim())
  .filter(Boolean);

writeFileSync(
  questionPath,
  buildQuestionTemplate({
    title,
    type,
    source,
    tags: normalizedTags,
    createdAt: new Date().toISOString(),
  }),
  "utf-8",
);

upsertQueueEntry(resolve(questionsDir, "QUEUE.md"), {
  title,
  relativePath: `open/${fileName}`,
  type,
  tags: normalizedTags,
});

process.stdout.write(`Created lab question: ${questionPath}\n`);

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "question";
}

function buildQuestionTemplate(input: {
  title: string;
  type: string;
  source: string;
  tags: string[];
  createdAt: string;
}): string {
  const tagLine = input.tags.length ? input.tags.join(", ") : "none";
  return [
    `# ${input.title}`,
    "",
    `Status: Open`,
    `Type: ${input.type}`,
    `Source: ${input.source}`,
    `Created: ${input.createdAt}`,
    `Tags: ${tagLine}`,
    "",
    "## Why This Matters",
    "",
    "- What harness behavior or product risk does this question affect?",
    "",
    "## Trigger / Pathology",
    "",
    "- What trace pattern, E2E failure, or development surprise produced this question?",
    "",
    "## Evidence",
    "",
    "- Link traces, tests, reports, or code paths here.",
    "",
    "## Generalization Target",
    "",
    "- Is this site-specific, workflow-specific, or harness-wide?",
    "",
    "## Candidate Explanations",
    "",
    "- Hypothesis 1",
    "- Hypothesis 2",
    "",
    "## Proposed Investigation",
    "",
    "- What should Hermes or a human researcher read next?",
    "- What traces should be sampled?",
    "- What experiment or RFC would answer this?",
    "",
    "## Exit Criteria",
    "",
    "- What evidence would let us close, downgrade, or promote this question?",
    "",
  ].join("\n");
}

function upsertQueueEntry(
  queuePath: string,
  input: { title: string; relativePath: string; type: string; tags: string[] },
): void {
  if (!existsSync(queuePath)) return;
  const raw = readFileSync(queuePath, "utf-8");
  const tagSuffix = input.tags.length ? ` [${input.tags.join(", ")}]` : "";
  const entry = `- [${input.type}] [${input.title}](${input.relativePath})${tagSuffix}`;
  const marker = "## Open Questions";

  if (!raw.includes(marker)) return;
  const alreadyPresent = raw.includes(`](${input.relativePath})`);
  if (alreadyPresent) return;

  const updated = raw.replace(marker, `${marker}\n${entry}`);
  writeFileSync(queuePath, updated, "utf-8");
}
