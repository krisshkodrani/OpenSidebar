/**
 * JobAgent ingest / assess / questions (RFC LP-22) — the run manager's
 * read-only page operations, against a FAKE bridge (no sockets).
 *
 * The property under test throughout is that ingest is a new way *in*, never a
 * new set of rules: a URL goes through the same `recordDiscovery` path a board
 * sweep uses, so criteria matching, dedupe, and rejection cannot diverge.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  RunManager,
  type ConsoleBridge,
  type RunManagerDeps,
} from "../../../../scripts/jobagent-console/runs";
import type { ConsoleEvent } from "../../../../scripts/jobagent-console/events";

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
  process.env.OPENSIDEBAR_SEED_DIR = tempDir("ingest-seed-");
  process.env.JOBAGENT_APPLICATIONS_DIR = tempDir("ingest-apps-");
});
afterEach(() => {
  if (savedApps === undefined) delete process.env.JOBAGENT_APPLICATIONS_DIR;
  else process.env.JOBAGENT_APPLICATIONS_DIR = savedApps;
  if (savedSeed === undefined) delete process.env.OPENSIDEBAR_SEED_DIR;
  else process.env.OPENSIDEBAR_SEED_DIR = savedSeed;
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Criteria that accept a remote "AI Engineer". */
function seedCriteria(): void {
  const dir = join(process.env.OPENSIDEBAR_SEED_DIR!, "jobagent");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "search-criteria.json"),
    JSON.stringify({
      schemaVersion: 1,
      roles: ["AI Engineer"],
      boards: [{ name: "Board", searchUrl: "https://board.example/s" }],
      remoteOk: true,
    }),
    "utf8",
  );
}

function seedPackage(name = "acme-ai-engineer"): void {
  const dir = join(process.env.JOBAGENT_APPLICATIONS_DIR!, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "application-package.json"),
    JSON.stringify({
      schemaVersion: 1,
      company: "Acme",
      roleTitle: "AI Engineer",
      sourceUrl: "https://board.example/jobs/1",
      status: "reviewing",
    }),
    "utf8",
  );
}

interface World {
  manager: RunManager;
  replies: unknown[];
  events: ConsoleEvent[];
}

function makeWorld(): World {
  const replies: unknown[] = [];
  const events: ConsoleEvent[] = [];
  const bridge: ConsoleBridge = {
    get connected() {
      return true;
    },
    async call() {
      const next = replies.shift();
      return (next ?? { status: "ok", result: "done" }) as never;
    },
    async close() {},
  };
  const deps: RunManagerDeps = {
    createBridge: async () => bridge,
    spawnPi: () => ({ onLine: () => {}, onExit: () => {}, kill: () => {} }),
    startCvServer: async () => ({ url: "http://127.0.0.1:0/cv.pdf", close: async () => {} }),
    now: () => 1_000_000,
    emit: (event) => events.push(event),
    appendAudit: () => {},
    probeTraceServer: async () => true,
    appendRunLog: () => {},
    // Offline: the LP-23 parse-first tiers must fail fast and fall back to
    // the fake bridge, never attempt real network.
    atsFetch: async () => {
      throw new Error("no network in tests");
    },
  };
  return { manager: new RunManager(deps), replies, events };
}

const listingReply = (over: Record<string, unknown> = {}) => ({
  status: "ok",
  result: {
    title: "AI Engineer",
    company: "Acme",
    location: "Remote",
    snippet: "Build agents.",
    applyUrl: "https://board.example/apply/1",
    ...over,
  },
});

const appDir = (name: string) => join(process.env.JOBAGENT_APPLICATIONS_DIR!, name);
const readJson = (name: string, file: string) =>
  JSON.parse(readFileSync(join(appDir(name), file), "utf8"));

describe("assess", () => {
  test("scores a posting and writes nothing at all", async () => {
    seedCriteria();
    const world = makeWorld();
    await world.manager.start();
    world.replies.push(listingReply());

    const reply = (await world.manager.assessUrl("https://board.example/jobs/1")) as {
      status: number;
      body: { match: boolean; reasons: string[]; applyUrl: string };
    };

    expect(reply.status).toBe(200);
    expect(reply.body.match).toBe(true);
    expect(reply.body.reasons.join(" ")).toContain("AI Engineer");
    expect(reply.body.applyUrl).toBe("https://board.example/apply/1");
    expect(existsSync(appDir("acme-ai-engineer"))).toBe(false);
  });

  test("an off-criteria title is rejected with the reason", async () => {
    seedCriteria();
    const world = makeWorld();
    await world.manager.start();
    world.replies.push(listingReply({ title: "Warehouse Picker" }));

    const reply = (await world.manager.assessUrl("https://board.example/jobs/9")) as {
      status: number;
      body: { match: boolean; reasons: string[] };
    };
    expect(reply.body.match).toBe(false);
    expect(reply.body.reasons.join(" ")).toContain("none of the target roles");
  });

  test("without criteria on disk it refuses rather than matching everything", async () => {
    const world = makeWorld();
    await world.manager.start();

    const reply = (await world.manager.assessUrl("https://board.example/jobs/1")) as {
      status: number;
    };
    expect(reply.status).toBe(409);
  });

  test("refuses while a run holds the bridge instead of queueing silently", async () => {
    seedCriteria();
    seedPackage();
    const world = makeWorld();
    await world.manager.start();
    // Any active run owns the bridge; a "quick assess" must not block on a fill.
    world.manager.startDiscovery();

    const reply = (await world.manager.assessUrl("https://board.example/jobs/1")) as {
      status: number;
      body: { error: string };
    };
    expect(reply.status).toBe(409);
    expect(reply.body.error).toContain("bridge is busy");
  });
});

