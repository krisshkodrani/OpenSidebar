/**
 * JobAgent discovery (pi-backend Phase 7) — the front half of the apply loop.
 *
 * Discovery turns job-board listings into REVIEW-QUEUE packages: pi navigates
 * boards and extracts listings (via the browser bridge), then records each
 * candidate here. This module makes every judgment DETERMINISTIC and
 * auditable — a listing is matched/rejected by transparent string rules
 * against the human-authored search criteria, deduplicated against the
 * existing workspace, and written as an `application-package.json` in status
 * `reviewing`. Discovery NEVER creates a fill manifest and NEVER applies:
 * a package only becomes actionable after a human reviews it, adds the
 * pre-approved answers kit (run-config.json), and promotes it to `ready`.
 *
 * The search criteria are personal data (desired roles, locations) and live
 * OUT of the repo in the seed store (Phase 0):
 * `~/.opensidebar/seed/jobagent/search-criteria.json`.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadApplicationPackage, type ApplicationPackage } from "./package";
import { resolveApplicationDir, resolveApplicationsDir, resolveSeedDir } from "./paths";

export interface JobBoard {
  /** Display name, e.g. "We Work Remotely". */
  name: string;
  /** The search URL to open (may embed the query). */
  searchUrl: string;
  /** Optional operator notes (pagination quirks, login needs). */
  notes?: string;
}

export interface SearchCriteria {
  schemaVersion: 1;
  /** Role phrases — a listing must match at least one to be considered. */
  roles: string[];
  /** Bonus signals recorded as match reasons (never required). */
  keywords?: string[];
  /** Hard rejects when found in the title or snippet. */
  excludeKeywords?: string[];
  /** Acceptable locations (case-insensitive substring match). */
  locations?: string[];
  /** Whether "remote" counts as an acceptable location. */
  remoteOk?: boolean;
  /** The boards to sweep, in order. */
  boards: JobBoard[];
  /** Safety valve: stop creating packages after this many in one run. */
  maxPackagesPerRun?: number;
}

const CRITERIA_FILE = "search-criteria.json";

/** `<seed>/jobagent/search-criteria.json` — personal data, outside the repo. */
export function resolveSearchCriteriaPath(): string {
  return join(resolveSeedDir(), "jobagent", CRITERIA_FILE);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function stringArray(v: unknown, field: string, required: boolean): string[] {
  if (v === undefined) {
    if (required) throw new Error(`search criteria: ${field} is required`);
    return [];
  }
  if (!Array.isArray(v) || !v.every(nonEmptyString)) {
    throw new Error(`search criteria: ${field} must be an array of non-empty strings`);
  }
  if (required && v.length === 0) {
    throw new Error(`search criteria: ${field} must not be empty`);
  }
  return v;
}

/** Hand-validated parse (same convention as package.ts — no schema dependency). */
export function parseSearchCriteria(raw: unknown): SearchCriteria {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("search criteria must be a JSON object");
  }
  const c = raw as Record<string, unknown>;
  if (c.schemaVersion !== 1) {
    throw new Error("search criteria: schemaVersion must be 1");
  }
  stringArray(c.roles, "roles", true);
  stringArray(c.keywords, "keywords", false);
  stringArray(c.excludeKeywords, "excludeKeywords", false);
  stringArray(c.locations, "locations", false);
  if (!Array.isArray(c.boards) || c.boards.length === 0) {
    throw new Error("search criteria: boards must be a non-empty array");
  }
  for (const board of c.boards) {
    const b = board as Record<string, unknown>;
    if (!b || !nonEmptyString(b.name) || !nonEmptyString(b.searchUrl)) {
      throw new Error("search criteria: every board needs name and searchUrl");
    }
  }
  return raw as SearchCriteria;
}

/** Load the operator's criteria, with a precise setup hint when absent. */
export function loadSearchCriteria(): SearchCriteria {
  const path = resolveSearchCriteriaPath();
  if (!existsSync(path)) {
    throw new Error(
      `no search criteria at ${path} — create it (schemaVersion 1, roles[], ` +
        `boards[{name, searchUrl}], optional locations[]/remoteOk/` +
        `excludeKeywords[]/maxPackagesPerRun) before running discovery`,
    );
  }
  return parseSearchCriteria(JSON.parse(readFileSync(path, "utf8")));
}

