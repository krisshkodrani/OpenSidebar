/**
 * Skill lint (RFC LP-22 §1) — keeps agent-platform skill files THIN.
 *
 * The whole "one spec, three platforms" design rests on wrappers being
 * adapters: they choose a web-search primitive and a way to ask a human, and
 * they defer everything else to `skills/jobagent/SKILL.md` and the daemon. The
 * failure mode is quiet — a wrapper starts explaining what a status means or
 * which transition is legal, the explanation drifts from `recordStatus`, and
 * nothing catches it because the prose still reads plausibly.
 *
 * So this lint enforces two mechanical properties:
 *
 *   1. A skill must not RESTATE lifecycle rules. Naming a status is fine when
 *      reporting one (`filled-awaiting-submit` in an inline code span); writing
 *      it into prose, or drawing a transition arrow between two statuses, is
 *      not — that is a second copy of the ratchet.
 *   2. A platform wrapper must POINT AT the shared spec, so there is exactly
 *      one place the verb table and gate protocol live.
 *
 * Deliberately narrow: it only fires on JobAgent vocabulary, so unrelated
 * skills in `.claude/skills/` are unaffected. It is a drift guard, not a style
 * checker.
 *
 * Usage: `node scripts/skill-lint.mjs` (runs in the lint step). Exit 1 on any
 * violation, with file:line and the reason.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();

/** Directories whose *.md files are treated as skill files. */
const SKILL_DIRS = ["skills", join(".claude", "skills")];

/** The canonical spec every wrapper must defer to. */
const SHARED_SPEC = "skills/jobagent/SKILL.md";

/**
 * Lifecycle statuses distinctive enough to match safely. "ready", "applied",
 * and "archived" are deliberately omitted — they are ordinary English and
 * would fire on innocent prose, which would train people to ignore this lint.
 */
const STATUS_TOKENS = [
  "filled-awaiting-submit",
  "submitted-by-user",
  "duplicate-risk",
];

const STATUS_RE = new RegExp(`(${STATUS_TOKENS.join("|")})`, "g");
/** A transition arrow between two lifecycle-ish words: restating the ratchet. */
const TRANSITION_RE =
  /\b(reviewing|ready|filled-awaiting-submit|submitted-by-user|applied|archived)\s*(?:→|->)\s*(reviewing|ready|filled-awaiting-submit|submitted-by-user|applied|archived)\b/g;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (entry.toLowerCase().endsWith(".md")) out.push(path);
  }
  return out;
}

/**
 * Blank out fenced code blocks, keeping line numbering intact. Quoting real
 * CLI output is exactly what a skill SHOULD do, so fenced content is exempt.
 */
function maskFences(text) {
  let inFence = false;
  return text.split("\n").map((line) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return "";
    }
    return inFence ? "" : line;
  });
}

/** Spans covered by inline code — a bare status name here is a reference. */
function inlineCodeRanges(line) {
  const ranges = [];
  const re = /`[^`]*`/g;
  let m;
  while ((m = re.exec(line)) !== null) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

const violations = [];
const files = SKILL_DIRS.flatMap((dir) => walk(join(ROOT, dir)));

for (const file of files) {
  const rel = relative(ROOT, file).split(sep).join("/");
  const raw = readFileSync(file, "utf8");
  const lines = maskFences(raw);
  const isSharedSpec = rel === SHARED_SPEC;
  let mentionsJobagent = false;

  lines.forEach((line, i) => {
    if (/jobagent/i.test(line)) mentionsJobagent = true;

    // (1a) A status token in prose, outside any inline code span.
    const codeRanges = inlineCodeRanges(line);
    let m;
    STATUS_RE.lastIndex = 0;
    while ((m = STATUS_RE.exec(line)) !== null) {
      const inCode = codeRanges.some(([s, e]) => m.index >= s && m.index < e);
      if (!inCode) {
        violations.push(
          `${rel}:${i + 1}: lifecycle status "${m[1]}" in prose — report what ` +
            `the daemon says instead of restating it, or wrap it in \`backticks\` ` +
            `as a bare reference`,
        );
      }
    }

    // (1b) A transition arrow is a second copy of the ratchet, code span or not.
    TRANSITION_RE.lastIndex = 0;
    while ((m = TRANSITION_RE.exec(line)) !== null) {
      violations.push(
        `${rel}:${i + 1}: status transition "${m[1]} → ${m[2]}" — the legal ` +
          `ordering lives in recordStatus, not in a skill`,
      );
    }
  });

  // (2) A JobAgent wrapper must defer to the one shared spec.
  if (mentionsJobagent && !isSharedSpec && !raw.includes(SHARED_SPEC)) {
    violations.push(
      `${rel}: mentions JobAgent but never points at ${SHARED_SPEC} — a wrapper ` +
        `must defer to the shared spec rather than carry its own copy`,
    );
  }
}

if (violations.length > 0) {
  console.error(`[skill-lint] ${violations.length} violation(s):\n`);
  for (const v of violations) console.error(`  ${v}`);
  console.error(
    `\nSkills are adapters: name the verb, judge the output, defer the rules.\n` +
      `See RFC LP-22 §1.`,
  );
  process.exit(1);
}

console.log(`[skill-lint] ${files.length} skill file(s) clean.`);
