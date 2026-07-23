/**
 * Generic tier (RFC LP-23 §1): listing-only, from schema.org JSON-LD.
 *
 * Many career pages embed a `JobPosting` object in
 * `<script type="application/ld+json">` for search engines. That gives us a
 * listing without knowing the ATS. Questions are NEVER attempted here —
 * heuristic HTML form-scraping on arbitrary sites is exactly the
 * confident-wrong path this pipeline refuses; unknown forms go to the
 * browser tier.
 */
import type { AtsListing, FetchLike } from "./types";
import { fetchText, snippetOf } from "./types";

interface JsonLdJobPosting {
  "@type"?: string | string[];
  title?: string;
  hiringOrganization?: { name?: string } | string;
  jobLocation?:
    | Array<{ address?: { addressLocality?: string; addressCountry?: string } }>
    | { address?: { addressLocality?: string; addressCountry?: string } };
  jobLocationType?: string;
  description?: string;
  url?: string;
}

function isJobPosting(node: unknown): node is JsonLdJobPosting {
  if (!node || typeof node !== "object") return false;
  const type = (node as JsonLdJobPosting)["@type"];
  return type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
}

/** Find a JobPosting node in a parsed JSON-LD document (handles @graph). */
function findPosting(doc: unknown): JsonLdJobPosting | null {
  if (isJobPosting(doc)) return doc;
  if (Array.isArray(doc)) {
    for (const node of doc) if (isJobPosting(node)) return node;
  }
  const graph = (doc as { "@graph"?: unknown[] })?.["@graph"];
  if (Array.isArray(graph)) {
    for (const node of graph) if (isJobPosting(node)) return node;
  }
  return null;
}

function locationText(posting: JsonLdJobPosting): string {
  const parts: string[] = [];
  if (posting.jobLocationType === "TELECOMMUTE") parts.push("Remote");
  const locations = Array.isArray(posting.jobLocation)
    ? posting.jobLocation
    : posting.jobLocation
      ? [posting.jobLocation]
      : [];
  for (const loc of locations) {
    const bits = [loc?.address?.addressLocality, loc?.address?.addressCountry]
      .filter(Boolean)
      .join(", ");
    if (bits) parts.push(bits);
  }
  return parts.join("; ");
}

/** Parse a page's JSON-LD blocks into a listing, or null. Exported for tests. */
export function listingFromJsonLd(html: string, pageUrl: string): AtsListing | null {
  const blocks = [
    ...html.matchAll(
      /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];
  for (const block of blocks) {
    let doc: unknown;
    try {
      doc = JSON.parse(block[1]);
    } catch {
      continue; // malformed block: skip, never guess
    }
    const posting = findPosting(doc);
    if (!posting?.title) continue;
    const org = posting.hiringOrganization;
    return {
      title: posting.title,
      company: typeof org === "string" ? org : (org?.name ?? ""),
      location: locationText(posting),
      snippet: snippetOf(posting.description),
      applyUrl: posting.url ?? pageUrl,
      tier: "jsonld",
    };
  }
  return null;
}

export async function genericListing(
  url: URL,
  fetchImpl: FetchLike,
): Promise<AtsListing | null> {
  const html = await fetchText(fetchImpl, url.toString());
  if (!html) return null;
  return listingFromJsonLd(html, url.toString());
}
