/**
 * JobAgent daemon — read-only page extractions over the WS bridge (RFC LP-22).
 *
 * Three operations sit between "here is a URL" and "here is a kit draft":
 * pull a listing off a posting page, and pull the question list off an
 * application form. Both are **extraction only** — the instructions forbid
 * clicking, typing, and navigation beyond the target URL, so nothing here can
 * touch an employer's form state.
 *
 * The bridge call is injected, so every test drives these against a fake and
 * never opens a socket. Parsing is defensive on purpose: `browser_extract_
 * structured` returns whatever the model produced against the schema, which
 * in practice is sometimes an object and sometimes a JSON string, and
 * occasionally a near-miss shape. A near-miss must degrade to "I did not get
 * this field", never to a confident wrong value — everything downstream
 * (criteria matching, kit drafting) treats what we return as fact.
 */
import type { BrowserToolResponse } from "../browser-mcp/bridge";
import type { FormQuestion } from "../jobagent/drafting";

/** The subset of the bridge this module needs (RunManager supplies the real one). */
export type BridgeCall = (
  request: { tool: string; args: Record<string, unknown>; session?: string },
  opts?: { signal?: AbortSignal },
) => Promise<BrowserToolResponse>;

export class ExtractionError extends Error {}

/* ── Schemas handed to browser_extract_structured ─────────── */

const LISTING_SCHEMA = {
  title: "string — the job title exactly as shown, no company name appended",
  company: "string — the hiring company's name",
  location: "string — location text as shown, e.g. 'Remote (EU)' or 'Berlin, Germany'; empty string if the page does not say",
  snippet: "string — one or two sentences summarising the role",
  applyUrl: "string — the URL of the application form if this page links to a separate one, else empty string",
};

const QUESTIONS_SCHEMA = {
  questions: [
    {
      label: "string — the field's visible label text, without the required asterisk",
      kind: "string — one of: text, longtext, select, file",
      required: "boolean — true if the label or field is marked required",
      options: ["string — for select/radio fields, each choice; omit otherwise"],
    },
  ],
  morePages: "boolean — true if this form continues on another page or step (a Next/Continue button, or a step indicator like 'Step 1 of 3')",
  pageNote: "string — if morePages is true, quote the pagination evidence; else empty string",
};

/**
 * Both instructions carry this. Against a real Ashby posting the extractor
 * answered with a markdown bullet list describing the fields instead of the
 * object — readable to a human, unusable as data, and correctly refused. Saying
 * "JSON only" up front is cheaper than trying to parse prose back into facts,
 * which is exactly the confident-wrong path this module avoids elsewhere.
 */
const JSON_ONLY =
  "Return ONLY a single raw JSON object matching the schema — no prose, no " +
  "explanation, no markdown formatting, no bullet points, and no code fence.";

/* ── Response parsing ─────────────────────────────────────── */

/** Unwrap a bridge response, turning every non-ok status into a thrown error. */
function unwrap(response: BrowserToolResponse, what: string): unknown {
  if (response.status !== "ok") {
    throw new ExtractionError(
      `${what} failed (${response.status}): ${response.reason ?? "no reason given"}`,
    );
  }
  return response.result;
}

/**
 * Coerce a tool result into a record. The extractor sometimes returns the
 * object directly and sometimes a JSON string of it — including inside a
 * markdown fenced code block; anything else is a failure rather than
 * something to guess at.
 */
function asRecord(result: unknown, what: string): Record<string, unknown> {
  let value = result;
  if (typeof value === "string") {
    let text = value;
    // Strip markdown code fences when the model wraps JSON in ```json … ```.
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) text = fenceMatch[1];
    try {
      value = JSON.parse(text);
    } catch {
      throw new ExtractionError(`${what} returned unparseable text: ${text.slice(0, 200)}`);
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ExtractionError(`${what} returned ${Array.isArray(value) ? "an array" : typeof value}, expected an object`);
  }
  return value as Record<string, unknown>;
}

/** Trimmed string, or "" for anything that is not a usable string. */
function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const KINDS = new Set(["text", "longtext", "select", "file"]);

/* ── Operations ───────────────────────────────────────────── */