export interface DiscoveredListing {
  /** Role title exactly as listed. */
  title: string;
  company: string;
  /** Canonical listing URL (the dedupe key). */
  url: string;
  location?: string;
  /** Short description/snippet if the board shows one. */
  snippet?: string;
  /** Which board it came from (board name). */
  source: string;
}

export interface ListingAssessment {
  match: boolean;
  /** Human-readable, auditable reasons for the verdict. */
  reasons: string[];
  /** Non-fatal cautions carried onto the package as risks. */
  risks: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Location vocabulary. Boards write "remote" and then qualify it — "Remote
 * (US)", "REMOTE (US ONLY, LA/SF preferred)", "Bengaluru, India (REMOTE)".
 * A bare `location.includes("remote")` test treats all of those as reachable,
 * which is how the first live sweep queued six jobs the operator cannot take.
 * These lists let the qualifier be judged on the same deterministic terms as
 * any other location.
 */
const EUROPE_ALIASES = ["europe", "european union", "eu", "eea", "emea", "cet", "cest"];
const EUROPE_COUNTRIES = [
  "austria", "belgium", "bulgaria", "croatia", "cyprus", "czechia",
  "czech republic", "denmark", "estonia", "finland", "france", "germany",
  "greece", "hungary", "iceland", "ireland", "italy", "latvia",
  "liechtenstein", "lithuania", "luxembourg", "malta", "netherlands",
  "norway", "poland", "portugal", "romania", "slovakia", "slovenia", "spain",
  "sweden", "switzerland", "united kingdom", "uk", "great britain",
];
const EUROPE_TERMS = [...EUROPE_ALIASES, ...EUROPE_COUNTRIES];

/**
 * Geographies we can positively recognise as NOT Europe. Only a term on this
 * list turns an unmatched qualifier into a reject — anything unrecognised
 * ("UTC+3", "hybrid") is accepted with a risk, so a vocabulary gap can never
 * silently drop a reachable job.
 */
const NON_EUROPE_TERMS = [
  "us", "u.s.", "usa", "u.s.a.", "united states", "america", "americas",
  "north america", "latam", "latin america", "south america", "canada",
  "mexico", "brazil", "argentina", "colombia", "india", "apac", "asia",
  "china", "japan", "singapore", "philippines", "indonesia", "vietnam",
  "australia", "new zealand", "africa", "middle east", "uae", "israel",
];

const wordRe = (term: string) =>
  new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");

const mentions = (text: string, terms: string[]) => terms.some((t) => wordRe(t).test(text));

/**
 * Terms that satisfy one criteria entry. "Europe"/"EU" expands to the European
 * countries so a listing that names only "Sweden" still matches an operator
 * who wrote "Europe" — the first sweep rejected exactly that.
 */
function criteriaTerms(entry: string): string[] {
  const e = norm(entry);
  return EUROPE_ALIASES.includes(e) ? EUROPE_TERMS : [e];
}

const acceptedBy = (text: string, criteria: SearchCriteria) =>
  (criteria.locations ?? []).some((l) => mentions(text, criteriaTerms(l)));

/** Pull parenthesised qualifiers ("Remote (EU, Norway)") off the base text. */
function splitQualifiers(raw: string): { base: string; qualifiers: string[] } {
  const qualifiers: string[] = [];
  let base = raw.replace(/\(([^)]*)\)/g, (_m, inner: string) => {
    qualifiers.push(inner);
    return " ";
  });
  // "Remote — EU only" / "Remote - EU"
  const trailing = base.match(/\bremote\b\s*[—–-]\s*(.+)$/i);
  if (trailing) {
    qualifiers.push(trailing[1]);
    base = base.replace(/\bremote\b\s*[—–-]\s*.+$/i, "remote");
  }
  if (!/[a-z0-9]/i.test(base)) return { base: norm(qualifiers.join(", ")), qualifiers: [] };
  return { base: norm(base), qualifiers };
}

const splitPieces = (text: string) =>
  text
    .split(/\bor\b|[,/;|]/i)
    .map(norm)
    .filter((p) => p.length > 0);

type LocationVerdict = { ok: boolean; reason: string; risk?: string };

