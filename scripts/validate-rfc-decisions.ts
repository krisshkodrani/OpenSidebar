import { existsSync, readFileSync, readdirSync } from "fs";
import { join, relative, resolve } from "path";
import { validateRfcDecisionMarkdown } from "./rfc-decision";

interface Baseline {
  reason: string;
  files: string[];
}

const repoRoot = process.cwd();
const rfcRoot = join(repoRoot, "docs", "rfcs");
const baselinePath = join(repoRoot, "scripts", "rfc-decision-baseline.json");

function formatPath(path: string): string {
  return relative(repoRoot, path).replace(/\\/g, "/");
}

function readBaseline(): Baseline {
  const parsed = JSON.parse(
    readFileSync(baselinePath, "utf8"),
  ) as Partial<Baseline>;
  if (
    typeof parsed.reason !== "string" ||
    !Array.isArray(parsed.files) ||
    !parsed.files.every((file) => typeof file === "string")
  ) {
    throw new Error(
      `${formatPath(baselinePath)} must define a reason and string-array files`,
    );
  }
  return parsed as Baseline;
}

function validateFile(path: string): string[] {
  if (!existsSync(path)) {
    return [`${formatPath(path)} does not exist`];
  }
  if (!path.toLowerCase().endsWith(".md")) {
    return [`${formatPath(path)} must be a Markdown file`];
  }

  return validateRfcDecisionMarkdown(readFileSync(path, "utf8")).errors.map(
    (error) => `${formatPath(path)}: ${error}`,
  );
}

function defaultFiles(): {
  files: string[];
  baselineCount: number;
  baselineErrors: string[];
} {
  const baseline = readBaseline();
  const baselineFiles = new Set(
    baseline.files.map((file) => file.replace(/\\/g, "/")),
  );
  const baselineErrors: string[] = [];

  for (const file of baselineFiles) {
    const path = resolve(repoRoot, file);
    if (!existsSync(path)) {
      baselineErrors.push(
        `${file} is listed in the RFC decision baseline but does not exist`,
      );
      continue;
    }
    const validation = validateRfcDecisionMarkdown(readFileSync(path, "utf8"));
    if (validation.errors.length === 0) {
      baselineErrors.push(
        `${file} now has a valid Decision Stamp; remove it from the baseline`,
      );
    }
  }

  const files = readdirSync(rfcRoot)
    .filter(
      (file) =>
        file.toLowerCase().endsWith(".md") &&
        file.toLowerCase() !== "readme.md",
    )
    .map((file) => join(rfcRoot, file))
    .filter((path) => !baselineFiles.has(formatPath(path)))
    .sort();

  return {
    files,
    baselineCount: baselineFiles.size,
    baselineErrors,
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "Usage: pnpm rfcs:check [-- <rfc.md> ...]\n" +
        "Without paths, validates non-baselined Markdown files in docs/rfcs.",
    );
    return;
  }

  let files: string[];
  let baselineCount = 0;
  const errors: string[] = [];

  if (args.length > 0) {
    files = args.map((path) => resolve(repoRoot, path));
  } else {
    const defaults = defaultFiles();
    files = defaults.files;
    baselineCount = defaults.baselineCount;
    errors.push(...defaults.baselineErrors);
  }

  for (const file of files) {
    errors.push(...validateFile(file));
  }

  if (errors.length > 0) {
    console.error("[rfcs:check] Found RFC decision issues:");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  const legacySummary =
    baselineCount > 0 ? `; ${baselineCount} legacy RFCs baselined` : "";
  console.log(
    `[rfcs:check] Validated ${files.length} RFC decision stamp(s)${legacySummary}.`,
  );
}

main();
