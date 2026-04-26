import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  isSensitiveProfileField,
  normalizeRequestedFields,
  parseProfileDocument,
  resolveProfileFields,
  resolveProfileFile,
  resolveSafeProfileContext,
} from "../src/services/profile-service";

describe("parseProfileDocument", () => {
  test("requires a top-level profile object", () => {
    expect(() => parseProfileDocument("identity:\n  first_name: Kai\n")).toThrow(
      "top-level `profile` object",
    );
  });

  test("accepts a valid structured profile document", () => {
    const parsed = parseProfileDocument(
      "profile:\n  identity:\n    first_name: Kai\n",
    );
    expect(parsed.profile).toEqual({
      identity: {
        first_name: "Kai",
      },
    });
  });
});

describe("normalizeRequestedFields", () => {
  test("deduplicates and strips the optional profile prefix", () => {
    expect(
      normalizeRequestedFields([
        " identity.first_name ",
        "profile.identity.first_name",
        "address.city",
      ]),
    ).toEqual(["identity.first_name", "address.city"]);
  });

  test("rejects invalid path segments", () => {
    expect(() => normalizeRequestedFields(["identity.first name"])).toThrow(
      "Invalid profile field path",
    );
  });
});

describe("resolveProfileFields", () => {
  test("returns values, missing fields, and sensitive classification", () => {
    const dir = mkdtempSync(join(tmpdir(), "opensidebar-profile-"));
    const profilePath = join(dir, "default.yaml");

    try {
      writeFileSync(
        profilePath,
        [
          "profile:",
          "  identity:",
          "    first_name: Kai",
          "    last_name: Schmidt",
          "  address:",
          "    city: Berlin",
          "  sensitive:",
          '    date_of_birth: "1990-01-01"',
          "",
        ].join("\n"),
      );

      const result = resolveProfileFields(
        [
          "identity.first_name",
          "address.city",
          "sensitive.date_of_birth",
          "identity.email",
        ],
        profilePath,
      );

      expect(result.values).toEqual({
        "identity.first_name": "Kai",
        "address.city": "Berlin",
        "sensitive.date_of_birth": "1990-01-01",
      });
      expect(result.missing).toEqual(["identity.email"]);
      expect(result.sensitiveFields).toEqual(["sensitive.date_of_birth"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveSafeProfileContext", () => {
  test("returns task-relevant safe context without identity or sensitive fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "opensidebar-profile-"));
    const profilePath = join(dir, "default.yaml");

    try {
      writeFileSync(
        profilePath,
        [
          "profile:",
          "  identity:",
          "    email: kai@example.com",
          "  sensitive:",
          '    date_of_birth: "1990-01-01"',
          "  context:",
          "    safe:",
          "      professional_summary: Senior frontend engineer focused on React.",
          "      job_preferences:",
          "        roles:",
          "          - Frontend Engineer",
          "        remote: true",
          "      hobby: Chess",
          "",
        ].join("\n"),
      );

      const result = resolveSafeProfileContext(
        "Apply to a remote frontend job using my profile.",
        profilePath,
      );

      expect(result.rendered).toContain("professional_summary");
      expect(result.rendered).toContain("job_preferences.roles");
      expect(result.rendered).not.toContain("kai@example.com");
      expect(result.rendered).not.toContain("date_of_birth");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

describe("isSensitiveProfileField", () => {
  test("flags only the sensitive namespace", () => {
    expect(isSensitiveProfileField("sensitive.date_of_birth")).toBe(true);
    expect(isSensitiveProfileField("identity.first_name")).toBe(false);
  });
});
