import { describe, expect, test } from "vitest";

import {
  extractJson,
  isReviewablePath,
  isWellFormedReview,
  parseFindings,
  parseVerdict,
  renderComment,
  selectForReview,
  splitDiff,
  sortFindings,
  type Finding,
} from "../../../../scripts/ai-review/review";

const fileDiff = (path: string, body = "+const a = 1;\n") =>
  `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n${body}`;

describe("splitDiff", () => {
  test("splits a multi-file diff and takes the post-change path", () => {
    const files = splitDiff(fileDiff("src/a.ts") + fileDiff("src/b.ts"));
    expect(files.map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(files[0].patch).toContain("diff --git a/src/a.ts");
  });

  test("survives renames, binary stubs and empty input", () => {
    const rename =
      "diff --git a/old.ts b/new.ts\nsimilarity index 92%\nrename from old.ts\nrename to new.ts\n";
    const binary =
      "diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n";
    expect(splitDiff(rename + binary).map((f) => f.path)).toEqual([
      "new.ts",
      "logo.png",
    ]);
    expect(splitDiff("")).toEqual([]);
  });
});

describe("isReviewablePath", () => {
  test("skips generated, vendored, lock and binary files", () => {
    // generated.ts is built by `pnpm run prompts:build` — a finding on it is
    // unactionable, the author is forbidden from editing it directly.
    expect(isReviewablePath("apps/extension/src/prompts/generated.ts")).toBe(false);
    expect(isReviewablePath("pnpm-lock.yaml")).toBe(false);
    expect(isReviewablePath("dist/background.js")).toBe(false);
    expect(isReviewablePath("apps/extension/tests/e2e/bench/mind2web/tasks.json")).toBe(
      false,
    );
    expect(isReviewablePath("public/icons/icon-128.png")).toBe(false);
  });

  test("reviews ordinary source and test files", () => {
    expect(isReviewablePath("apps/extension/src/background/agent/loop.ts")).toBe(true);
    expect(isReviewablePath("scripts/jobagent/discovery.ts")).toBe(true);
  });
});

describe("selectForReview", () => {
  test("reports what it skipped instead of dropping it silently", () => {
    const files = splitDiff(fileDiff("src/a.ts") + fileDiff("pnpm-lock.yaml"));
    const { selected, skipped } = selectForReview(files);
    expect(selected.map((f) => f.path)).toEqual(["src/a.ts"]);
    expect(skipped).toEqual(["pnpm-lock.yaml"]);
  });

  test("over-budget files are named as unreviewed, not silently cut", () => {
    const big = fileDiff("src/huge.ts", "+x\n".repeat(500));
    const small = fileDiff("src/small.ts");
    const { selected, truncated } = selectForReview(splitDiff(big + small), 200);
    expect(selected.map((f) => f.path)).toEqual(["src/small.ts"]);
    expect(truncated).toEqual(["src/huge.ts"]);
  });
});

describe("extractJson", () => {
  test("parses bare, fenced and prose-wrapped JSON", () => {
    expect(extractJson('{"findings":[]}')).toEqual({ findings: [] });
    expect(extractJson('```json\n{"findings":[]}\n```')).toEqual({ findings: [] });
    expect(extractJson('Sure! Here you go:\n{"findings":[]}\nHope that helps.')).toEqual(
      { findings: [] },
    );
  });

  test("returns null rather than throwing on junk", () => {
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson("{ definitely not json")).toBeNull();
  });
});

describe("parseFindings", () => {
  test("keeps well-formed findings and defaults severity", () => {
    const findings = parseFindings({
      findings: [{ file: "a.ts", title: "boom", detail: "d", severity: "high" }, { file: "b.ts", title: "t" }],
    });
    expect(findings).toHaveLength(2);
    expect(findings[0].severity).toBe("high");
    expect(findings[1].severity).toBe("medium");
  });

  test("drops entries missing a file or title, and survives junk", () => {
    expect(parseFindings({ findings: [{ title: "no file" }, { file: "a.ts" }] })).toEqual(
      [],
    );
    expect(parseFindings(null)).toEqual([]);
    expect(parseFindings({ findings: "not an array" })).toEqual([]);
  });
});

