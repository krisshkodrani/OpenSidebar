/**
 * JobAgent daemon (pi Phase 9, v0) — offline route tests.
 *
 * A real server instance on port 0 over a temp seed dir; requests via raw
 * node:http (happy-dom's fetch enforces same-origin — seed-kit.test.ts
 * convention). Covers the queue/detail/status/criteria routes, the ratchet
 * 409 surface, and the CSRF/Host guards.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  startConsoleServer,
  type ConsoleServer,
} from "../../../../scripts/jobagent-console/server";

let savedApps: string | undefined;
let savedSeed: string | undefined;
let server: ConsoleServer | null = null;
const tmpDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

interface HttpReply {
  status: number;
  body: any;
}

function call(
  port: number,
  method: string,
  path: string,
  payload?: unknown,
  headers: Record<string, string> = {},
): Promise<HttpReply> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: {
          "Content-Type": "application/json",
          "X-JobAgent-Console": "1",
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode ?? 0,
            body: text ? JSON.parse(text) : null,
          });
        });
      },
    );
    req.on("error", reject);
    if (payload !== undefined) req.write(JSON.stringify(payload));
    req.end();
  });
}

function writePackage(
  appsDir: string,
  name: string,
  overrides: Record<string, unknown> = {},
): string {
  const dir = join(appsDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "application-package.json"),
    JSON.stringify({
      schemaVersion: 1,
      company: "Acme",
      roleTitle: "AI Engineer",
      sourceUrl: "https://board.example/jobs/1",
      dateFound: "2026-07-18",
      status: "reviewing",
      ...overrides,
    }),
    "utf8",
  );
  return dir;
}

beforeEach(async () => {
  savedApps = process.env.JOBAGENT_APPLICATIONS_DIR;
  savedSeed = process.env.OPENSIDEBAR_SEED_DIR;
  process.env.OPENSIDEBAR_SEED_DIR = tempDir("console-seed-");
  process.env.JOBAGENT_APPLICATIONS_DIR = tempDir("console-apps-");
  server = await startConsoleServer(0);
});

afterEach(async () => {
  await server?.close();
  server = null;
  if (savedApps === undefined) delete process.env.JOBAGENT_APPLICATIONS_DIR;
  else process.env.JOBAGENT_APPLICATIONS_DIR = savedApps;
  if (savedSeed === undefined) delete process.env.OPENSIDEBAR_SEED_DIR;
  else process.env.OPENSIDEBAR_SEED_DIR = savedSeed;
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("guards", () => {
  test("mutations without the console header are rejected", async () => {
    const reply = await call(server!.port, "POST", "/api/applications/x/status", { status: "ready" }, { "X-JobAgent-Console": "" });
    expect(reply.status).toBe(403);
    expect(reply.body.error).toContain("X-JobAgent-Console");
  });

  test("non-loopback Host headers are rejected", async () => {
    const reply = await call(server!.port, "GET", "/api/health", undefined, { Host: "evil.example" });
    expect(reply.status).toBe(403);
  });

  test("foreign origins are rejected; loopback origins pass", async () => {
    const bad = await call(server!.port, "GET", "/api/health", undefined, { Origin: "https://evil.example" });
    expect(bad.status).toBe(403);
    const good = await call(server!.port, "GET", "/api/health", undefined, { Origin: "http://localhost:5173" });
    expect(good.status).toBe(200);
  });
});

describe("health + queue + detail", () => {
  test("health reports the sandboxed dirs", async () => {
    const reply = await call(server!.port, "GET", "/api/health");
    expect(reply.body.ok).toBe(true);
    expect(reply.body.applicationsDir).toBe(process.env.JOBAGENT_APPLICATIONS_DIR);
  });

  test("queue lists packages with file-presence flags", async () => {
    const dir = writePackage(process.env.JOBAGENT_APPLICATIONS_DIR!, "acme-ai-engineer", {
      risks: ["location not shown in listing — verify on the posting"],
    });
    writeFileSync(join(dir, "discovery.json"), JSON.stringify({ schemaVersion: 1 }), "utf8");

    const reply = await call(server!.port, "GET", "/api/queue");
    expect(reply.status).toBe(200);
    expect(reply.body.applications).toHaveLength(1);
    expect(reply.body.applications[0]).toMatchObject({
      name: "acme-ai-engineer",
      company: "Acme",
      status: "reviewing",
      hasDiscovery: true,
      hasKitDraft: false,
      hasRunConfig: false,
    });
    expect(reply.body.applications[0].risks[0]).toContain("location not shown");
  });

  test("application detail returns package + discovery; 404 when absent", async () => {
    const dir = writePackage(process.env.JOBAGENT_APPLICATIONS_DIR!, "acme-ai-engineer");
    writeFileSync(join(dir, "discovery.json"), JSON.stringify({ listing: { source: "T" } }), "utf8");

    const found = await call(server!.port, "GET", "/api/applications/acme-ai-engineer");
    expect(found.status).toBe(200);
    expect(found.body.package.company).toBe("Acme");
    expect(found.body.discovery.listing.source).toBe("T");
    expect(found.body.runConfig).toBeUndefined();

    const missing = await call(server!.port, "GET", "/api/applications/nope");
    expect(missing.status).toBe(404);
  });
});

describe("status transitions (ratchet authority)", () => {
  test("legal transition succeeds; illegal one is a 409 with the ratchet message", async () => {
    writePackage(process.env.JOBAGENT_APPLICATIONS_DIR!, "acme-ai-engineer");

    const legal = await call(server!.port, "POST", "/api/applications/acme-ai-engineer/status", { status: "ready" });
    expect(legal.status).toBe(200);
    expect(legal.body.status).toBe("ready");

    const illegal = await call(server!.port, "POST", "/api/applications/acme-ai-engineer/status", { status: "applied" });
    expect(illegal.status).toBe(409);
    expect(illegal.body.error).toContain("illegal status transition");
  });

  test("bad bodies and traversal names are 400s", async () => {
    expect((await call(server!.port, "POST", "/api/applications/x/status", {})).status).toBe(400);
    expect(
      (await call(server!.port, "POST", "/api/applications/..%2Fescape/status", { status: "ready" })).status,
    ).toBe(400);
  });
});

describe("criteria", () => {
  test("404 with setup hint before creation; PUT validates and persists; GET round-trips", async () => {
    const empty = await call(server!.port, "GET", "/api/criteria");
    expect(empty.status).toBe(404);
    expect(empty.body.error).toContain("search-criteria.json");

    const invalid = await call(server!.port, "PUT", "/api/criteria", { schemaVersion: 1, roles: [], boards: [] });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toContain("roles");

    const valid = {
      schemaVersion: 1,
      roles: ["AI Engineer"],
      boards: [{ name: "Board", searchUrl: "https://b.example/s" }],
      remoteOk: true,
    };
    const saved = await call(server!.port, "PUT", "/api/criteria", valid);
    expect(saved.status).toBe(200);

    const fetched = await call(server!.port, "GET", "/api/criteria");
    expect(fetched.status).toBe(200);
    expect(fetched.body.roles).toEqual(["AI Engineer"]);
  });
});

describe("index + events", () => {
  test("root serves the machine-readable route index, not a page", async () => {
    const reply = await call(server!.port, "GET", "/");
    expect(reply.status).toBe(200);
    expect(reply.body.service).toBe("jobagent-daemon");
    expect(reply.body.headless).toBe(true);
    // Every documented route maps to the CLI verb that fronts it.
    expect(reply.body.routes["GET /api/queue"]).toBe("queue");
    expect(reply.body.routes["POST /api/approvals/:id"]).toContain("decide");
  });

  test("SSE stream connects and receives broadcasts (raw chunk read)", async () => {
    const chunks: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port: server!.port, method: "GET", path: "/api/events" },
        (res) => {
          res.on("data", (c: Buffer) => {
            chunks.push(c.toString("utf8"));
            if (chunks.join("").includes("queue-changed")) {
              res.destroy();
              resolve();
            }
          });
          // Server got our stream — now broadcast.
          setTimeout(() => server!.events.broadcast({ type: "queue-changed", data: { x: 1 } }), 50);
        },
      );
      req.on("error", reject);
      req.end();
      setTimeout(() => reject(new Error("SSE timeout")), 5000);
    });
    const stream = chunks.join("");
    expect(stream).toContain(": connected");
    expect(stream).toContain("event: queue-changed");
    expect(stream).toContain('"x":1');
  });
});

describe("kit routes (v1)", () => {
  const library = {
    schemaVersion: 1,
    identity: { fullName: "Sam Example", email: "sam@example.test" },
    answers: [
      { tag: "how_heard", question: "How did you hear about us?", keywords: ["hear"], text: "Job board." },
    ],
    cvVariants: [{ name: "default", file: "applications/sample/cv.pdf" }],
  };

  test("answers 404s with hint, PUT validates, GET round-trips", async () => {
    const empty = await call(server!.port, "GET", "/api/answers");
    expect(empty.status).toBe(404);
    expect(empty.body.error).toContain("answer-library.json");

    const bad = await call(server!.port, "PUT", "/api/answers", { schemaVersion: 1 });
    expect(bad.status).toBe(400);

    expect((await call(server!.port, "PUT", "/api/answers", library)).status).toBe(200);
    expect((await call(server!.port, "GET", "/api/answers")).body.identity.fullName).toBe("Sam Example");
  });

  test("full kit flow: generate → edit → approve+promote → run-config + ready", async () => {
    writePackage(process.env.JOBAGENT_APPLICATIONS_DIR!, "acme-ai-engineer");
    await call(server!.port, "PUT", "/api/answers", library);

    // No library → 409 is covered by ordering; with library, generate:
    const generated = await call(server!.port, "POST", "/api/applications/acme-ai-engineer/kit-draft", {
      questions: [
        { label: "Email", kind: "text" },
        { label: "How did you hear about us?", kind: "text" },
        { label: "Favourite dinosaur", kind: "text" },
      ],
    });
    expect(generated.status).toBe(200);
    expect(generated.body.unresolved).toEqual(["Favourite dinosaur"]);

    // Approve blocked while unresolved.
    const blocked = await call(server!.port, "POST", "/api/applications/acme-ai-engineer/kit-approve", {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toContain("unresolved");

    // Human resolves via PUT.
    const edited = {
      ...generated.body,
      perField: generated.body.perField.map((f) =>
        f.source.kind === "todo" ? { ...f, answer: "Stegosaurus" } : f,
      ),
    };
    const saved = await call(server!.port, "PUT", "/api/applications/acme-ai-engineer/kit-draft", edited);
    expect(saved.status).toBe(200);
    expect(saved.body.unresolved).toEqual([]);

    // Approve + promote.
    const approved = await call(server!.port, "POST", "/api/applications/acme-ai-engineer/kit-approve", { promote: true });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("ready");

    const detail = await call(server!.port, "GET", "/api/applications/acme-ai-engineer");
    expect(detail.body.runConfig.expectedFieldValues).toContain("Stegosaurus");
    expect(detail.body.package.status).toBe("ready");
  });

  test("generate without a library is a 409 pointing at the answers verb", async () => {
    writePackage(process.env.JOBAGENT_APPLICATIONS_DIR!, "acme-ai-engineer");
    const reply = await call(server!.port, "POST", "/api/applications/acme-ai-engineer/kit-draft", {
      questions: [{ label: "Email" }],
    });
    expect(reply.status).toBe(409);
    expect(reply.body.error).toContain("answer library");
  });

  /* — LP-22: questions.json is the default drafting input — */

  test("drafting with no body uses the extracted questions.json", async () => {
    const dir = join(process.env.JOBAGENT_APPLICATIONS_DIR!, "acme-ai-engineer");
    writePackage(process.env.JOBAGENT_APPLICATIONS_DIR!, "acme-ai-engineer");
    await call(server!.port, "PUT", "/api/answers", library);
    writeFileSync(
      join(dir, "questions.json"),
      JSON.stringify([{ label: "Email", kind: "text" }, { label: "Salary Expectation" }]),
      "utf8",
    );

    // No `questions` in the body — this is the `questions` → `draft` chain.
    const reply = await call(
      server!.port,
      "POST",
      "/api/applications/acme-ai-engineer/kit-draft",
      {},
    );

    expect(reply.status).toBe(200);
    expect(reply.body.perField).toHaveLength(2);
    expect(reply.body.perField[0].answer).toBe("sam@example.test");
    // The judgment question stays a TODO — drafting never guesses a salary.
    expect(reply.body.unresolved).toEqual(["Salary Expectation"]);
  });

  test("PUT preserves proposed provenance and recomputes unreviewed (LP-23)", async () => {
    writePackage(process.env.JOBAGENT_APPLICATIONS_DIR!, "acme-ai-engineer");
    await call(server!.port, "PUT", "/api/answers", library);
    const generated = await call(server!.port, "POST", "/api/applications/acme-ai-engineer/kit-draft", {
      questions: [{ label: "Email", kind: "text" }, { label: "Why us?", kind: "longtext" }],
    });

    // The platform records a proposal (what `jobagent set --proposed` sends).
    const edited = {
      ...generated.body,
      perField: generated.body.perField.map((f) =>
        f.question.label === "Why us?"
          ? { ...f, answer: "Proposed text.", source: { kind: "proposed", basis: "posting" } }
          : f,
      ),
    };
    const saved = await call(server!.port, "PUT", "/api/applications/acme-ai-engineer/kit-draft", edited);
    expect(saved.status).toBe(200);
    expect(saved.body.unreviewed).toEqual(["Why us?"]);
    expect(saved.body.perField.find((f) => f.question.label === "Why us?").source.kind).toBe("proposed");
    // Unreviewed text is held out of the manifest.
    expect(JSON.stringify(saved.body.manifest)).not.toContain("Proposed text");

    // Approval refuses until the owner accepts.
    const blocked = await call(server!.port, "POST", "/api/applications/acme-ai-engineer/kit-approve", {});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toContain("unreviewed proposed");
  });

  test("drafting with neither a body nor questions.json says which verb to run", async () => {
    writePackage(process.env.JOBAGENT_APPLICATIONS_DIR!, "acme-ai-engineer");
    await call(server!.port, "PUT", "/api/answers", library);

    const reply = await call(
      server!.port,
      "POST",
      "/api/applications/acme-ai-engineer/kit-draft",
      {},
    );
    expect(reply.status).toBe(409);
    expect(reply.body.error).toContain("jobagent questions acme-ai-engineer");
  });
});
