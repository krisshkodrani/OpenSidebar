/**
 * JobAgent kit drafting (pi Phase 9) — deterministic mapping from a form's
 * questions to the human-authored answer library, producing a reviewable
 * kit draft with per-field provenance. Unmatched questions become explicit
 * TODOs — drafting never invents an answer, and approving a draft with
 * unresolved TODOs is blocked (unless forced).
 *
 * `approveKitDraft` writes the exact `run-config.json` (FillManifest) shape
 * the Phase-5 apply loop consumes, so an approved draft is immediately
 * fillable.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AnswerLibrary } from "./answers";
import type { FillManifest } from "./manifest";
import type { ApplicationPackage } from "./package";

export interface FormQuestion {
  label: string;
  kind?: "text" | "longtext" | "select" | "file";
  options?: string[];
  required?: boolean;
}

export type FieldSource =
  | { kind: "identity"; key: string }
  | { kind: "answer"; tag: string }
  | { kind: "default"; key: string }
  /** Deliberately left blank by the human (optional field, no approved answer). */
  | { kind: "skip"; note?: string }
  | { kind: "todo" };

export interface KitDraftField {
  question: FormQuestion;
  answer: string;
  source: FieldSource;
}

export interface KitDraft {
  schemaVersion: 1;
  generatedAt: string;
  manifest: FillManifest;
  perField: KitDraftField[];
  unresolved: string[];
}

