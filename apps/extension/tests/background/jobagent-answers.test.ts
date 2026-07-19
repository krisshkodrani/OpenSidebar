/**
 * Answer library (pi Phase 9, v1) — parser/persistence tests. Synthetic
 * data only; filesystem sandboxed via OPENSIDEBAR_SEED_DIR.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadAnswerLibrary,
  parseAnswerLibrary,
  saveAnswerLibrary,
  type AnswerLibrary,
} from "../../../../scripts/jobagent/answers";

let savedSeed: string | undefined;
const tmpDirs: string[] = [];

beforeEach(() => {
  savedSeed = process.env.OPENSIDEBAR_SEED_DIR;
  const dir = mkdtempSync(join(tmpdir(), "answers-seed-"));
  tmpDirs.push(dir);
  process.env.OPENSIDEBAR_SEED_DIR = dir;
});
afterEach(() => {
  if (savedSeed === undefined) delete process.env.OPENSIDEBAR_SEED_DIR;
  else process.env.OPENSIDEBAR_SEED_DIR = savedSeed;
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const library: AnswerLibrary = {
  schemaVersion: 1,
  identity: {
    fullName: "Sam Example",
    email: "sam@example.test",
    phone: "+43 1 000000",
    linkedin: "https://linkedin.example/in/sam",
  },
  salary: { currency: "EUR", min: 50000, target: 60000 },
  answers: [
    {
      tag: "how_heard",
      question: "How did you hear about us?",
      keywords: ["hear about", "found us"],
      text: "Through the job board.",
    },
    {
      tag: "experience_coding_assistants",
      keywords: ["coding assistants", "ai tools"],
      text: "Long-form answer about coding assistants that easily exceeds the short-field threshold because it keeps going and going with detail.",
    },
  ],
  cvVariants: [{ name: "default", file: "applications/sample/cv.pdf" }],
  defaults: { remoteOk: true, noticePeriod: "1 month", workAuthorization: "Yes" },
};

describe("parseAnswerLibrary", () => {
  test("valid library parses", () => {
    expect(parseAnswerLibrary(library).answers).toHaveLength(2);
  });

  test.each([
    [{ ...library, schemaVersion: 2 }, /schemaVersion/],
    [{ ...library, identity: { email: "x@y.z" } }, /fullName/],
    [{ ...library, identity: { fullName: "Sam" } }, /email/],
    [{ ...library, answers: [{ tag: "", keywords: [], text: "x" }] }, /non-empty tag/],
    [{ ...library, answers: [library.answers[0], library.answers[0]] }, /duplicate answer tag/],
    [{ ...library, answers: [{ tag: "t", keywords: "no", text: "x" }] }, /keywords/],
    [{ ...library, cvVariants: [{ name: "cv", file: "C:/abs/cv.pdf" }] }, /relative path/],
    [{ ...library, cvVariants: [{ name: "cv", file: "../escape.pdf" }] }, /relative path/],
  ])("rejects invalid shapes precisely", (raw, pattern) => {
    expect(() => parseAnswerLibrary(raw)).toThrow(pattern);
  });

  // The cvVariant path guard must rule the same way on every OS. It used to
  // lean on node:path.isAbsolute, which is platform-dependent — "C:/abs/cv.pdf"
  // is absolute on Windows and relative on Linux — so CI (Linux) accepted a
  // path the developer's Windows box rejected, and a Windows-only local run
  // could not see it.
  test.each([
    "/etc/passwd",
    "\\windows\\system32\\cv.pdf",
    "\\\\server\\share\\cv.pdf",
    "C:/abs/cv.pdf",
    "c:cv.pdf",
    "../escape.pdf",
    "cv/../../escape.pdf",
  ])("rejects escaping cvVariant path regardless of platform: %s", (file) => {
    expect(() =>
      parseAnswerLibrary({ ...library, cvVariants: [{ name: "cv", file }] }),
    ).toThrow(/relative path/);
  });

  test.each(["cv/master.pdf", "cv-master.pdf", "cv..old.pdf", "a/b/c.pdf"])(
    "accepts ordinary relative cvVariant path: %s",
    (file) => {
      // "cv..old.pdf" must stay legal — the guard checks `..` as a path
      // SEGMENT, not as a substring.
      expect(
        parseAnswerLibrary({ ...library, cvVariants: [{ name: "cv", file }] })
          .cvVariants[0].file,
      ).toBe(file);
    },
  );
});

describe("load/save", () => {
  test("absent library loads null; save round-trips", () => {
    expect(loadAnswerLibrary()).toBeNull();
    saveAnswerLibrary(library);
    expect(loadAnswerLibrary()?.identity.fullName).toBe("Sam Example");
  });

  test("save validates before writing", () => {
    expect(() => saveAnswerLibrary({ nope: true })).toThrow(/schemaVersion/);
    expect(loadAnswerLibrary()).toBeNull(); // nothing written
  });
});
