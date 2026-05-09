import { describe, expect, test } from "vitest";
import {
  buildPrompt,
  parseArgs,
} from "../../../../scripts/deepseek-review";

describe("deepseek-review script helpers", () => {
  test("parses goal objective and repeated evidence paths", () => {
    expect(
      parseArgs([
        "--working",
        "--allow-remote",
        "--objective",
        "Complete the active /goal objective",
        "--evidence",
        ".artifacts/e2e/report.md",
        "--evidence",
        ".artifacts/e2e/summary.json",
      ]),
    ).toMatchObject({
      mode: "working",
      allowRemote: true,
      objective: "Complete the active /goal objective",
      evidencePaths: [
        ".artifacts/e2e/report.md",
        ".artifacts/e2e/summary.json",
      ],
    });
  });

  test("includes goal context and verification evidence in prompt", () => {
    const prompt = buildPrompt("diff --git a/file.ts b/file.ts", {
      objective: "Complete the active /goal objective",
      evidence: [
        {
          path: ".artifacts/e2e/report.md",
          content: "Overall result: passed",
        },
      ],
    });

    expect(prompt).toContain("Goal context:");
    expect(prompt).toContain("Complete the active /goal objective");
    expect(prompt).toContain("Verification evidence:");
    expect(prompt).toContain("Evidence file: .artifacts/e2e/report.md");
    expect(prompt).toContain("Overall result: passed");
    expect(prompt).toContain("diff --git a/file.ts b/file.ts");
  });
});
