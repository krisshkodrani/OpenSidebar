import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

export type ReviewArgs = {
  mode: "staged" | "last" | "working";
  allowRemote: boolean;
  allowLarge: boolean;
  base?: string;
  model: string;
  outputDir: string;
  objective?: string;
  evidencePaths: string[];
};

const DEFAULT_MODEL = "deepseek-v4-pro";
const API_URL = "https://api.deepseek.com/chat/completions";
const MAX_DIFF_CHARS = 200_000;
const REQUEST_TIMEOUT_MS = 120_000;

export function parseArgs(argv: string[]): ReviewArgs {
  const args: ReviewArgs = {
    mode: "staged",
    allowRemote: false,
    allowLarge: false,
    model: DEFAULT_MODEL,
    outputDir: ".artifacts/reviews",
    evidencePaths: [],
  };

  let i = 0;
  const readValue = (name: string): string => {
    i += 1;
    const value = argv[i];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    return value;
  };

  for (; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--staged") {
      args.mode = "staged";
    } else if (arg === "--last") {
      args.mode = "last";
    } else if (arg === "--working") {
      args.mode = "working";
    } else if (arg === "--allow-remote") {
      args.allowRemote = true;
    } else if (arg === "--allow-large") {
      args.allowLarge = true;
    } else if (arg === "--base") {
      args.mode = "working";
      args.base = readValue("--base");
    } else if (arg === "--model") {
      args.model = readValue("--model");
    } else if (arg === "--output-dir") {
      args.outputDir = readValue("--output-dir");
    } else if (arg === "--objective") {
      args.objective = readValue("--objective");
    } else if (arg === "--evidence") {
      args.evidencePaths.push(readValue("--evidence"));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function readDotEnvKey(name: string): string {
  const envPath = ".env";
  if (!existsSync(envPath)) return "";
  const lines = readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || match[1] !== name) continue;
    return match[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return "";
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf-8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function getDiff(args: ReviewArgs): string {
  if (args.mode === "last") {
    return git(["show", "--format=fuller", "--stat", "--patch", "HEAD"]);
  }
  if (args.mode === "working" && args.base) {
    return git(["diff", args.base, "--"]);
  }
  if (args.mode === "working") {
    return git(["diff", "--"]);
  }
  return git(["diff", "--staged", "--"]);
}

function getDiffFileList(args: ReviewArgs): string[] {
  const output =
    args.mode === "last"
      ? git(["show", "--format=", "--name-only", "HEAD"])
      : args.mode === "working" && args.base
        ? git(["diff", "--name-only", args.base, "--"])
        : args.mode === "working"
          ? git(["diff", "--name-only", "--"])
          : git(["diff", "--staged", "--name-only", "--"]);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function diffFence(diff: string): { open: string; close: string } {
  const longestBacktickRun = (diff.match(/`+/g) ?? []).reduce(
    (max, run) => Math.max(max, run.length),
    0,
  );
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  return { open: `${fence}diff`, close: fence };
}

function readEvidenceFiles(paths: string[]): Array<{ path: string; content: string }> {
  return paths.map((path) => ({
    path,
    content: readFileSync(path, "utf-8"),
  }));
}

export function buildPrompt(
  diff: string,
  context: {
    objective?: string;
    evidence?: Array<{ path: string; content: string }>;
  } = {},
): string {
  const evidenceText = context.evidence
    ?.map((entry) => `${entry.path}\n${entry.content}`)
    .join("\n");
  const fence = diffFence([diff, context.objective, evidenceText].join("\n"));
  const textFenceOpen = fence.open.replace(/diff$/, "");
  const goalContext = context.objective
    ? [
        "Goal context:",
        context.objective,
        "",
      ]
    : [];
  const evidence = context.evidence?.length
    ? [
        "Verification evidence:",
        ...context.evidence.flatMap((entry) => [
          `Evidence file: ${entry.path}`,
          textFenceOpen,
          entry.content.trim(),
          fence.close,
        ]),
        "",
      ]
    : [];
  return [
    "Review this private repository diff as an adversarial senior engineer.",
    "",
    ...goalContext,
    ...evidence,
    "Focus on:",
    "- correctness bugs",
    "- async/race conditions",
    "- TypeScript type issues",
    "- browser automation brittleness",
    "- selector fragility",
    "- SPA re-render timing problems",
    "- missing act-check-act verification",
    "- security/session/auth mistakes",
    "- unnecessary complexity",
    "",
    "Return findings first, ordered by severity. For each finding include:",
    "- severity",
    "- file/function reference from the diff",
    "- concrete failure mode",
    "- suggested fix",
    "",
    "If there are no blocking findings, say that clearly and list residual risk.",
    "",
    "Diff:",
    fence.open,
    diff,
    fence.close,
  ].join("\n");
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.allowRemote) {
    throw new Error(
      "Refusing to send a repository diff to DeepSeek without --allow-remote",
    );
  }
  const apiKey = process.env.DEEPSEEK_API_KEY || readDotEnvKey("DEEPSEEK_API_KEY");
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not set in the environment or .env");
  }

  const diff = getDiff(args).trim();
  if (!diff) {
    throw new Error(`No diff found for mode: ${args.mode}`);
  }
  const diffLines = diff.split(/\r?\n/).length;
  if (diff.length > MAX_DIFF_CHARS && !args.allowLarge) {
    throw new Error(
      `Diff is ${diff.length} characters (${diffLines} lines). ` +
        "Refusing to send without --allow-large.",
    );
  }
  const files = getDiffFileList(args);
  const evidence = readEvidenceFiles(args.evidencePaths);
  console.warn(
    "Sending repository diff to DeepSeek. Confirmed by --allow-remote.",
  );
  console.warn(`Diff size: ${diff.length} characters, ${diffLines} lines.`);
  if (files.length > 0) {
    console.warn(`Files included:\n${files.map((file) => `- ${file}`).join("\n")}`);
  }
  if (args.objective) {
    console.warn("Goal objective included in review prompt.");
  }
  if (evidence.length > 0) {
    console.warn(
      `Evidence included:\n${evidence.map((entry) => `- ${entry.path}`).join("\n")}`,
    );
  }

  const body = {
    model: args.model,
    messages: [
      {
        role: "system",
        content:
          "You are a strict code reviewer. Be concise, concrete, and skeptical.",
      },
      {
        role: "user",
        content: buildPrompt(diff, {
          objective: args.objective,
          evidence,
        }),
      },
    ],
    thinking: { type: "enabled" },
    reasoning_effort: "high",
    stream: false,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`DeepSeek request failed (${response.status}): ${text}`);
  }

  const json = JSON.parse(text);
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`DeepSeek returned no review content: ${text}`);
  }

  mkdirSync(args.outputDir, { recursive: true });
  const outputPath = join(args.outputDir, `deepseek-review-${timestamp()}.md`);
  const usage = json?.usage ? `\n\n## Usage\n\n\`\`\`json\n${JSON.stringify(json.usage, null, 2)}\n\`\`\`\n` : "";
  writeFileSync(
    outputPath,
    `# DeepSeek Review\n\nModel: \`${args.model}\`\nMode: \`${args.mode}\`\n\n${content.trim()}${usage}`,
    "utf-8",
  );

  console.log(outputPath);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/deepseek-review.ts")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
