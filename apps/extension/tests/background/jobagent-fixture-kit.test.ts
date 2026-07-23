/**
 * JobAgent fixture kit (RFC LP-22) — the end-to-end drafting property the pi
 * rehearsal depends on.
 *
 * The rehearsal is only meaningful if the fixture form contains questions that
 * genuinely CANNOT be answered from the library — otherwise "the agent filled
 * everything" proves nothing about the human gate, because the gate never had
 * anything to hold. So this file pins two things:
 *
 *  1. the fixture question list still matches the fixture form (drift guard —
 *     the form is a .tsx that can be edited without anyone touching the JSON);
 *  2. drafting resolves every mechanical field and leaves the judgment ones as
 *     explicit TODOs, at least two of them.
 *
 * If someone later adds a "salary" answer to the fixture library, this fails
 * loudly rather than quietly turning the rehearsal into a no-op.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseAnswerLibrary } from "../../../../scripts/jobagent/answers";
import { buildKitDraft, type FormQuestion } from "../../../../scripts/jobagent/drafting";
import type { ApplicationPackage } from "../../../../scripts/jobagent/package";

const FIXTURES = join(__dirname, "../../tests/e2e/fixtures");
const KIT_DIR = join(FIXTURES, "live-app-kit");
const ASHBY_ROUTE = join(FIXTURES, "online-shop-pro/src/routes/ashby-job-application.tsx");

const questions: FormQuestion[] = JSON.parse(
  readFileSync(join(KIT_DIR, "ashby-questions.json"), "utf8"),
);
const library = parseAnswerLibrary(
  JSON.parse(readFileSync(join(KIT_DIR, "answer-library.json"), "utf8")),
);

/** The posting the rehearsal uses: job `sr-fe-1` on the fixture board. */
const pkg: ApplicationPackage = {
  schemaVersion: 1,
  company: "Nextera Tech",
  roleTitle: "Senior Frontend Engineer",
  sourceUrl: "http://localhost:3333/job-board?job=sr-fe-1",
  status: "reviewing",
};

/** Questions the library is expected to answer without a human. */
const MECHANICAL = [
  "Name",
  "Email",
  "LinkedIn URL",
  "Phone",
  "Resume/CV",
  "Current Location",
  "EU Work Permit",
];

/** Questions that require the candidate's own judgment. */
const NEEDS_INSIGHT = [
  "Salary Expectation",
  "Earliest Start Date",
  "Why Do You Care About Nextera Tech?",
];

describe("fixture question list", () => {
  const route = readFileSync(ASHBY_ROUTE, "utf8");

  test("every fixture question still exists on the fixture form", () => {
    for (const question of questions) {
      // The form renders the company name dynamically; match the stable stem.
      const needle = question.label.startsWith("Why Do You Care About")
        ? "Why Do You Care About"
        : question.label;
      expect(route, `"${question.label}" is no longer on the Ashby form`).toContain(needle);
    }
  });

  test("the list covers both mechanical and judgment questions", () => {
    const labels = questions.map((q) => q.label);
    expect(labels).toEqual([...MECHANICAL, ...NEEDS_INSIGHT.slice(0, 2), NEEDS_INSIGHT[2]]);
  });
});

describe("drafting against the fixture library", () => {
  const draft = buildKitDraft(pkg, questions, library);
  const byLabel = new Map(draft.perField.map((f) => [f.question.label, f]));

  test("leaves at least two questions needing human insight", () => {
    // The gate is only real if it has something to hold.
    expect(draft.unresolved.length).toBeGreaterThanOrEqual(2);
  });

  test("the unresolved questions are exactly the judgment ones", () => {
    expect(draft.unresolved.sort()).toEqual([...NEEDS_INSIGHT].sort());
  });

  test("every mechanical field resolves with provenance, none invented", () => {
    for (const label of MECHANICAL) {
      const field = byLabel.get(label);
      expect(field, `${label} missing from the draft`).toBeDefined();
      expect(field!.source.kind, `${label} should not be a TODO`).not.toBe("todo");
      expect(field!.answer.length, `${label} resolved to an empty answer`).toBeGreaterThan(0);
    }
  });

  test("identity fields carry the library's values verbatim", () => {
    expect(byLabel.get("Email")!.answer).toBe("sam@example.test");
    expect(byLabel.get("Name")!.answer).toBe("Sam Example");
    expect(byLabel.get("Current Location")!.answer).toBe("Vienna, Austria");
  });

  test("the work-permit select resolves to one of its offered options", () => {
    const field = byLabel.get("EU Work Permit")!;
    expect(field.answer).toBe("Yes");
    expect(questions.find((q) => q.label === "EU Work Permit")!.options).toContain(field.answer);
  });

  test("the CV slot gets the CV, and nothing else does", () => {
    expect(byLabel.get("Resume/CV")!.answer).toBe("sample-cv.pdf");
  });

  test("judgment fields are empty TODOs — drafting never guesses a salary", () => {
    for (const label of NEEDS_INSIGHT) {
      const field = byLabel.get(label)!;
      expect(field.source.kind, `${label} should be a TODO`).toBe("todo");
      expect(field.answer).toBe("");
    }
  });
});