/**
 * Is a "remote" listing remote *for this operator*? Accept when a qualifier
 * names an acceptable place or there is no qualifier at all; reject only when
 * every qualifier names a recognisably out-of-scope geography.
 */
function assessRemote(qualifiers: string[], criteria: SearchCriteria): LocationVerdict {
  if (!criteria.remoteOk) return { ok: false, reason: "remote not acceptable per criteria" };
  const pieces = qualifiers.flatMap(splitPieces).filter((p) => !/^remote$/.test(p));
  if (pieces.length === 0) return { ok: true, reason: "remote, unqualified" };

  const accepted = pieces.find((p) => acceptedBy(p, criteria));
  if (accepted) return { ok: true, reason: `remote qualifier in scope: "${accepted}"` };

  const blocked = pieces.find((p) => mentions(p, NON_EUROPE_TERMS));
  if (blocked) return { ok: false, reason: `remote is restricted to "${blocked}"` };

  return {
    ok: true,
    reason: `remote, qualifier "${pieces.join(", ")}" unrecognised`,
    risk: `remote qualified as "${qualifiers.join("; ")}" — confirm eligibility before applying`,
  };
}

/** Whole-string location verdict: alternatives ("SF or Remote") match on any. */
function assessLocationText(raw: string, criteria: SearchCriteria): LocationVerdict {
  const { base, qualifiers } = splitQualifiers(raw);
  const alternatives = splitPieces(base);
  const verdicts = alternatives.map((alt) =>
    /\bremote\b/.test(alt)
      ? assessRemote(qualifiers, criteria)
      : acceptedBy(alt, criteria)
        ? { ok: true, reason: `location in scope: "${alt}"` }
        : { ok: false, reason: `location "${alt}" outside criteria` },
  );
  const hit = verdicts.find((v) => v.ok);
  return hit ?? verdicts[0] ?? { ok: false, reason: "location not understood" };
}

/**
 * Deterministic match verdict. Rules, in order:
 *  1. any excludeKeyword in title/snippet → reject;
 *  2. at least one role phrase must appear in the title → else reject;
 *  3. locations: acceptable when the listing location matches the list (with
 *     "Europe"/"EU" expanded to its countries), or says remote with remoteOk
 *     AND its remote qualifier is not a recognisably out-of-scope geography,
 *     or is ABSENT (flagged as a risk, not a reject — boards often omit it in
 *     list views);
 *  4. keywords add reasons, never decide.
 */
export function assessListing(
  listing: DiscoveredListing,
  criteria: SearchCriteria,
): ListingAssessment {
  const title = norm(listing.title);
  const haystack = `${title} ${norm(listing.snippet ?? "")}`;
  const reasons: string[] = [];
  const risks: string[] = [];

  for (const exclude of criteria.excludeKeywords ?? []) {
    if (haystack.includes(norm(exclude))) {
      return {
        match: false,
        reasons: [`exclude keyword "${exclude}" present`],
        risks,
      };
    }
  }

  const roleHit = criteria.roles.find((role) => title.includes(norm(role)));
  if (!roleHit) {
    return {
      match: false,
      reasons: [`title matches none of the target roles (${criteria.roles.join(", ")})`],
      risks,
    };
  }
  reasons.push(`role match: "${roleHit}"`);

  const wantsLocation = (criteria.locations ?? []).length > 0 || criteria.remoteOk;
  if (wantsLocation) {
    const location = norm(listing.location ?? "");
    if (!location) {
      risks.push("location not shown in listing — verify on the posting");
    } else {
      const verdict = assessLocationText(location, criteria);
      if (!verdict.ok) {
        return {
          match: false,
          reasons: [...reasons, `location "${listing.location}": ${verdict.reason}`],
          risks,
        };
      }
      reasons.push(`location ok: "${listing.location}" (${verdict.reason})`);
      if (verdict.risk) risks.push(verdict.risk);
    }
  }

  for (const keyword of criteria.keywords ?? []) {
    if (haystack.includes(norm(keyword))) reasons.push(`keyword: "${keyword}"`);
  }

  return { match: true, reasons, risks };
}

