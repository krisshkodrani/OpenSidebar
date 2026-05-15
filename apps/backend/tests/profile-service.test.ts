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

  test("normalizes bracket array indexes into path segments", () => {
    expect(
      normalizeRequestedFields([
        "experience.roles[1].company",
        "profile.experience.roles[2].title",
      ]),
    ).toEqual(["experience.roles.1.company", "experience.roles.2.title"]);
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
          "    first_name: John",
          "    last_name: Doe",
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
        "identity.first_name": "John",
        "address.city": "Berlin",
        "sensitive.date_of_birth": "1990-01-01",
      });
      expect(result.missing).toEqual(["identity.email"]);
      expect(result.sensitiveFields).toEqual(["sensitive.date_of_birth"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns arrays of plain objects for repeated experience entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "opensidebar-profile-"));
    const profilePath = join(dir, "default.yaml");

    try {
      writeFileSync(
        profilePath,
        [
          "profile:",
          "  experience:",
          "    roles:",
          "      - company: Atlas Labs",
          "        title: Senior Frontend Engineer",
          '        start_date: "2022-04"',
          "        end_date: Present",
          "        summary: Built React and TypeScript workflow tools.",
          "      - company: Northstar Systems",
          "        title: Frontend Engineer",
          '        start_date: "2019-06"',
          '        end_date: "2022-03"',
          "        summary: Delivered customer dashboards.",
          "",
        ].join("\n"),
      );

      const result = resolveProfileFields(
        [
          "experience.roles",
          "experience.roles[1].company",
          "experience.roles.1.title",
          "experience.roles[1].startDate",
          "experience.roles.1.endDate",
          "experience.roles[1].description",
        ],
        profilePath,
      );

      expect(result.values["experience.roles"]).toEqual([
        {
          company: "Atlas Labs",
          title: "Senior Frontend Engineer",
          start_date: "2022-04",
          end_date: "Present",
          summary: "Built React and TypeScript workflow tools.",
        },
        {
          company: "Northstar Systems",
          title: "Frontend Engineer",
          start_date: "2019-06",
          end_date: "2022-03",
          summary: "Delivered customer dashboards.",
        },
      ]);
      expect(result.values["experience.roles.1.company"]).toBe(
        "Northstar Systems",
      );
      expect(result.values["experience.roles.1.title"]).toBe("Frontend Engineer");
      expect(result.values["experience.roles.1.startDate"]).toBe("2019-06");
      expect(result.values["experience.roles.1.endDate"]).toBe("2022-03");
      expect(result.values["experience.roles.1.description"]).toBe(
        "Delivered customer dashboards.",
      );
      expect(result.missing).toEqual([]);
      expect(result.sensitiveFields).toEqual([]);
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
