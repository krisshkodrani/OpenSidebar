/**
 * ATS adapters (RFC LP-23 §1) — fixture-driven, fully offline.
 *
 * Fixtures under fixtures/ats/ are trimmed captures of REAL public payloads
 * (recorded 2026-07-23 during the phase-0 spike), so these tests pin the
 * adapters to what the ATSes actually serve, not to what their docs imply.
 * The failure contract matters as much as the happy path: a malformed or
 * missing payload must degrade to null (next tier), never to invented fields.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { extractAppData } from "../../../../scripts/jobagent/ats/ashby";
import { listingFromJsonLd } from "../../../../scripts/jobagent/ats/generic";
import { parseLeverApplyPage } from "../../../../scripts/jobagent/ats/lever";
import {
  matchAdapter,
  resolveListing,
  resolveQuestions,
  type FetchLike,
} from "../../../../scripts/jobagent/ats/index";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "ats");
const fixture = (name: string) => readFileSync(join(FIXTURES, name), "utf8");

/** A fetch that serves canned bodies by URL substring and records requests. */
function fakeFetch(routes: Array<[string, string]>): {
  fetchImpl: FetchLike;
  requested: string[];
} {
  const requested: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    const hit = routes.find(([needle]) => url.includes(needle));
    if (!hit) return new Response("not found", { status: 404 });
    return new Response(hit[1], { status: 200 });
  }) as FetchLike;
  return { fetchImpl, requested };
}

const offline: FetchLike = (async () => {
  throw new Error("no network in tests");
}) as FetchLike;

/* ── URL recognition ──────────────────────────────────────── */

describe("matchAdapter", () => {
  test.each([
    ["https://jobs.ashbyhq.com/ashby/7458d4e9-da2e-47bd-98cb-adfda43d42b2/application", "ashby"],
    ["https://www.ashbyhq.com/careers?ashby_jid=7458d4e9-da2e-47bd-98cb-adfda43d42b2", "ashby"],
    ["https://boards.greenhouse.io/gitlab/jobs/8503792002", "greenhouse"],
    ["https://job-boards.greenhouse.io/embed/job_app?for=refurbed&token=4870315101", "greenhouse"],
    ["https://jobs.lever.co/spotify/890b2c0f-f46f-4a4b-bb73-3a6af6e0edd5/apply", "lever"],
    ["https://jobs.eu.lever.co/acme/890b2c0f-f46f-4a4b-bb73-3a6af6e0edd5", "lever"],
    ["https://example.com/careers/some-role", null],
    ["not a url", null],
  ])("%s → %s", (url, adapter) => {
    expect(matchAdapter(url)).toBe(adapter);
  });
});

/* ── Ashby ────────────────────────────────────────────────── */

