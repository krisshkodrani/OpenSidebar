/**
 * JobAgent discovery (pi-backend Phase 7) — offline tests for the
 * deterministic front half of the apply loop: criteria validation, listing
 * assessment, dedupe, and review-queue package creation. All filesystem work
 * happens in temp dirs via the JOBAGENT_APPLICATIONS_DIR / OPENSIDEBAR_SEED_DIR
 * overrides (Phase-5 test convention); nothing touches the real seed store.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assessListing,
  findDuplicate,
  listingSlug,
  loadSearchCriteria,
  parseSearchCriteria,
  recordDiscovery,
  resolveSearchCriteriaPath,
  type DiscoveredListing,
  type SearchCriteria,
} from "../../../../scripts/jobagent/discovery";
import { isLegalStatusTransition, recordStatus } from "../../../../scripts/jobagent/package";
import { listApplications } from "../../../../scripts/jobagent/index";

let savedApps: string | undefined;
let savedSeed: string | undefined;
const tmpDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

beforeEach(() => {
  savedApps = process.env.JOBAGENT_APPLICATIONS_DIR;
  savedSeed = process.env.OPENSIDEBAR_SEED_DIR;
  process.env.JOBAGENT_APPLICATIONS_DIR = tempDir("jobagent-apps-");
  process.env.OPENSIDEBAR_SEED_DIR = tempDir("jobagent-seed-");
});

afterEach(() => {
  if (savedApps === undefined) delete process.env.JOBAGENT_APPLICATIONS_DIR;
  else process.env.JOBAGENT_APPLICATIONS_DIR = savedApps;
  if (savedSeed === undefined) delete process.env.OPENSIDEBAR_SEED_DIR;
  else process.env.OPENSIDEBAR_SEED_DIR = savedSeed;
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Synthetic criteria — fabricated, no PII.
const criteria: SearchCriteria = {
  schemaVersion: 1,
  roles: ["AI Product Engineer", "Agent Engineer"],
  keywords: ["typescript", "llm"],
  excludeKeywords: ["staffing agency", "unpaid"],
  locations: ["Austria", "Vienna", "Europe"],
  remoteOk: true,
  boards: [
    { name: "Example Board", searchUrl: "https://board.example/search?q=ai+engineer" },
  ],
  maxPackagesPerRun: 5,
};

const listing = (overrides: Partial<DiscoveredListing> = {}): DiscoveredListing => ({
  title: "AI Product Engineer",
  company: "Acme Robotics",
  url: "https://board.example/jobs/ai-product-engineer-123",
  location: "Remote (Europe)",
  snippet: "Build LLM agents in TypeScript.",
  source: "Example Board",
  ...overrides,
});

describe("parseSearchCriteria / loadSearchCriteria", () => {
  test("valid criteria parse; violations throw precisely", () => {
    expect(parseSearchCriteria(criteria).roles).toHaveLength(2);
    expect(() => parseSearchCriteria({ ...criteria, schemaVersion: 2 })).toThrow(/schemaVersion/);
    expect(() => parseSearchCriteria({ ...criteria, roles: [] })).toThrow(/roles/);
    expect(() => parseSearchCriteria({ ...criteria, boards: [] })).toThrow(/boards/);
    expect(() =>
      parseSearchCriteria({ ...criteria, boards: [{ name: "x" }] }),
    ).toThrow(/searchUrl/);
  });

  test("loadSearchCriteria reads the seed path and hints on absence", () => {
    expect(() => loadSearchCriteria()).toThrow(/no search criteria at .*search-criteria\.json/);
    const path = resolveSearchCriteriaPath();
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify(criteria), "utf8");
    expect(loadSearchCriteria().boards[0].name).toBe("Example Board");
  });
});

describe("assessListing", () => {
  test("role + remote location match with transparent reasons", () => {
    const a = assessListing(listing(), criteria);
    expect(a.match).toBe(true);
    expect(a.reasons.join(" ")).toContain('role match: "AI Product Engineer"');
    expect(a.reasons.join(" ")).toContain("location ok");
    expect(a.reasons.join(" ")).toContain('keyword: "typescript"');
  });

  test("exclude keyword hard-rejects", () => {
    const a = assessListing(
      listing({ snippet: "Join our staffing agency network" }),
      criteria,
    );
    expect(a.match).toBe(false);
    expect(a.reasons[0]).toContain("staffing agency");
  });

  test("no role in the title rejects", () => {
    const a = assessListing(listing({ title: "Senior Accountant" }), criteria);
    expect(a.match).toBe(false);
    expect(a.reasons[0]).toContain("none of the target roles");
  });

  test("out-of-criteria location rejects; missing location is a risk, not a reject", () => {
    expect(
      assessListing(listing({ location: "On-site, Tokyo" }), criteria).match,
    ).toBe(false);
    const absent = assessListing(listing({ location: undefined }), criteria);
    expect(absent.match).toBe(true);
    expect(absent.risks[0]).toContain("location not shown");
  });
});

// The first live sweep queued nine listings; six were in geographies the
// operator cannot work from, because "remote" was tested as a bare substring.
// These are the exact location strings those listings carried.
describe("assessListing — remote qualifiers (live-sweep regressions)", () => {
  const verdict = (location: string) => assessListing(listing({ location }), criteria);

  test.each([
    "Remote (US)",
    "REMOTE (US ONLY, LA/SF preferred)",
    "Bengaluru, India (REMOTE)",
    "Remote (North America)",
  ])("out-of-scope remote qualifier rejects: %s", (location) => {
    expect(verdict(location).match).toBe(false);
  });

  test.each([
    "REMOTE (EU, Switzerland, Norway)",
    "Remote",
    "SF or Remote",
    "NYC or Remote",
    "Remote — Europe only",
    "Vienna (Remote)",
  ])("in-scope or unqualified remote matches: %s", (location) => {
    expect(verdict(location).match).toBe(true);
  });

  test("an unrecognised qualifier is a risk, never a silent reject", () => {
    const a = verdict("Remote (UTC+3)");
    expect(a.match).toBe(true);
    expect(a.risks.join(" ")).toContain("confirm eligibility");
  });

  test('"Europe" expands to its countries, so a country-only listing matches', () => {
    // The sweep rejected a Stockholm posting because "Sweden" is not the
    // literal string "Europe".
    expect(verdict("Stockholm, Sweden").match).toBe(true);
    expect(verdict("Remote (Sweden)").match).toBe(true);
  });

  test("remoteOk:false rejects remote regardless of qualifier", () => {
    const strict: SearchCriteria = { ...criteria, remoteOk: false };
    expect(assessListing(listing({ location: "Remote (EU)" }), strict).match).toBe(false);
    expect(assessListing(listing({ location: "Vienna" }), strict).match).toBe(true);
  });
});

describe("recordDiscovery", () => {
  test("creates a reviewing package + audit record; lifecycle starts legally", () => {
    const out = recordDiscovery(listing(), criteria, {
      now: new Date("2026-07-18T12:00:00Z"),
    });
    expect(out.outcome).toBe("created");
    if (out.outcome !== "created") return;
    expect(out.name).toBe("acme-robotics-ai-product-engineer");

    const pkg = JSON.parse(
      readFileSync(join(out.dir, "application-package.json"), "utf8"),
    );
    expect(pkg).toMatchObject({
      schemaVersion: 1,
      company: "Acme Robotics",
      roleTitle: "AI Product Engineer",
      sourceUrl: listing().url,
      dateFound: "2026-07-18",
      status: "reviewing",
    });
    const audit = JSON.parse(readFileSync(join(out.dir, "discovery.json"), "utf8"));
    expect(audit.listing.source).toBe("Example Board");
    expect(audit.assessment.match).toBe(true);

    // It shows up in the workspace listing and obeys the lifecycle.
    expect(listApplications()).toEqual([
      expect.objectContaining({ name: out.name, status: "reviewing" }),
    ]);
    expect(isLegalStatusTransition("reviewing", "ready")).toBe(true);
    expect(recordStatus(out.dir, "ready").status).toBe("ready");
    expect(() => recordStatus(out.dir, "applied")).toThrow(/illegal/);
  });

  test("dedupes by normalized URL and by slug", () => {
    expect(recordDiscovery(listing(), criteria).outcome).toBe("created");
    // Same URL with trailing slash + different title → duplicate by URL.
    const byUrl = recordDiscovery(
      listing({ title: "Agent Engineer", url: listing().url + "/" }),
      criteria,
    );
    expect(byUrl.outcome).toBe("duplicate");
    // Same company+title, different URL → duplicate by slug.
    const bySlug = recordDiscovery(
      listing({ url: "https://other.example/jobs/999" }),
      criteria,
    );
    expect(bySlug.outcome).toBe("duplicate");
  });

  test("rejected listings create nothing", () => {
    const out = recordDiscovery(listing({ title: "Senior Accountant" }), criteria);
    expect(out.outcome).toBe("rejected");
    expect(listApplications()).toHaveLength(0);
  });

  test("missing required listing fields throw", () => {
    expect(() =>
      recordDiscovery(listing({ url: "" }), criteria),
    ).toThrow(/url is required/);
  });

  test("risk flags carry onto the package", () => {
    const out = recordDiscovery(listing({ location: undefined }), criteria);
    expect(out.outcome).toBe("created");
    if (out.outcome !== "created") return;
    const pkg = JSON.parse(
      readFileSync(join(out.dir, "application-package.json"), "utf8"),
    );
    expect(pkg.risks[0]).toContain("location not shown");
  });
});

describe("listingSlug / findDuplicate", () => {
  test("slug is filesystem-safe and capped", () => {
    expect(listingSlug({ company: "Größe & Söhne GmbH!", title: "AI/ML Eng." })).toBe(
      "gr-e-s-hne-gmbh-ai-ml-eng",
    );
    expect(
      listingSlug({ company: "A".repeat(80), title: "B".repeat(80) }).length,
    ).toBeLessThanOrEqual(60);
  });

  test("findDuplicate returns null on an empty workspace", () => {
    expect(findDuplicate(listing())).toBeNull();
  });
});
