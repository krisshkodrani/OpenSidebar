/**
 * JobAgent answer library (pi Phase 9) — the canonical, human-authored
 * source of application answers. Kit drafting maps form questions onto this
 * library deterministically; nothing here is ever synthesized by a model.
 *
 * Personal data — lives OUT of the repo (Phase-0 pattern) at
 * `<seed>/jobagent/answer-library.json`. Hand-validated (package.ts
 * convention; no schema dependency), precise error messages.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

import { resolveSeedDir } from "./paths";

export interface AnswerEntry {
  /** Canonical tag, e.g. "experience_coding_assistants", "how_heard". */
  tag: string;
  /** The exact question this answers, when known (improves matching). */
  question?: string;
  /** Match keywords — label tokens that select this answer. */
  keywords: string[];
  /** The approved answer text, used verbatim. */
  text: string;
}

export interface CvVariant {
  name: string;
  /** Path relative to the seed dir (absolute paths and .. are rejected). */
  file: string;
}

export interface AnswerLibrary {
  schemaVersion: 1;
  identity: {
    fullName: string;
    email: string;
    phone?: string;
    location?: string;
    linkedin?: string;
    github?: string;
    website?: string;
  };
  links?: Record<string, string>;
  salary?: { currency: string; min?: number; target?: number; note?: string };
  answers: AnswerEntry[];
  cvVariants: CvVariant[];
  defaults?: {
    locations?: string[];
    remoteOk?: boolean;
    noticePeriod?: string;
    workAuthorization?: string;
  };
}

const LIBRARY_FILE = "answer-library.json";

export function resolveAnswerLibraryPath(): string {
  return join(resolveSeedDir(), "jobagent", LIBRARY_FILE);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Hand-validated parse; throws with a precise message on any violation. */
export function parseAnswerLibrary(raw: unknown): AnswerLibrary {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("answer library must be a JSON object");
  }
  const lib = raw as Record<string, unknown>;
  if (lib.schemaVersion !== 1) {
    throw new Error("answer library: schemaVersion must be 1");
  }
  const identity = lib.identity as Record<string, unknown> | undefined;
  if (!identity || typeof identity !== "object") {
    throw new Error("answer library: identity is required");
  }
  if (!nonEmptyString(identity.fullName)) {
    throw new Error("answer library: identity.fullName is required");
  }
  if (!nonEmptyString(identity.email)) {
    throw new Error("answer library: identity.email is required");
  }
  if (!Array.isArray(lib.answers)) {
    throw new Error("answer library: answers must be an array");
  }
  const tags = new Set<string>();
  for (const entry of lib.answers) {
    const a = entry as Record<string, unknown>;
    if (!a || !nonEmptyString(a.tag)) {
      throw new Error("answer library: every answer needs a non-empty tag");
    }
    if (tags.has(a.tag)) {
      throw new Error(`answer library: duplicate answer tag "${a.tag}"`);
    }
    tags.add(a.tag);
    if (!nonEmptyString(a.text)) {
      throw new Error(`answer library: answer "${a.tag}" needs non-empty text`);
    }
    if (
      !Array.isArray(a.keywords) ||
      !a.keywords.every((k) => nonEmptyString(k))
    ) {
      throw new Error(
        `answer library: answer "${a.tag}" needs keywords as a string array`,
      );
    }
  }
  if (!Array.isArray(lib.cvVariants)) {
    throw new Error("answer library: cvVariants must be an array");
  }
  for (const variant of lib.cvVariants) {
    const v = variant as Record<string, unknown>;
    if (!v || !nonEmptyString(v.name) || !nonEmptyString(v.file)) {
      throw new Error("answer library: every cvVariant needs name and file");
    }
    if (isAbsolute(v.file) || v.file.includes("..")) {
      throw new Error(
        `answer library: cvVariant "${v.name}" file must be a relative path inside the seed dir`,
      );
    }
  }
  return raw as AnswerLibrary;
}

/** Load the library, or null when absent (callers surface a setup hint). */
export function loadAnswerLibrary(): AnswerLibrary | null {
  const path = resolveAnswerLibraryPath();
  if (!existsSync(path)) return null;
  return parseAnswerLibrary(JSON.parse(readFileSync(path, "utf8")));
}

/** Validate-then-write. */
export function saveAnswerLibrary(raw: unknown): AnswerLibrary {
  const library = parseAnswerLibrary(raw);
  const path = resolveAnswerLibraryPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(library, null, 2) + "\n", "utf8");
  return library;
}