describe("ashby", () => {
  const boardJson = fixture("ashby-job-board.json");
  const EM_URL =
    "https://www.ashbyhq.com/careers?ashby_jid=7458d4e9-da2e-47bd-98cb-adfda43d42b2";

  test("resolves the real EM-EU posting from the job-board API", async () => {
    const { fetchImpl } = fakeFetch([["posting-api/job-board/ashby", boardJson]]);
    const listing = await resolveListing(EM_URL, fetchImpl);

    expect(listing?.tier).toBe("ashby-api");
    expect(listing?.title).toBe("Engineering Manager - EU");
    expect(listing?.company).toBe("ashby");
    expect(listing?.location).toContain("Remote");
    expect(listing?.applyUrl).toMatch(/^https:\/\//);
  });

  test("falls back to the page's __appData when the API misses the job", async () => {
    const appData = fixture("ashby-appdata.json");
    const page = `<html><script>window.__appData = ${appData.trim()};</script></html>`;
    const { fetchImpl } = fakeFetch([
      ["posting-api/job-board/ashby", JSON.stringify({ jobs: [] })],
      ["jobs.ashbyhq.com/ashby/", page],
    ]);
    const listing = await resolveListing(EM_URL, fetchImpl);

    expect(listing?.tier).toBe("ashby-page");
    expect(listing?.title).toBe("Engineering Manager - EU");
    // The page knows the organization's display name; the API does not.
    expect(listing?.company).toBe("Ashby");
  });

  test("extractAppData brace-counts through the real embedded object", () => {
    const appData = fixture("ashby-appdata.json");
    const html = `prefix window.__appData = ${appData.trim()}; </script> suffix`;
    const data = extractAppData(html);
    expect((data?.posting as { title?: string })?.title).toBe("Engineering Manager - EU");
  });

  test("has no questions tier — Ashby forms are browser-only", async () => {
    const { fetchImpl, requested } = fakeFetch([]);
    const result = await resolveQuestions(EM_URL, fetchImpl);
    expect(result).toBeNull();
    expect(requested).toEqual([]); // no speculative fetches either
  });
});

/* ── Greenhouse ───────────────────────────────────────────── */

describe("greenhouse", () => {
  const jobJson = fixture("greenhouse-job-questions.json");
  const URL_PATH = "https://boards.greenhouse.io/gitlab/jobs/8503792002";

  test("listing from the job payload", async () => {
    const { fetchImpl } = fakeFetch([["boards-api.greenhouse.io", jobJson]]);
    const listing = await resolveListing(URL_PATH, fetchImpl);

    expect(listing?.tier).toBe("greenhouse-api");
    expect(listing?.title).toContain("Account Executive");
    expect(listing?.company).toBe("GitLab");
    expect(listing?.applyUrl).toContain("gitlab");
  });

  test("questions arrive with kinds, required flags, AND select options", async () => {
    const { fetchImpl, requested } = fakeFetch([["boards-api.greenhouse.io", jobJson]]);
    const result = await resolveQuestions(URL_PATH, fetchImpl);

    expect(result?.tier).toBe("greenhouse-api");
    expect(requested[0]).toContain("questions=true");
    const byLabel = new Map(result!.questions.map((q) => [q.label, q]));

    expect(byLabel.get("First Name")).toMatchObject({ kind: "text", required: true });
    expect(byLabel.get("Resume/CV")).toMatchObject({ kind: "file", required: true });
    // The load-bearing LP-23 contract: options survive to drafting. The real
    // payload's country select carries every country.
    const country = byLabel.get("What is your current country of residence?");
    expect(country?.kind).toBe("select");
    expect(country?.options?.length).toBeGreaterThan(150);
    const visa = [...byLabel.keys()].find((l) => l.includes("sponsorship"));
    expect(byLabel.get(visa!)?.options?.length).toBeGreaterThanOrEqual(7);
  });

  test("structurally-separated demographic questions carry the flag", async () => {
    // The real payload has empty eeoc questions; graft one in to pin the path.
    const job = JSON.parse(jobJson);
    job.compliance = [
      {
        type: "eeoc",
        questions: [
          {
            label: "Gender",
            required: false,
            fields: [{ type: "multi_value_single_select", values: [{ label: "…" }] }],
          },
        ],
      },
    ];
    const { fetchImpl } = fakeFetch([["boards-api.greenhouse.io", JSON.stringify(job)]]);
    const result = await resolveQuestions(URL_PATH, fetchImpl);
    const gender = result!.questions.find((q) => q.label === "Gender");
    expect(gender?.demographic).toBe(true);
    // And the ordinary questions are NOT flagged.
    expect(result!.questions.find((q) => q.label === "Email")?.demographic).toBeUndefined();
  });

  test("the embed form (?for=…&token=…) resolves the same job", async () => {
    const { fetchImpl, requested } = fakeFetch([["boards-api.greenhouse.io", jobJson]]);
    await resolveListing(
      "https://job-boards.greenhouse.io/embed/job_app?for=gitlab&token=8503792002",
      fetchImpl,
    );
    expect(requested[0]).toContain("/boards/gitlab/jobs/8503792002");
  });
});

/* ── Lever ────────────────────────────────────────────────── */

describe("lever", () => {
  const postings = JSON.parse(fixture("lever-postings.json"));
  const applyHtml = fixture("lever-apply-page.html");
  const URL_PATH = "https://jobs.lever.co/spotify/890b2c0f-f46f-4a4b-bb73-3a6af6e0edd5";

  test("listing from the individual-posting API", async () => {
    const { fetchImpl } = fakeFetch([["api.lever.co/v0/postings/spotify", JSON.stringify(postings[0])]]);
    const listing = await resolveListing(URL_PATH, fetchImpl);

    expect(listing?.tier).toBe("lever-api");
    expect(listing?.title).toBe(postings[0].text);
    expect(listing?.company).toBe("spotify");
    expect(listing?.applyUrl).toContain("/apply");
  });

  test("questions parsed from the real server-rendered apply page", async () => {
    const { fetchImpl } = fakeFetch([["jobs.lever.co/spotify/", applyHtml]]);
    const result = await resolveQuestions(URL_PATH, fetchImpl);

    expect(result?.tier).toBe("lever-page");
    const byLabel = new Map(result!.questions.map((q) => [q.label, q]));
    expect(byLabel.get("Resume/CV")).toMatchObject({ kind: "file", required: true });
    expect(byLabel.get("Full name")).toMatchObject({ kind: "text", required: true });
    expect(byLabel.get("LinkedIn URL")?.required).toBeUndefined();
    // The checkbox group renders as a select with its options.
    const pronouns = byLabel.get("Pronouns");
    expect(pronouns?.kind).toBe("select");
    expect(pronouns?.options?.length).toBeGreaterThan(0);
  });

  test("parseLeverApplyPage yields nothing on a page without the form", () => {
    expect(parseLeverApplyPage("<html><body><h1>404</h1></body></html>")).toEqual([]);
  });
});

/* ── Generic JSON-LD tier ─────────────────────────────────── */

describe("generic JSON-LD", () => {
  const page = `<html><head><script type="application/ld+json">
    {"@context":"https://schema.org","@type":"JobPosting","title":"Staff Engineer",
     "hiringOrganization":{"@type":"Organization","name":"Acme"},
     "jobLocationType":"TELECOMMUTE",
     "jobLocation":[{"address":{"addressLocality":"Vienna","addressCountry":"AT"}}],
     "description":"<p>Build the thing.</p>","url":"https://acme.example/apply"}
  </script></head></html>`;

  test("an unrecognised host resolves via embedded JobPosting", async () => {
    const { fetchImpl } = fakeFetch([["acme.example/careers", page]]);
    const listing = await resolveListing("https://acme.example/careers/staff", fetchImpl);

    expect(listing?.tier).toBe("jsonld");
    expect(listing?.title).toBe("Staff Engineer");
    expect(listing?.company).toBe("Acme");
    expect(listing?.location).toBe("Remote; Vienna, AT");
    expect(listing?.applyUrl).toBe("https://acme.example/apply");
  });

  test("malformed JSON-LD is skipped, never guessed at", () => {
    expect(
      listingFromJsonLd(
        '<script type="application/ld+json">{not json}</script>',
        "https://x.example/",
      ),
    ).toBeNull();
  });

  test("a page with no JobPosting resolves to null (browser tier next)", async () => {
    const { fetchImpl } = fakeFetch([["plain.example", "<html><body>hi</body></html>"]]);
    expect(await resolveListing("https://plain.example/jobs/1", fetchImpl)).toBeNull();
  });
});

/* ── Failure contract ─────────────────────────────────────── */

describe("degradation", () => {
  test("network failure resolves to null at every tier — the caller falls back", async () => {
    expect(
      await resolveListing("https://jobs.lever.co/x/890b2c0f-f46f-4a4b-bb73-3a6af6e0edd5", offline),
    ).toBeNull();
    expect(
      await resolveQuestions("https://boards.greenhouse.io/x/jobs/1", offline),
    ).toBeNull();
    expect(await resolveListing("https://anything.example/role", offline)).toBeNull();
  });

  test("a recognised adapter whose API 404s still tries the generic tier", async () => {
    // Greenhouse API down, but the posting page itself carries JSON-LD.
    const page = `<script type="application/ld+json">{"@type":"JobPosting","title":"T","hiringOrganization":{"name":"C"}}</script>`;
    const { fetchImpl } = fakeFetch([["boards.greenhouse.io/gitlab", page]]);
    const listing = await resolveListing("https://boards.greenhouse.io/gitlab/jobs/1", fetchImpl);
    expect(listing?.tier).toBe("jsonld");
  });
});