describe("ingest", () => {
  test("creates a reviewing package and keeps the source provenance", async () => {
    seedCriteria();
    const world = makeWorld();
    await world.manager.start();
    world.replies.push(listingReply());

    const reply = (await world.manager.ingestUrl("https://board.example/jobs/1", {
      source: "websearch",
    })) as { status: number; body: { outcome: string; name: string } };

    expect(reply.status).toBe(200);
    expect(reply.body.outcome).toBe("created");
    expect(reply.body.name).toBe("acme-ai-engineer");
    expect(readJson("acme-ai-engineer", "application-package.json").status).toBe("reviewing");
    expect(readJson("acme-ai-engineer", "discovery.json").listing.source).toBe("websearch");
  });

  test("an off-criteria posting is rejected, and no package appears", async () => {
    seedCriteria();
    const world = makeWorld();
    await world.manager.start();
    world.replies.push(listingReply({ title: "Warehouse Picker" }));

    const reply = (await world.manager.ingestUrl("https://board.example/jobs/9")) as {
      body: { outcome: string };
    };
    expect(reply.body.outcome).toBe("rejected");
    expect(existsSync(appDir("warehouse-picker"))).toBe(false);
  });

  test("re-ingesting the same URL is a duplicate, not a second package", async () => {
    seedCriteria();
    const world = makeWorld();
    await world.manager.start();
    world.replies.push(listingReply(), listingReply());

    await world.manager.ingestUrl("https://board.example/jobs/1");
    const second = (await world.manager.ingestUrl("https://board.example/jobs/1")) as {
      body: { outcome: string; existing: { name: string } };
    };

    expect(second.body.outcome).toBe("duplicate");
    expect(second.body.existing.name).toBe("acme-ai-engineer");
  });

  test("no title is a 422 — there is nothing to assess against", async () => {
    seedCriteria();
    const world = makeWorld();
    await world.manager.start();
    world.replies.push(listingReply({ title: "" }));

    const reply = (await world.manager.ingestUrl("https://board.example/jobs/1")) as {
      status: number;
      body: { error: string };
    };
    expect(reply.status).toBe(422);
    expect(reply.body.error).toContain("job title");
  });

  test("no company falls back to host+hash naming and flags the inference", async () => {
    seedCriteria();
    const world = makeWorld();
    await world.manager.start();
    world.replies.push(listingReply({ company: "" }));

    const reply = (await world.manager.ingestUrl("https://board.example/jobs/1")) as {
      status: number;
      body: { name: string; inferredCompany: string };
    };
    expect(reply.status).toBe(200);
    expect(reply.body.name).toMatch(/^board-example-[0-9a-f]{6}$/);
    // Recorded as the host — traceable, and loudly flagged — never invented.
    expect(reply.body.inferredCompany).toBe("board.example");
    expect(readJson(reply.body.name, "application-package.json").company).toBe("board.example");
  });

  test("records the form URL when the posting links one elsewhere", async () => {
    seedCriteria();
    const world = makeWorld();
    await world.manager.start();
    world.replies.push(listingReply({ applyUrl: "https://ats.example/apply/1" }));

    await world.manager.ingestUrl("https://board.example/jobs/1");

    // Without this the kit's formUrl falls back to the POSTING url and a fill
    // opens the job board, where there is no form to fill.
    const pkg = readJson("acme-ai-engineer", "application-package.json");
    expect(pkg.sourceUrl).toBe("https://board.example/jobs/1");
    expect(pkg.formUrl).toBe("https://ats.example/apply/1");
  });

  test("a form URL equal to the posting is not recorded twice", async () => {
    seedCriteria();
    const world = makeWorld();
    await world.manager.start();
    world.replies.push(listingReply({ applyUrl: "https://board.example/jobs/1" }));

    await world.manager.ingestUrl("https://board.example/jobs/1");
    expect(readJson("acme-ai-engineer", "application-package.json").formUrl).toBeUndefined();
  });

  test("an explicit name overrides the derived one", async () => {
    seedCriteria();
    const world = makeWorld();
    await world.manager.start();
    world.replies.push(listingReply());

    const reply = (await world.manager.ingestUrl("https://board.example/jobs/1", {
      name: "my-package",
    })) as { body: { name: string } };
    expect(reply.body.name).toBe("my-package");
    expect(existsSync(appDir("my-package"))).toBe(true);
  });
});

