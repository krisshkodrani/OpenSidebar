/**
 * Kit drafting (pi Phase 9, v1) — the deterministic question→answer mapper.
 * Proves the rule order (identity → exact tag/question → defaults → keyword
 * overlap → TODO), select-option enforcement, manifest derivation, the
 * human-edit resolution flow, and the approve gate.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  approveKitDraft,
  buildKitDraft,
  loadKitDraft,
  saveKitDraft,
  type FormQuestion,
} from "../../../../scripts/jobagent/drafting";
import { loadFillManifest } from "../../../../scripts/jobagent/manifest";
import type { AnswerLibrary } from "../../../../scripts/jobagent/answers";
import type { ApplicationPackage } from "../../../../scripts/jobagent/package";

const tmpDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "drafting-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const pkg: ApplicationPackage = {
  schemaVersion: 1,
  company: "Acme",
  roleTitle: "AI Engineer",
  sourceUrl: "https://board.example/jobs/1",
  status: "reviewing",
};

const library: AnswerLibrary = {
  schemaVersion: 1,
  identity: {
    fullName: "Sam Example",
    email: "sam@example.test",
    phone: "+43 1 000000",
    linkedin: "https://linkedin.example/in/sam",
  },
  answers: [
    {
      tag: "how_heard",
      question: "How did you hear about us?",
      keywords: ["hear about"],
      text: "Through the job board.",
    },
    {
      tag: "coding_assistants",
      keywords: ["coding assistants"],
      text: "A long-form answer about assistants. ".repeat(6),
    },
    {
      tag: "work_mode",
      keywords: ["work mode"],
      text: "Remote",
    },
  ],
  cvVariants: [{ name: "default", file: "applications/sample/cv.pdf" }],
  defaults: { noticePeriod: "1 month", workAuthorization: "Yes" },
};

const QUESTIONS: FormQuestion[] = [
  { label: "Email", kind: "text" },
  { label: "Full Name", kind: "text" },
  { label: "LinkedIn Profile", kind: "text" },
  { label: "How did you hear about us?", kind: "text" },
  { label: "Describe your experience with coding assistants", kind: "longtext" },
  { label: "What is your notice period?", kind: "text" },
  { label: "Preferred work mode", kind: "select", options: ["Remote", "Hybrid", "On-site"] },
  { label: "Favourite dinosaur", kind: "text" },
  { label: "Resume/CV", kind: "file" },
];

describe("buildKitDraft mapping rules", () => {
  const draft = buildKitDraft(pkg, QUESTIONS, library, {
    now: new Date("2026-07-18T18:00:00Z"),
  });
  const byLabel = Object.fromEntries(draft.perField.map((f) => [f.question.label, f]));

  test("identity rules resolve email/name/linkedin", () => {
    expect(byLabel["Email"]).toMatchObject({ answer: "sam@example.test", source: { kind: "identity", key: "email" } });
    expect(byLabel["Full Name"].source).toEqual({ kind: "identity", key: "fullName" });
    expect(byLabel["LinkedIn Profile"].source).toEqual({ kind: "identity", key: "linkedin" });
  });

  test("exact recorded-question match wins", () => {
    expect(byLabel["How did you hear about us?"]).toMatchObject({
      answer: "Through the job board.",
      source: { kind: "answer", tag: "how_heard" },
    });
  });

  test("defaults answer notice-period style questions", () => {
    expect(byLabel["What is your notice period?"]).toMatchObject({
      answer: "1 month",
      source: { kind: "default", key: "noticePeriod" },
    });
  });

  test("keyword overlap resolves the long-form answer", () => {
    expect(byLabel["Describe your experience with coding assistants"].source).toEqual({
      kind: "answer",
      tag: "coding_assistants",
    });
  });

  test("select answers must match an option (and do)", () => {
    expect(byLabel["Preferred work mode"]).toMatchObject({
      answer: "Remote",
      source: { kind: "answer", tag: "work_mode" },
    });
  });

  test("select answers OUTSIDE the options become TODO", () => {
    const altered = buildKitDraft(
      pkg,
      [{ label: "Preferred work mode", kind: "select", options: ["Office only"] }],
      library,
    );
    expect(altered.perField[0].source).toEqual({ kind: "todo" });
    expect(altered.unresolved).toEqual(["Preferred work mode"]);
  });

  test("unmatched questions are explicit TODOs — never invented", () => {
    expect(byLabel["Favourite dinosaur"].source).toEqual({ kind: "todo" });
    expect(draft.unresolved).toContain("Favourite dinosaur");
  });

  test("file questions bind the CV variant", () => {
    expect(byLabel["Resume/CV"].source).toEqual({ kind: "default", key: "cvVariant" });
  });

  test("manifest derivation: prompt lines, short vs long expectations, no-submit guard", () => {
    const m = draft.manifest;
    expect(m.formUrl).toBe(pkg.sourceUrl);
    expect(m.promptLines.join("\n")).toContain('Field "Email": sam@example.test');
    expect(m.promptLines.join("\n")).toContain("Do NOT submit");
    expect(m.expectedFieldValues).toContain("sam@example.test");
    expect(m.expectedLongTexts?.[0]).toContain("long-form answer");
    // TODO fields are absent from the manifest entirely.
    expect(m.promptLines.join("\n")).not.toContain("Favourite dinosaur");
  });
});

describe("save/approve flow", () => {
  test("human-edited TODO becomes resolved; approve writes a loadable run-config", () => {
    const dir = tempDir();
    const draft = buildKitDraft(pkg, QUESTIONS, library);
    writeFileSync(join(dir, "kit-draft.json"), JSON.stringify(draft), "utf8");

    // Approve blocks while TODOs remain.
    expect(() => approveKitDraft(dir)).toThrow(/unresolved/);

    // Human fills the TODO answers in the UI → PUT → saveKitDraft.
    const edited = {
      ...draft,
      perField: draft.perField.map((f) =>
        f.source.kind === "todo" ? { ...f, answer: "Stegosaurus" } : f,
      ),
    };
    const saved = saveKitDraft(dir, pkg, edited);
    expect(saved.unresolved).toEqual([]);
    expect(saved.manifest.promptLines.join("\n")).toContain("Stegosaurus");

    // The form has a Resume/CV slot, so approval now also requires a servable
    // CV — without one the agent would be told to attach a file it does not
    // have (issue #110). Configure it the way a real kit does.
    expect(() => approveKitDraft(dir)).toThrow(/needs a CV to upload/);
    const withCv = {
      ...saved,
      manifest: { ...saved.manifest, cvServe: { dir: ".", port: 0, file: "cv.pdf" } },
    };
    writeFileSync(join(dir, "kit-draft.json"), JSON.stringify(withCv), "utf8");

    const manifest = approveKitDraft(dir);
    expect(manifest.expectedFieldValues).toContain("Stegosaurus");
    // Byte-compatible with the Phase-5 loader.
    expect(loadFillManifest(dir)?.formUrl).toBe(pkg.sourceUrl);
  });

  test("approval refuses a CV slot the kit cannot serve (issue #110)", () => {
    const dir = tempDir();
    // Every field resolves, including the CV — but no cvServe means there is
    // no file to hand the agent, which is how a fabricated upload reached a
    // real form field live.
    const draft = buildKitDraft(pkg, [{ label: "Resume/CV", kind: "file" }], library);
    expect(draft.unresolved).toEqual([]);
    expect(draft.manifest.cvServe).toBeUndefined();
    writeFileSync(join(dir, "kit-draft.json"), JSON.stringify(draft), "utf8");

    expect(() => approveKitDraft(dir)).toThrow(/needs a CV to upload/);
    // And the brief never asks for an upload it cannot supply.
    expect(draft.manifest.promptLines.join("\n")).not.toMatch(/upload_file/);
  });

  test("force-approve bypasses the unresolved gate", () => {
    const dir = tempDir();
    const draft = buildKitDraft(pkg, [{ label: "Favourite dinosaur" }], library);
    writeFileSync(join(dir, "kit-draft.json"), JSON.stringify(draft), "utf8");
    expect(() => approveKitDraft(dir)).toThrow(/unresolved/);
    expect(approveKitDraft(dir, { force: true }).formUrl).toBe(pkg.sourceUrl);
  });

  test("loadKitDraft validates shape", () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "kit-draft.json"), JSON.stringify({ schemaVersion: 1, perField: [] }), "utf8");
    expect(() => loadKitDraft(dir)).toThrow(/non-empty array/);
  });

  test("buildKitDraft rejects empty/invalid questions", () => {
    expect(() => buildKitDraft(pkg, [], library)).toThrow(/at least one/);
    expect(() => buildKitDraft(pkg, [{ label: "" }], library)).toThrow(/non-empty label/);
  });
});

/**
 * Regressions from the first live console smoke (2026-07-18), where a real
 * Greenhouse form produced four confidently-wrong answers and reported ZERO
 * unresolved fields — the dangerous combination, since the approve gate only
 * blocks on unresolved.
 */
