import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { dirname, extname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const EXTENSION_ROOT = resolve(TEST_DIR, "../..");
const SRC_ROOT = resolve(EXTENSION_ROOT, "src");
const RUNTIME_ROOTS = [
  resolve(SRC_ROOT, "background"),
  resolve(SRC_ROOT, "content"),
  resolve(SRC_ROOT, "overlay"),
  resolve(SRC_ROOT, "sidepanel"),
];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const FORBIDDEN_BENCHMARK_PATTERNS = [
  /\bworkarena\b/i,
  /\bworkarena(public)?\d*\b/i,
  /ServiceNow\/WorkArena-Instances/i,
];

function collectSourceFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const fullPath = join(root, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }
    if (SOURCE_EXTENSIONS.has(extname(fullPath))) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("runtime genericity guardrails", () => {
  it("keeps benchmark-specific WorkArena terms out of product runtime code", () => {
    const offenders: string[] = [];
    for (const filePath of RUNTIME_ROOTS.flatMap(collectSourceFiles)) {
      const content = readFileSync(filePath, "utf-8");
      for (const pattern of FORBIDDEN_BENCHMARK_PATTERNS) {
        if (pattern.test(content)) {
          offenders.push(relative(EXTENSION_ROOT, filePath));
          break;
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