const DRAFT_FILE = "kit-draft.json";
const MANIFEST_FILE = "run-config.json";
/** Answers longer than this render as expectedLongTexts, not field values. */
const LONG_ANSWER_CHARS = 120;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const tokens = (s: string) =>
  new Set(norm(s).split(/[^a-z0-9+#]+/).filter((t) => t.length >= 3));

/**
 * Ordered identity keyword table — first hit wins. Name rules are split and
 * ordered before `fullName` so a form with separate First/Last inputs does not
 * receive the whole name in both.
 */
const IDENTITY_RULES: Array<{ key: string; pattern: RegExp }> = [
  { key: "email", pattern: /\be-?mail\b/i },
  { key: "phone", pattern: /\b(phone|mobile|telephone)\b/i },
  { key: "linkedin", pattern: /\blinked\s?in\b/i },
  { key: "github", pattern: /\bgithub\b/i },
  { key: "website", pattern: /\b(website|portfolio|personal site)\b/i },
  { key: "firstName", pattern: /\b(first|given|fore)\s?name\b/i },
  { key: "lastName", pattern: /\b(last|family|sur)\s?name\b/i },
  { key: "fullName", pattern: /\b(full |whole )?name\b/i },
  { key: "country", pattern: /\bcountry\b/i },
  { key: "location", pattern: /\b(location|city|where.*based|address)\b/i },
];

const DEFAULT_RULES: Array<{ key: string; pattern: RegExp }> = [
  { key: "noticePeriod", pattern: /\bnotice period|earliest start|start date\b/i },
  {
    key: "workAuthorization",
    pattern: /\b(work (permit|authori[sz]ation)|visa|legally (entitled|allowed) to work|right to work)\b/i,
  },
];

/** Labels that mean "attach the CV". Other file inputs are not CV slots. */
const CV_FILE_PATTERN = /\b(resume|cv|curriculum vitae|lebenslauf)\b/i;

/**
 * Identity values, including the ones derived from `fullName` / `location`
 * when not stated explicitly. Derivation is deliberately conservative: a
 * country is only read off a location that actually names one after a comma,
 * so "Vienna" alone yields no country rather than a wrong one.
 */
function identityValue(
  key: string,
  identity: AnswerLibrary["identity"],
): string | undefined {
  const stated = identity[key as keyof AnswerLibrary["identity"]];
  if (typeof stated === "string" && stated.length > 0) return stated;

  const nameParts = identity.fullName.trim().split(/\s+/);
  if (key === "firstName") return nameParts[0];
  if (key === "lastName") {
    return nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined;
  }
  if (key === "country" && identity.location?.includes(",")) {
    return identity.location.split(",").pop()?.trim() || undefined;
  }
  return undefined;
}

function resolveField(
  question: FormQuestion,
  library: AnswerLibrary,
): { answer: string; source: FieldSource } {
  const label = question.label;

  // (5) file kind: only actual CV slots get the CV. A cover-letter (or any
  // other) upload is left for the human — attaching the résumé there would be
  // a confidently wrong answer.
  if (question.kind === "file") {
    if (!CV_FILE_PATTERN.test(label)) return { answer: "", source: { kind: "todo" } };
    const variant = library.cvVariants[0];
    return variant
      ? { answer: variant.file, source: { kind: "default", key: "cvVariant" } }
      : { answer: "", source: { kind: "todo" } };
  }

  // (1) identity keyword table.
  for (const rule of IDENTITY_RULES) {
    if (rule.pattern.test(label)) {
      const value = identityValue(rule.key, library.identity);
      if (value) return finishTextAnswer(question, value, { kind: "identity", key: rule.key });
    }
  }

  // (2) exact tag / recorded-question match.
  const normalizedLabel = norm(label);
  for (const entry of library.answers) {
    if (
      norm(entry.tag).replace(/_/g, " ") === normalizedLabel ||
      (entry.question && norm(entry.question) === normalizedLabel)
    ) {
      return finishTextAnswer(question, entry.text, { kind: "answer", tag: entry.tag });
    }
  }

  // (2b) defaults keyed by question shape (notice period, work authorization).
  for (const rule of DEFAULT_RULES) {
    if (rule.pattern.test(label) && library.defaults) {
      const value = library.defaults[rule.key as "noticePeriod" | "workAuthorization"];
      if (value) return finishTextAnswer(question, value, { kind: "default", key: rule.key });
    }
  }

  // (3) keyword overlap — first library entry (deterministic order) with ≥1
  // distinct keyword hit against the label tokens.
  const labelTokens = tokens(label);
  for (const entry of library.answers) {
    const hit = entry.keywords.some((keyword) => {
      const keywordTokens = [...tokens(keyword)];
      // A keyword whose tokens are all below the token-length floor (e.g.
      // "go", "AI") carries no signal — without this guard `every` would be
      // vacuously true and the entry would match every unmatched label.
      if (keywordTokens.length === 0) return false;
      return keywordTokens.every((t) => labelTokens.has(t));
    });
    if (hit) {
      return finishTextAnswer(question, entry.text, { kind: "answer", tag: entry.tag });
    }
  }

  return { answer: "", source: { kind: "todo" } };
}

/**
 * (4) select answers must be one of the offered options, else TODO — and a
 * select whose options were never captured is a TODO too: free text cannot be
 * verified against a list we do not have.
 */
function finishTextAnswer(
  question: FormQuestion,
  text: string,
  source: FieldSource,
): { answer: string; source: FieldSource } {
  if (question.kind === "select") {
    if (!question.options?.length) return { answer: "", source: { kind: "todo" } };
    const match = question.options.find((o) => norm(o) === norm(text));
    if (!match) return { answer: "", source: { kind: "todo" } };
    return { answer: match, source };
  }
  return { answer: text, source };
}

/** Derive the FillManifest from resolved fields (regenerated on every save). */
export function deriveManifest(
  pkg: ApplicationPackage,
  fields: KitDraftField[],
  existing?: Partial<FillManifest>,
): FillManifest {
  const promptLines: string[] = [
    `Fill out this job application form. Use EXACTLY the values below — byte`,
    `for byte, no paraphrasing. Any field not listed here: leave it blank.`,
    `Do NOT submit the form — when every listed field is filled, stop and report.`,
  ];
  const expectedFieldValues: string[] = [];
  const expectedLongTexts: string[] = [];

  for (const field of fields) {
    if (field.source.kind === "todo" || !field.answer) continue;
    if (field.question.kind === "file") {
      promptLines.push(
        `Attach the CV via upload_file on the file input for "${field.question.label}".`,
      );
      continue;
    }
    promptLines.push(`Field "${field.question.label}": ${field.answer}`);
    if (
      field.question.kind === "longtext" ||
      field.answer.length > LONG_ANSWER_CHARS
    ) {
      expectedLongTexts.push(field.answer);
    } else {
      expectedFieldValues.push(field.answer);
    }
  }

  return {
    // The package's formUrl wins over sourceUrl: a posting page and its
    // application form are usually different URLs, and filling the posting
    // would find no form at all.
    formUrl: existing?.formUrl ?? pkg.formUrl ?? pkg.sourceUrl ?? "",
    maxTurns: existing?.maxTurns ?? 40,
    ...(existing?.cvServe ? { cvServe: existing.cvServe } : {}),
    promptLines,
    expectedFieldValues,
    ...(expectedLongTexts.length ? { expectedLongTexts } : {}),
    forbiddenPageText: existing?.forbiddenPageText ?? [
      "Application submitted",
      "Thank you for applying",
    ],
  };
}

/** Build a fresh draft by mapping every question against the library. */
export function buildKitDraft(
  pkg: ApplicationPackage,
  questions: FormQuestion[],
  library: AnswerLibrary,
  opts: { now?: Date } = {},
): KitDraft {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("kit draft needs at least one form question");
  }
  for (const q of questions) {
    if (!q || typeof q.label !== "string" || q.label.length === 0) {
      throw new Error("every form question needs a non-empty label");
    }
  }
  const perField = questions.map((question) => ({
    question,
    ...resolveField(question, library),
  }));
  const unresolved = perField
    .filter((f) => f.source.kind === "todo")
    .map((f) => f.question.label);
  return {
    schemaVersion: 1,
    generatedAt: (opts.now ?? new Date()).toISOString(),
    manifest: deriveManifest(pkg, perField),
    perField,
    unresolved,
  };
}

/** Validate a (possibly human-edited) draft shape. */
export function parseKitDraft(raw: unknown): KitDraft {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("kit draft must be a JSON object");
  }
  const draft = raw as Record<string, unknown>;
  if (draft.schemaVersion !== 1) {
    throw new Error("kit draft: schemaVersion must be 1");
  }
  if (!Array.isArray(draft.perField) || draft.perField.length === 0) {
    throw new Error("kit draft: perField must be a non-empty array");
  }
  for (const field of draft.perField) {
    const f = field as Record<string, unknown>;
    const q = f?.question as Record<string, unknown> | undefined;
    if (!q || typeof q.label !== "string" || q.label.length === 0) {
      throw new Error("kit draft: every field needs question.label");
    }
    if (typeof f.answer !== "string") {
      throw new Error(`kit draft: field "${q.label}" needs a string answer`);
    }
  }
  return raw as KitDraft;
}

export function loadKitDraft(dir: string): KitDraft | null {
  const path = join(dir, DRAFT_FILE);
  if (!existsSync(path)) return null;
  return parseKitDraft(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Save an edited draft: recompute unresolved (an edited field with a
 * non-empty answer counts as human-resolved; a field the human marked "skip"
 * is a decision, not a gap) and re-derive the manifest so it can never drift
 * from the fields.
 */
export function saveKitDraft(
  dir: string,
  pkg: ApplicationPackage,
  raw: unknown,
  opts: { now?: Date } = {},
): KitDraft {
  const draft = parseKitDraft(raw);
  const perField = draft.perField.map((field) =>
    field.source.kind === "todo" && field.answer.length > 0
      ? { ...field, source: { kind: "answer", tag: "manual" } as FieldSource }
      : field,
  );
  const unresolved = perField
    .filter((f) => f.source.kind === "todo")
    .map((f) => f.question.label);
  const updated: KitDraft = {
    schemaVersion: 1,
    generatedAt: (opts.now ?? new Date()).toISOString(),
    manifest: deriveManifest(pkg, perField, draft.manifest),
    perField,
    unresolved,
  };
  writeFileSync(
    join(dir, DRAFT_FILE),
    JSON.stringify(updated, null, 2) + "\n",
    "utf8",
  );
  return updated;
}

/**
 * Approve: write run-config.json (exact FillManifest — byte-compatible with
 * loadFillManifest). Blocks while TODOs remain unless forced.
 */
export function approveKitDraft(
  dir: string,
  opts: { force?: boolean } = {},
): FillManifest {
  const draft = loadKitDraft(dir);
  if (!draft) throw new Error(`no kit-draft.json in ${dir}`);
  if (draft.unresolved.length > 0 && !opts.force) {
    throw new Error(
      `kit draft has ${draft.unresolved.length} unresolved field(s): ` +
        draft.unresolved.join(", "),
    );
  }
  writeFileSync(
    join(dir, MANIFEST_FILE),
    JSON.stringify(draft.manifest, null, 2) + "\n",
    "utf8",
  );
  return draft.manifest;
}
