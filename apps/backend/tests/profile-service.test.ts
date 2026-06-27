import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  parseProfileDocument,
  resolveProfileFile,
} from "../src/services/profile-service";

describe("parseProfileDocument", () => {
  test("requires a top-level profile object", () => {
    expect(() =>
      parseProfileDocument("identity:\n  first_name: John\n"),
    ).toThrow("top-level `profile` object");
  });

  test("accepts a valid structured profile document", () => {
    const parsed = parseProfileDocument(
      "profile:\n  identity:\n    first_name: John\n",
    );
    expect(parsed.profile).toEqual({
      identity: {
        first_name: "John",
      },
    });
  });
});

describe("resolveProfileFile", () => {
  test("resolves cv relative to the profile directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "opensidebar-profile-"));
    const profilePath = join(dir, "default.yaml");
    const cvPath = join(dir, "cv.pdf");

    try {
      writeFileSync(cvPath, "%PDF-1.4 test");
      writeFileSync(
        profilePath,
        [
          "profile:",
          "  files:",
          "    cv:",
          "      path: cv.pdf",
          "      mime_type: application/pdf",
          "",
        ].join("\n"),
      );

      const result = resolveProfileFile("cv", profilePath);

      expect(result.filename).toBe("cv.pdf");
      expect(result.mimeType).toBe("application/pdf");
      expect(result.data).toBe(Buffer.from("%PDF-1.4 test").toString("base64"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects traversal outside the profile directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "opensidebar-profile-"));
    const subdir = join(dir, "profile");
    mkdirSync(subdir);
    const profilePath = join(subdir, "default.yaml");

    try {
      writeFileSync(
        profilePath,
        [
          "profile:",
          "  files:",
          "    cv:",
          "      path: ../cv.pdf",
          "",
        ].join("\n"),
      );

      expect(() => resolveProfileFile("cv", profilePath)).toThrow(
        "must stay within the profile directory",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