/** Directory-name slug for a listing: `company-title`, ≤60 chars. */
export function listingSlug(listing: Pick<DiscoveredListing, "company" | "title">): string {
  const slug = `${listing.company}-${listing.title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, 60).replace(/-+$/g, "") || "listing";
}

/**
 * Package name for a single-URL ingest (RFC LP-22 §2).
 *
 * `company-title` when the page yielded both, so the queue stays readable; the
 * URL host plus a short hash when it did not, so ingest never fails on a messy
 * title alone. An unreadable name is recoverable — a refused ingest in the
 * middle of a twenty-result sweep is friction.
 */
export function ingestName(
  listing: Pick<DiscoveredListing, "company" | "title">,
  url: string,
): string {
  if (nonEmptyString(listing.company) && nonEmptyString(listing.title)) {
    return listingSlug(listing);
  }
  const hash = createHash("sha256").update(normalizeUrl(url)).digest("hex").slice(0, 6);
  let host = "posting";
  try {
    host = new URL(url).host;
  } catch {
    /* unparseable URL — the hash alone still disambiguates */
  }
  const hostSlug = host
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return `${hostSlug || "posting"}-${hash}`;
}

/** Trailing-slash/case-insensitive-host URL normalization for dedupe. */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return `${u.origin.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return url.trim().replace(/\/+$/, "");
  }
}

/** An existing package matching this listing (by sourceUrl or slug), or null. */
export function findDuplicate(
  listing: DiscoveredListing,
): { name: string; status: string } | null {
  const root = resolveApplicationsDir();
  if (!existsSync(root)) return null;
  const slug = listingSlug(listing);
  const url = normalizeUrl(listing.url);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let pkg: ApplicationPackage | null = null;
    try {
      pkg = loadApplicationPackage(resolveApplicationDir(entry.name));
    } catch {
      continue;
    }
    if (!pkg) continue;
    const sameUrl = pkg.sourceUrl && normalizeUrl(pkg.sourceUrl) === url;
    if (sameUrl || entry.name === slug) {
      return { name: entry.name, status: pkg.status ?? "reviewing" };
    }
  }
  return null;
}

export type DiscoveryOutcome =
  | { outcome: "created"; name: string; dir: string; reasons: string[]; risks: string[] }
  | { outcome: "duplicate"; existing: { name: string; status: string } }
  | { outcome: "rejected"; reasons: string[] };

/**
 * Assess, dedupe, and (on a match) create the review-queue package + a
 * `discovery.json` audit record. Pure filesystem; never touches the browser.
 * `now` is injectable for tests; defaults to the current time.
 */
export function recordDiscovery(
  listing: DiscoveredListing,
  criteria: SearchCriteria,
  opts: { now?: Date; name?: string } = {},
): DiscoveryOutcome {
  for (const field of ["title", "company", "url", "source"] as const) {
    if (!nonEmptyString(listing[field])) {
      throw new Error(`discovery listing: ${field} is required`);
    }
  }
  const assessment = assessListing(listing, criteria);
  if (!assessment.match) {
    return { outcome: "rejected", reasons: assessment.reasons };
  }
  const duplicate = findDuplicate(listing);
  if (duplicate) return { outcome: "duplicate", existing: duplicate };

  // Sweeps always take the derived slug; single-URL ingest may pass a name it
  // derived from the URL host when the page had no clean company/title (see
  // `ingestName`), or one the caller supplied with `--name`.
  const name = opts.name ?? listingSlug(listing);
  const dir = resolveApplicationDir(name);
  mkdirSync(dir, { recursive: true });

  const now = opts.now ?? new Date();
  const pkg: ApplicationPackage = {
    schemaVersion: 1,
    company: listing.company,
    roleTitle: listing.title,
    sourceUrl: listing.url,
    dateFound: now.toISOString().slice(0, 10),
    status: "reviewing",
    ...(assessment.risks.length > 0 ? { risks: assessment.risks } : {}),
  };
  writeFileSync(
    join(dir, "application-package.json"),
    JSON.stringify(pkg, null, 2) + "\n",
    "utf8",
  );
  writeFileSync(
    join(dir, "discovery.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        recordedAt: now.toISOString(),
        listing,
        assessment,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  return {
    outcome: "created",
    name,
    dir,
    reasons: assessment.reasons,
    risks: assessment.risks,
  };
}
