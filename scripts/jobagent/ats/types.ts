/**
 * ATS adapter layer (RFC LP-23 §1) — shared shapes.
 *
 * An adapter turns a posting URL into the same listing/questions shapes the
 * browser extraction tier produces, so everything downstream is tier-blind.
 * Adapters READ public endpoints only — the browser (OpenSidebar) remains the
 * only thing that ever writes to a form.
 *
 * Failure contract: an adapter that cannot deliver returns `null` (the caller
 * falls to the next tier); it never invents fields and never throws past the
 * resolver. That mirrors browser-ops' rule that a near-miss must degrade to
 * "I did not get this", not to a confident wrong value.
 */
import type { FormQuestion } from "../drafting";

/** Matches `ExtractedListing` (browser-ops) field-for-field, plus provenance. */
export interface AtsListing {
  title: string;
  company: string;
  location: string;
  snippet: string;
  applyUrl: string;
  /** Which tier produced this, e.g. "ashby-api", "lever-page", "jsonld". */
  tier: string;
}

/** Matches `ExtractedQuestions` (browser-ops), plus provenance. */
export interface AtsQuestions {
  questions: FormQuestion[];
  partial: boolean;
  pageNote: string;
  tier: string;
}

/** Injected for tests; production passes global fetch. */
export type FetchLike = typeof fetch;

export interface AtsAdapter {
  name: string;
  /** Cheap URL-shape recognition — no network. */
  recognizes(url: URL): boolean;
  listing(url: URL, fetchImpl: FetchLike): Promise<AtsListing | null>;
  /** Absent when this ATS cannot expose its form without a browser (Ashby). */
  questions?(url: URL, fetchImpl: FetchLike): Promise<AtsQuestions | null>;
}

const FETCH_TIMEOUT_MS = 8_000;

/** GET returning parsed JSON, or null on any failure. */
export async function fetchJson(
  fetchImpl: FetchLike,
  url: string,
): Promise<unknown | null> {
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** GET returning body text, or null on any failure. */
export async function fetchText(
  fetchImpl: FetchLike,
  url: string,
): Promise<string | null> {
  try {
    const res = await fetchImpl(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** HTML → readable text: entities decoded, tags dropped, whitespace collapsed. */
export function stripHtml(html: string): string {
  return html
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** First `max` characters of stripped text — the listing snippet convention. */
export function snippetOf(html: string | undefined, max = 240): string {
  if (!html) return "";
  const text = stripHtml(html);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