describe("parse-first tiers (LP-23)", () => {
  /** A Greenhouse payload the ATS adapter can serve without any bridge. */
  const ghJob = JSON.stringify({
    title: "AI Engineer",
    company_name: "Acme",
    location: { name: "Remote" },
    content: "Build agents.",
    absolute_url: "https://boards.greenhouse.io/acme/jobs/123",
    questions: [
      { label: "Email", required: true, fields: [{ type: "input_text" }] },
      {
        label: "Country",
        required: true,
        fields: [
          { type: "multi_value_single_select", values: [{ label: "Austria" }, { label: "Spain" }] },
        ],
      },
    ],
  });
  const GH_URL = "https://boards.greenhouse.io/acme/jobs/123";

  function withAtsWorld(): World {
    const world = makeWorld();
    world.manager["deps"].atsFetch = (async () =>
      new Response(ghJob, { status: 200 })) as never;
    return world;
  }

  test("assess resolves via the adapter with NO bridge at all", async () => {
    seedCriteria();
    const world = withAtsWorld();
    // Deliberately no manager.start(): tier 1 must not need the bridge.
    const reply = (await world.manager.assessUrl(GH_URL)) as {
      status: number;
      body: { match: boolean; tier: string };
    };
    expect(reply.status).toBe(200);
    expect(reply.body.tier).toBe("greenhouse-api");
    expect(reply.body.match).toBe(true);
  });

  test("assess works DURING an active run when the adapter hits", async () => {
    seedCriteria();
    const world = withAtsWorld();
    await world.manager.start();
    world.manager.startDiscovery(); // the bridge is now owned by the run
    const reply = (await world.manager.assessUrl(GH_URL)) as { status: number };
    // Before LP-23 this was a 409 "bridge is busy" — the adapter tier removed
    // the contention entirely.
    expect(reply.status).toBe(200);
  });

  test("questions via the adapter keep select options end to end", async () => {
    seedPackage();
    const world = withAtsWorld();
    const reply = (await world.manager.extractFormQuestions(
      "acme-ai-engineer",
      GH_URL,
    )) as { status: number; body: { tier: string } };
    expect(reply.status).toBe(200);
    expect(reply.body.tier).toBe("greenhouse-api");
    const written = readJson("acme-ai-engineer", "questions.json");
    expect(written.find((q: { label: string }) => q.label === "Country").options).toEqual([
      "Austria",
      "Spain",
    ]);
  });

  test("an unrecognised URL still falls back to the browser tier", async () => {
    seedCriteria();
    const world = makeWorld(); // offline atsFetch → tiers 1-2 fail fast
    await world.manager.start();
    world.replies.push(listingReply());
    const reply = (await world.manager.assessUrl("https://board.example/jobs/1")) as {
      status: number;
      body: { tier: string };
    };
    expect(reply.status).toBe(200);
    expect(reply.body.tier).toBe("browser");
  });
});

describe("questions", () => {
  const formReply = (over: Record<string, unknown> = {}) => ({
    status: "ok",
    result: {
      questions: [
        { label: "Name", kind: "text", required: true },
        { label: "Salary Expectation", kind: "text", required: true },
      ],
      morePages: false,
      ...over,
    },
  });

  test("writes questions.json into the package dir", async () => {
    seedPackage();
    const world = makeWorld();
    await world.manager.start();
    world.replies.push(formReply());

    const reply = (await world.manager.extractFormQuestions(
      "acme-ai-engineer",
      "https://board.example/apply/1",
    )) as { status: number; body: { count: number } };

    expect(reply.status).toBe(200);
    expect(reply.body.count).toBe(2);
    expect(
      readJson("acme-ai-engineer", "questions.json").map((q: { label: string }) => q.label),
    ).toEqual(["Name", "Salary Expectation"]);
  });

  test("a multi-page form is a 422 and writes nothing", async () => {
    seedPackage();
    const world = makeWorld();
    await world.manager.start();
    world.replies.push(formReply({ morePages: true, pageNote: "Step 1 of 3" }));

    const reply = (await world.manager.extractFormQuestions(
      "acme-ai-engineer",
      "https://board.example/apply/1",
    )) as { status: number; body: { pageNote: string } };

    expect(reply.status).toBe(422);
    expect(reply.body.pageNote).toBe("Step 1 of 3");
    // The whole point: no half-form kit is left behind to be drafted from.
    expect(existsSync(join(appDir("acme-ai-engineer"), "questions.json"))).toBe(false);
  });

  test("an extraction failure is a 502, not a silent empty question set", async () => {
    seedPackage();
    const world = makeWorld();
    await world.manager.start();
    world.replies.push({ status: "error", reason: "page never loaded" });

    const reply = (await world.manager.extractFormQuestions(
      "acme-ai-engineer",
      "https://board.example/apply/1",
    )) as { status: number; body: { error: string } };

    expect(reply.status).toBe(502);
    expect(reply.body.error).toContain("page never loaded");
  });
});