describe("isWellFormedReview", () => {
  test("accepts an answered review, including an honest empty one", () => {
    expect(isWellFormedReview({ findings: [] })).toBe(true);
    expect(isWellFormedReview({ findings: [{ file: "a.ts", title: "t" }] })).toBe(true);
  });

  test("rejects prose deliberation that never answers", () => {
    // The real first-run failure: glm-5p2 reasoned in prose for 15K chars on a
    // 31K-char diff, hit max_tokens mid-sentence, and never emitted the object.
    // extractJson returns null, parseFindings returns [], and the tool posted
    // "No defects survived adjudication" — an all-clear it never earned.
    const prose =
      "But wait - what about a path like `C:subdir/cv.pdf`? This starts with " +
      "`C:`, caught by the second check. Good. I think the function is correct";
    expect(isWellFormedReview(extractJson(prose))).toBe(false);
    expect(parseFindings(extractJson(prose))).toEqual([]);
  });

  test("rejects JSON that is not a findings object", () => {
    expect(isWellFormedReview(null)).toBe(false);
    expect(isWellFormedReview({})).toBe(false);
    expect(isWellFormedReview({ findings: "nope" })).toBe(false);
    expect(isWellFormedReview({ result: [] })).toBe(false);
  });
});

describe("parseVerdict", () => {
  test("an unparseable judge response REJECTS", () => {
    // Failing open here would let every malformed verdict through, defeating
    // the entire point of the judge pass.
    expect(parseVerdict(null).keep).toBe(false);
    expect(parseVerdict({}).keep).toBe(false);
    expect(parseVerdict({ keep: "yes" }).keep).toBe(false);
  });

  test("honours an explicit boolean", () => {
    expect(parseVerdict({ keep: true, reason: "line exists" })).toEqual({
      keep: true,
      reason: "line exists",
    });
    expect(parseVerdict({ keep: false, reason: "style only" }).keep).toBe(false);
  });
});

describe("renderComment", () => {
  const finding = (over: Partial<Finding> = {}): Finding => ({
    file: "src/a.ts",
    line: 12,
    severity: "high",
    title: "off-by-one",
    detail: "loop runs one extra time",
    failureScenario: "n=0 -> reads index -1",
    ...over,
  });

  test("renders findings severity-first with location and failure", () => {
    const body = renderComment({
      findings: [finding({ severity: "low", title: "minor" }), finding()],
      reviewerModel: "glm",
      judgeModel: "oss",
      rejectedCount: 3,
      skipped: [],
      truncated: [],
    });
    expect(body.indexOf("off-by-one")).toBeLessThan(body.indexOf("minor"));
    expect(body).toContain("`src/a.ts:12`");
    expect(body).toContain("**Failure:** n=0 -> reads index -1");
    expect(body).toContain("3 finding(s) rejected as unproven");
  });

  test("a clean review says so", () => {
    const body = renderComment({
      findings: [],
      reviewerModel: "glm",
      judgeModel: "oss",
      rejectedCount: 0,
      skipped: [],
      truncated: [],
    });
    expect(body).toContain("No defects survived adjudication");
  });

  test("unreviewed files are stated plainly, never implied clean", () => {
    const body = renderComment({
      findings: [],
      reviewerModel: "glm",
      judgeModel: "oss",
      rejectedCount: 0,
      skipped: ["pnpm-lock.yaml"],
      truncated: ["src/huge.ts"],
    });
    expect(body).toContain("Not reviewed — diff too large:** src/huge.ts");
    expect(body).toContain("These files were NOT looked at");
    expect(body).toContain("pnpm-lock.yaml");
  });
});

describe("sortFindings", () => {
  test("high before medium before low", () => {
    const mk = (severity: Finding["severity"]): Finding => ({
      file: "a.ts",
      severity,
      title: severity,
      detail: "",
    });
    expect(sortFindings([mk("low"), mk("high"), mk("medium")]).map((f) => f.severity)).toEqual([
      "high",
      "medium",
      "low",
    ]);
  });
});