export interface ExtractedListing {
  title: string;
  company: string;
  location: string;
  snippet: string;
  /** The form URL when the posting links to a separate one; else the posting URL. */
  applyUrl: string;
}

/**
 * Read a posting page into the same listing shape the board sweep produces,
 * so `recordDiscovery` cannot tell a searched posting from a swept one.
 */
export async function extractListing(
  call: BridgeCall,
  url: string,
  opts: { signal?: AbortSignal; session?: string } = {},
): Promise<ExtractedListing> {
  const response = await call(
    {
      tool: "browser_extract_structured",
      args: {
        url,
        schema: LISTING_SCHEMA,
        instruction:
          "Read this job posting and extract the fields. " +
          JSON_ONLY +
          " Do not click anything, do not fill anything, and do not navigate " +
          "away from this page. If a field is genuinely not stated on the page, " +
          "return an empty string for it rather than inferring a value.",
      },
      session: opts.session,
    },
    { signal: opts.signal },
  );
  const record = asRecord(unwrap(response, "listing extraction"), "listing extraction");
  return {
    title: str(record.title),
    company: str(record.company),
    location: str(record.location),
    snippet: str(record.snippet),
    applyUrl: absolutize(str(record.applyUrl), url),
  };
}

/**
 * Resolve an extracted link against the page it came from.
 *
 * The extractor returns whatever the page showed, and pages show relative
 * hrefs — observed live returning `/apply?job=1` for the same link it had
 * returned absolute minutes earlier, so this is intermittent rather than
 * per-site. A relative value stored as a package's `formUrl` is unusable: the
 * fill would have nothing to navigate to. Falls back to the posting URL when
 * nothing was extracted, and leaves a value that will not resolve alone rather
 * than guessing at it.
 */
function absolutize(candidate: string, base: string): string {
  if (!candidate) return base;
  try {
    return new URL(candidate, base).toString();
  } catch {
    return base;
  }
}

export interface ExtractedQuestions {
  questions: FormQuestion[];
  /** True when the form continues past this page — a hard stop, not a warning. */
  partial: boolean;
  /** The pagination evidence when `partial`; empty otherwise. */
  pageNote: string;
}

/**
 * Read an application form's fields.
 *
 * Structural, not semantic: label text, input kind, required-ness. What a
 * question *means* is `buildKitDraft`'s job, against the human-authored answer
 * library — this function must never supply an answer, only a question.
 */
export async function extractQuestions(
  call: BridgeCall,
  url: string,
  opts: { signal?: AbortSignal; session?: string } = {},
): Promise<ExtractedQuestions> {
  const response = await call(
    {
      tool: "browser_extract_structured",
      args: {
        url,
        schema: QUESTIONS_SCHEMA,
        instruction:
          "List every input on this application form in the order they appear: " +
          "the visible label, the kind of input, and whether it is required. " +
          JSON_ONLY +
          " Do NOT fill, click, or submit anything, and do not navigate away. " +
          "Report the labels as written — do not rephrase, translate, or answer them.",
      },
      session: opts.session,
    },
    { signal: opts.signal },
  );
  const record = asRecord(unwrap(response, "question extraction"), "question extraction");

  const raw = record.questions;
  if (!Array.isArray(raw)) {
    throw new ExtractionError("question extraction returned no questions array");
  }
  const questions: FormQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    const label = str(entry.label);
    if (!label) continue; // a field we cannot name is a field we cannot answer
    const kind = str(entry.kind).toLowerCase();
    const options = Array.isArray(entry.options)
      ? entry.options.map(str).filter(Boolean)
      : undefined;
    questions.push({
      label,
      ...(KINDS.has(kind) ? { kind: kind as FormQuestion["kind"] } : {}),
      ...(entry.required === true ? { required: true } : {}),
      ...(options && options.length > 0 ? { options } : {}),
    });
  }
  if (questions.length === 0) {
    throw new ExtractionError(
      "question extraction found no labelled fields — the form may not have " +
        "loaded, or may be behind a login",
    );
  }
  return {
    questions,
    partial: record.morePages === true,
    pageNote: record.morePages === true ? str(record.pageNote) : "",
  };
}
