/**
 * Skill lint (RFC LP-22 §1) — the drift guard's own tests.
 *
 * A lint that never fires is worse than no lint: it reads as coverage while
 * providing none. So these cases pin both directions — the violations it must
 * catch, and the legitimate uses it must NOT flag, since a noisy guard gets
 * ignored and then removed.
 *
 * The script scans `process.cwd()`, so each case runs it against a temp tree.
 */
import { afterEach, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../scripts/skill-lint.mjs",
);

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Build a temp repo whose skill files are `files`, then run the lint in it. */
function lint(files: Record<string, string>): { code: number; output: string } {
  const root = mkdtempSync(join(tmpdir(), "skill-lint-"));
  tmpDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  try {
    const output = execFileSync(process.execPath, [SCRIPT], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

/** A wrapper that defers properly, so only the case under test differs. */
const DEFERRING_HEADER =
  "# JobAgent (some platform)\n\nRead skills/jobagent/SKILL.md and follow it.\n\n";

describe("catches drift", () => {
  test("a lifecycle status written into prose", () => {
    const { code, output } = lint({
      ".claude/skills/jobagent/SKILL.md":
        DEFERRING_HEADER + "After the fill the package is filled-awaiting-submit.\n",
    });
    expect(code).toBe(1);
    expect(output).toContain("filled-awaiting-submit");
    expect(output).toContain("in prose");
  });

  test("a transition arrow, even inside a code span", () => {
    const { code, output } = lint({
      ".claude/skills/jobagent/SKILL.md":
        DEFERRING_HEADER + "The legal path is `ready → filled-awaiting-submit`.\n",
    });
    expect(code).toBe(1);
    expect(output).toContain("the legal ordering lives in recordStatus");
  });

  test("a wrapper that never points at the shared spec", () => {
    const { code, output } = lint({
      ".claude/skills/jobagent/SKILL.md":
        "# JobAgent\n\nRun `pnpm run jobagent queue` and report what it says.\n",
    });
    expect(code).toBe(1);
    expect(output).toContain("must defer to the shared spec");
  });
});

describe("stays quiet on legitimate use", () => {
  test("a status quoted inside fenced CLI output", () => {
    const { code } = lint({
      ".claude/skills/jobagent/SKILL.md":
        DEFERRING_HEADER +
        "Example output:\n\n```\nname   status\nacme   filled-awaiting-submit\n```\n",
    });
    expect(code).toBe(0);
  });

  test("a status named as a bare inline-code reference", () => {
    const { code } = lint({
      ".claude/skills/jobagent/SKILL.md":
        DEFERRING_HEADER +
        "A filled package sits at `filled-awaiting-submit` until you submit.\n",
    });
    expect(code).toBe(0);
  });

  test("the shared spec itself is not asked to point at itself", () => {
    const { code } = lint({
      "skills/jobagent/SKILL.md": "# JobAgent\n\nThe verb table lives here.\n",
    });
    expect(code).toBe(0);
  });

  test("unrelated skills are untouched", () => {
    const { code, output } = lint({
      ".claude/skills/deploy/SKILL.md":
        "# Deploy\n\nShip when the build is ready and the rollout is applied.\n",
    });
    // "ready" and "applied" are ordinary English — matching them would train
    // people to ignore this lint.
    expect(code).toBe(0);
    expect(output).toContain("clean");
  });
});