describe("live-smoke regressions", () => {
  test("a keyword with no scoring tokens does not match every label", () => {
    // "go" is below the token-length floor, so its token set is empty and
    // `every` was vacuously true — this entry matched anything unmatched.
    const withShortKeyword: AnswerLibrary = {
      ...library,
      answers: [{ tag: "backend", keywords: ["go", "django"], text: "Yes" }],
    };
    const draft = buildKitDraft(
      pkg,
      [{ label: "Favourite dinosaur", kind: "text" }],
      withShortKeyword,
    );
    expect(draft.perField[0].source).toEqual({ kind: "todo" });
    expect(draft.unresolved).toEqual(["Favourite dinosaur"]);
  });

  test("split name fields get their own parts, not the whole name", () => {
    const draft = buildKitDraft(
      pkg,
      [
        { label: "First Name", kind: "text" },
        { label: "Last Name", kind: "text" },
        { label: "Preferred First Name", kind: "text" },
      ],
      library,
    );
    expect(draft.perField[0]).toMatchObject({
      answer: "Sam",
      source: { kind: "identity", key: "firstName" },
    });
    expect(draft.perField[1]).toMatchObject({
      answer: "Example",
      source: { kind: "identity", key: "lastName" },
    });
    // "Preferred First Name" is still a first-name slot.
    expect(draft.perField[2].answer).toBe("Sam");
  });

  test("explicit identity name parts override the fullName split", () => {
    const draft = buildKitDraft(
      pkg,
      [{ label: "Last Name", kind: "text" }],
      { ...library, identity: { ...library.identity, lastName: "Beispiel" } },
    );
    expect(draft.perField[0].answer).toBe("Beispiel");
  });

  test("a non-CV file input is not silently given the resume", () => {
    const draft = buildKitDraft(
      pkg,
      [
        { label: "Resume/CV", kind: "file" },
        { label: "Cover Letter", kind: "file" },
      ],
      library,
    );
    expect(draft.perField[0].source).toEqual({ kind: "default", key: "cvVariant" });
    expect(draft.perField[1].source).toEqual({ kind: "todo" });
    expect(draft.unresolved).toEqual(["Cover Letter"]);
  });

  test("a select with no captured options is a TODO, not free text", () => {
    const draft = buildKitDraft(pkg, [{ label: "Country", kind: "select" }], library);
    expect(draft.perField[0].source).toEqual({ kind: "todo" });
  });

  test("country derives from a location that names one, and only then", () => {
    const withLocation: AnswerLibrary = {
      ...library,
      identity: { ...library.identity, location: "Linz, Austria" },
    };
    const resolved = buildKitDraft(
      pkg,
      [{ label: "Country", kind: "select", options: ["Austria", "Germany"] }],
      withLocation,
    );
    expect(resolved.perField[0]).toMatchObject({
      answer: "Austria",
      source: { kind: "identity", key: "country" },
    });

    const cityOnly: AnswerLibrary = {
      ...library,
      identity: { ...library.identity, location: "Vienna" },
    };
    const unresolved = buildKitDraft(
      pkg,
      [{ label: "Country", kind: "select", options: ["Austria"] }],
      cityOnly,
    );
    expect(unresolved.perField[0].source).toEqual({ kind: "todo" });
  });

  test("unresolved fields still block approval", () => {
    const dir = tempDir();
    const draft = buildKitDraft(pkg, [{ label: "Cover Letter", kind: "file" }], library);
    saveKitDraft(dir, pkg, draft);
    expect(() => approveKitDraft(dir)).toThrow(/unresolved field/);
  });

  test("a field marked skip is a decision, not an unresolved gap", () => {
    const dir = tempDir();
    const draft = buildKitDraft(
      pkg,
      [
        { label: "Email", kind: "text" },
        { label: "Cover Letter", kind: "file" },
      ],
      library,
    );
    expect(draft.unresolved).toEqual(["Cover Letter"]);

    const edited = {
      ...draft,
      perField: draft.perField.map((f) =>
        f.question.label === "Cover Letter"
          ? { ...f, source: { kind: "skip", note: "no approved cover letter" } }
          : f,
      ),
    };
    const saved = saveKitDraft(dir, pkg, edited);
    expect(saved.unresolved).toEqual([]);
    // A skipped field contributes nothing to the fill manifest.
    expect(saved.manifest.promptLines.join(" ")).not.toMatch(/Cover Letter/);
    expect(() => approveKitDraft(dir)).not.toThrow();
  });
});

