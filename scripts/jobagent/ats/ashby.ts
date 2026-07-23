/**
 * Ashby adapter (RFC LP-23 §1, phase-0 findings 2026-07-23).
 *
 * What Ashby exposes without a browser, verified live:
 *  - `api.ashbyhq.com/posting-api/job-board/<org>` — every listed job with
 *    title, location, isRemote, descriptions, jobUrl/applyUrl. No org display
 *    name and NO form fields.
 *  - the application page embeds `window.__appData` server-side with
 *    `organization.name` and a full `posting` (listing-grade), but — checked
 *    against the real EM-EU posting — still no form field definitions; the
 *    form arrives via their private GraphQL.
 *
 * So: listings tier 1 (API) with a tier-2 page fallback; questions have no
 * `questions` method at all — Ashby forms are read by the browser tier.
 */
import type { AtsAdapter, AtsListing, FetchLike } from "./types";
import { fetchJson, fetchText, snippetOf } from "./types";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** `jobs.ashbyhq.com/<org>/<jid>[/application]` or `*.ashbyhq.com/…?ashby_jid=<jid>`. */
function parseTarget(url: URL): { org: string; jid: string } | null {
  if (url.hostname === "jobs.ashbyhq.com") {
    const [org, jid] = url.pathname.split("/").filter(Boolean);
    if (org && jid && UUID.test(jid)) return { org, jid: jid.match(UUID)![0] };
    return null;
  }
  // Ashby's own site (and only theirs) embeds the board under ashbyhq.com
  // with an ashby_jid param; arbitrary employer domains cannot name an org.
  if (url.hostname.endsWith("ashbyhq.com")) {
    const jid = url.searchParams.get("ashby_jid");
    if (jid && UUID.test(jid)) return { org: "ashby", jid };
  }
  return null;
}

interface AshbyJob {
  id?: string;
  title?: string;
  location?: string;
  secondaryLocations?: Array<{ location?: string }>;
  isRemote?: boolean;
  descriptionPlain?: string;
  descriptionHtml?: string;
  jobUrl?: string;
  applyUrl?: string;
}

function toListing(job: AshbyJob, org: string, tier: string): AtsListing {
  const secondaries = (job.secondaryLocations ?? [])
    .map((s) => s?.location)
    .filter(Boolean) as string[];
  const parts = [
    job.isRemote ? "Remote" : "",
    job.location ?? "",
    ...secondaries,
  ].filter(Boolean);
  return {
    title: job.title ?? "",
    // The public API names no organization; the org slug is the stable
    // identifier and honest about its origin (never invented prose).
    company: org,
    location: parts.join("; "),
    snippet: snippetOf(job.descriptionPlain ?? job.descriptionHtml),
    applyUrl: job.applyUrl ?? job.jobUrl ?? "",
    tier,
  };
}

/**
 * Extract `window.__appData = {…}` from a jobs.ashbyhq.com page. Brace-counted
 * (string-aware) rather than regexed: the object is large and regex anchors
 * proved wrong against the real page. Exported for tests.
 */
export function extractAppData(html: string): Record<string, unknown> | null {
  const at = html.indexOf("window.__appData");
  if (at < 0) return null;
  const start = html.indexOf("{", at);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1)) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export const ashby: AtsAdapter = {
  name: "ashby",

  recognizes(url: URL): boolean {
    return parseTarget(url) !== null;
  },

  async listing(url: URL, fetchImpl: FetchLike): Promise<AtsListing | null> {
    const target = parseTarget(url);
    if (!target) return null;

    // Tier 1: the job-board API.
    const board = (await fetchJson(
      fetchImpl,
      `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(target.org)}`,
    )) as { jobs?: AshbyJob[] } | null;
    const job = board?.jobs?.find((j) => j.id === target.jid);
    if (job?.title) return toListing(job, target.org, "ashby-api");

    // Tier 2: the application page's embedded appData (covers unlisted jobs,
    // and yields the organization's display name when present).
    const html = await fetchText(
      fetchImpl,
      `https://jobs.ashbyhq.com/${encodeURIComponent(target.org)}/${target.jid}`,
    );
    if (!html) return null;
    const data = extractAppData(html);
    const posting = data?.posting as
      | (AshbyJob & { locationName?: string; workplaceType?: string })
      | undefined;
    if (!posting?.title) return null;
    const organization = data?.organization as { name?: string } | undefined;
    const listing = toListing(
      {
        ...posting,
        location: posting.locationName,
        isRemote: posting.workplaceType?.toLowerCase() === "remote",
      },
      target.org,
      "ashby-page",
    );
    if (organization?.name) listing.company = organization.name;
    if (!listing.applyUrl) {
      listing.applyUrl = `https://jobs.ashbyhq.com/${target.org}/${target.jid}/application`;
    }
    return listing;
  },

  // No `questions`: Ashby's form definition is not in the API or the embedded
  // page data (verified against the live EM-EU posting) — browser tier only.
};
