/**
 * ATS resolver (RFC LP-23 §1) — the tier-1/2 front of parse-first discovery.
 *
 * `resolveListing`/`resolveQuestions` return null when no parser tier can
 * deliver; the caller (the daemon's RunManager) then falls back to the
 * browser tier. Every failure inside a tier degrades silently to the next —
 * an adapter bug must cost latency, never correctness.
 */
import type { AtsAdapter, AtsListing, AtsQuestions, FetchLike } from "./types";
import { ashby } from "./ashby";
import { genericListing } from "./generic";
import { greenhouse } from "./greenhouse";
import { lever } from "./lever";

export type { AtsListing, AtsQuestions, FetchLike } from "./types";

const ADAPTERS: AtsAdapter[] = [ashby, greenhouse, lever];

function parseUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Which adapter (if any) recognises this URL — exported for reporting/tests. */
export function matchAdapter(raw: string): string | null {
  const url = parseUrl(raw);
  if (!url) return null;
  return ADAPTERS.find((a) => a.recognizes(url))?.name ?? null;
}

/** Tier 1 (ATS adapter) then tier 2 (JSON-LD); null → caller uses the browser. */
export async function resolveListing(
  raw: string,
  fetchImpl: FetchLike,
): Promise<AtsListing | null> {
  const url = parseUrl(raw);
  if (!url) return null;
  for (const adapter of ADAPTERS) {
    if (!adapter.recognizes(url)) continue;
    try {
      const listing = await adapter.listing(url, fetchImpl);
      if (listing) return listing;
    } catch {
      /* degrade */
    }
    break; // one adapter owns a URL shape; don't let another guess
  }
  try {
    return await genericListing(url, fetchImpl);
  } catch {
    return null;
  }
}

/** Adapter questions tier only — there is no generic questions parser. */
export async function resolveQuestions(
  raw: string,
  fetchImpl: FetchLike,
): Promise<AtsQuestions | null> {
  const url = parseUrl(raw);
  if (!url) return null;
  for (const adapter of ADAPTERS) {
    if (!adapter.recognizes(url)) continue;
    if (!adapter.questions) return null;
    try {
      return await adapter.questions(url, fetchImpl);
    } catch {
      return null;
    }
  }
  return null;
}