/* ── LP-23: proposed provenance, review gate, demographics ── */

describe("proposed provenance (LP-23)", () => {
  const questions: FormQuestion[] = [
    { label: "Email", kind: "text" },
    { label: "Why do you want to work here?", kind: "longtext", required: true },
  ];

  function draftWithProposal() {
    const draft = buildKitDraft(pkg, questions, library);
    const essay = draft.perField.find((f) => f.question.label.startsWith("Why"))!;
    essay.answer = "Because of the posting's stated ownership model.";
    essay.source = { kind: "proposed", basis: "posting: 'you own the whole stack'" };
    return draft;
  }

  test("saveKitDraft preserves proposals verbatim — saving is not accepting", () => {
    const dir = tempDir();
    const saved = saveKitDraft(dir, pkg, draftWithProposal());

    const essay = saved.perField.find((f) => f.question.label.startsWith("Why"))!;
    expect(essay.source).toEqual({
      kind: "proposed",
      basis: "posting: 'you own the whole stack'",
    });
    expect(saved.unreviewed).toEqual(["Why do you want to work here?"]);
    // And it round-trips through disk unchanged.
    expect(loadKitDraft(dir)!.unreviewed).toEqual(["Why do you want to work here?"]);
  });

  test("an unreviewed proposal never reaches the manifest", () => {
    const dir = tempDir();
    const saved = saveKitDraft(dir, pkg, draftWithProposal());

    const manifestText = JSON.stringify(saved.manifest);
    expect(manifestText).not.toContain("ownership model");
    // The library-resolved field is still there — only the proposal is held.
    expect(saved.manifest.promptLines.join("\n")).toContain("sam@example.test");
  });

  test("approve refuses unreviewed proposals; acceptance unlocks it", () => {
    const dir = tempDir();
    // Through the real save path, so unresolved/unreviewed are recomputed.
    const draft = saveKitDraft(dir, pkg, draftWithProposal());

    expect(() => approveKitDraft(dir)).toThrow(/unreviewed proposed answer/);
    expect(() => approveKitDraft(dir)).toThrow(/Why do you want to work here\?/);

    // The owner accepts (what `jobagent accept` records), then approves.
    const essay = draft.perField.find((f) => f.question.label.startsWith("Why"))!;
    essay.source = { ...essay.source, accepted: true, acceptedVia: "single" } as never;
    const saved = saveKitDraft(dir, pkg, draft);
    expect(saved.unreviewed).toEqual([]);
    // Accepted proposal text NOW belongs in the manifest.
    expect(saved.manifest.expectedLongTexts?.join(" ") ?? saved.manifest.promptLines.join(" ")).toContain(
      "ownership model",
    );
    const manifest = approveKitDraft(dir);
    expect(JSON.stringify(manifest)).toContain("ownership model");
  });

  test("drafts from before LP-23 (no unreviewed field) still parse and approve", () => {
    const dir = tempDir();
    const draft = buildKitDraft(pkg, [{ label: "Email", kind: "text" }], library);
    delete (draft as Record<string, unknown>).unreviewed;
    writeFileSync(join(dir, "kit-draft.json"), JSON.stringify(draft), "utf8");
    expect(() => approveKitDraft(dir)).not.toThrow();
  });
});

