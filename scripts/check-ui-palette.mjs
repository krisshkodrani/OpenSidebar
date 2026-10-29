#!/usr/bin/env node
/**
 * Keeps the side panel and shared UI on the semantic design tokens
 * (packages/ui-tokens). It fails on:
 *   - raw or legacy Tailwind palette colors (`text-slate-500`, `bg-warm-100`)
 *   - `dark:` color variants (the tokens switch with `.dark` already)
 *   - arbitrary hex colors (`bg-[#123456]`)
 *   - arbitrary text sizes below 12px (`text-[11px]`)
 *   - faded text colors (`text-fg/60`)
 *
 * Usage: node scripts/check-ui-palette.mjs [--report]
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const DIRS = ["apps/extension/src/sidepanel", "apps/extension/src/ui"];
const PALETTES =
  "warm|primary|brand|state|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const UTILS =
  "bg|text|border|border-[trblxy]|ring|ring-offset|from|via|to|fill|stroke|divide|outline|placeholder|decoration|caret|accent|shadow";

const RULES = [
  {
    reason: "raw palette color; use a semantic token (fg, surface, line, accent, success, warning, danger)",
    pattern: new RegExp(`(?<![\\w-])(?:[\\w-]+:)*(?:${UTILS})-(?:(?:${PALETTES})-\\d{2,3}|white|black)(?:/\\d+)?(?![\\w-])`, "g"),
  },
  {
    reason: "`dark:` color variant; the tokens already switch with the theme",
    pattern: new RegExp(`(?<![\\w-])dark:(?:[\\w-]+:)*(?:${UTILS})-[\\w/-]+`, "g"),
  },
  {
    reason: "arbitrary hex color; add a token instead",
    pattern: /(?<![\w-])(?:[\w-]+:)*[\w-]+-\[#[0-9a-fA-F]{3,8}\]/g,
  },
  {
    reason: "text smaller than 12px",
    pattern: /(?<![\w-])text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/g,
  },
  {
    reason: "faded text color; use fg-secondary or fg-tertiary",
    pattern: /(?<![\w-])(?:[\w-]+:)*text-(?:fg|fg-secondary|fg-tertiary|accent-text)\/\d+/g,
  },
];

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(tsx?|css)$/.test(name)) yield path;
  }
}

const violations = [];
for (const dir of DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      for (const { reason, pattern } of RULES) {
        for (const match of line.matchAll(pattern)) {
          violations.push({ file: relative(ROOT, file), line: index + 1, match: match[0], reason });
        }
      }
    });
  }
}

if (process.argv.includes("--report")) {
  const byFile = new Map();
  for (const v of violations) byFile.set(v.file, (byFile.get(v.file) ?? 0) + 1);
  for (const [file, count] of [...byFile].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(count).padStart(5)}  ${file}`);
  }
  console.log(`${violations.length} violation(s) in ${byFile.size} file(s).`);
} else if (violations.length > 0) {
  for (const v of violations) console.error(`${v.file}:${v.line}  ${v.match}  — ${v.reason}`);
  console.error(`[ui-palette] ${violations.length} violation(s).`);
  process.exitCode = 1;
} else {
  console.log("[ui-palette] Side panel and shared UI use semantic tokens only.");
}
