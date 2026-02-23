import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SCAN_DIRS = [join(ROOT, "src"), join(ROOT, "evals")];
const EXCLUDE_SUFFIXES = [join("src", "prompts", "generated.ts")];
const MARKERS = [
  "You are ",
  "Execution policy:",
  "Respond with JSON",
  "Call done(",
  "browser automation",
  "Current Task",
];
const MIN_LEN = 280;

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (ext === ".ts" || ext === ".tsx") out.push(full);
      }
    }
  }
  return out;
}

function isExcluded(path: string): boolean {
  const rel = relative(ROOT, path).replace(/\\/g, "/");
  return EXCLUDE_SUFFIXES.some((suffix) =>
    rel.endsWith(suffix.replace(/\\/g, "/")),
  );
}

function getTemplateLiterals(text: string): string[] {
  const matches: string[] = [];
  const re = /`([\s\S]*?)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    matches.push(m[1]);
  }
  return matches;
}

function looksLikePrompt(candidate: string): boolean {
  if (candidate.length < MIN_LEN) return false;
  return MARKERS.some((marker) => candidate.includes(marker));
}

function main(): void {
  const violations: Array<{ file: string; snippet: string }> = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walkFiles(dir)) {
      if (isExcluded(file)) continue;
      const text = readFileSync(file, "utf-8");
      const literals = getTemplateLiterals(text);
      for (const lit of literals) {
        if (looksLikePrompt(lit)) {
          violations.push({
            file: relative(ROOT, file).replace(/\\/g, "/"),
            snippet: lit.slice(0, 160).replace(/\s+/g, " "),
          });
          break;
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      "[prompts:check] Found large inline prompt-like template literals:",
    );
    for (const v of violations) {
      console.error(`- ${v.file}: ${v.snippet}...`);
    }
    console.error(
      "Move prompt text into root prompts/ templates and reference via src/prompts.",
    );
    process.exit(1);
  }

  console.log("[prompts:check] No large inline prompt-like literals found.");
}

main();