describe("demographic questions (LP-23, owner decision: library-only)", () => {
  const demographicLibrary: AnswerLibrary = {
    ...library,
    answers: [
      ...library.answers,
      { tag: "gender", question: "Gender", keywords: [], text: "Prefer not to say" },
    ],
  };

  test("keyword-matched demographic questions resolve from explicit entries only", () => {
    const draft = buildKitDraft(
      pkg,
      [
        { label: "Gender", kind: "text" },
        { label: "Race/Ethnicity", kind: "text" },
      ],
      demographicLibrary,
    );
    const byLabel = new Map(draft.perField.map((f) => [f.question.label, f]));

    // Explicit library entry → resolves like any answer.
    expect(byLabel.get("Gender")!.answer).toBe("Prefer not to say");
    expect(byLabel.get("Gender")!.source.kind).toBe("answer");
    // No entry → skip with a note, NOT todo: it can neither block approval
    // nor become proposable.
    const race = byLabel.get("Race/Ethnicity")!;
    expect(race.source.kind).toBe("skip");
    expect(draft.unresolved).toEqual([]);
  });

  test("the structural flag from an ATS adapter routes the same way", () => {
    const draft = buildKitDraft(
      pkg,
      [{ label: "Background", kind: "select", options: ["A", "B"], demographic: true }],
      library,
    );
    expect(draft.perField[0].source.kind).toBe("skip");
  });

  test("a demographic select whose library answer mismatches degrades to skip, not todo", () => {
    const draft = buildKitDraft(
      pkg,
      [{ label: "Gender", kind: "select", options: ["Woman", "Man", "Non-binary"] }],
      demographicLibrary, // library says "Prefer not to say" — not an option
    );
    expect(draft.perField[0].source.kind).toBe("skip");
    expect(draft.unresolved).toEqual([]);
  });

  test("demographic questions never resolve via keyword overlap", () => {
    const sneaky: AnswerLibrary = {
      ...library,
      answers: [{ tag: "x", keywords: ["veteran"], text: "should never appear" }],
    };
    const draft = buildKitDraft(pkg, [{ label: "Veteran Status" }], sneaky);
    expect(draft.perField[0].answer).toBe("");
    expect(draft.perField[0].source.kind).toBe("skip");
  });
});
