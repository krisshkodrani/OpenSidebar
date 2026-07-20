import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assembleFillBrief,
  isLegalStatusTransition,
  listApplications,
  loadApplication,
  recordStatus,
  startCvServer,
} from "../../../../scripts/jobagent/index";
import { parseApplicationPackage } from "../../../../scripts/jobagent/package";

// The committed SYNTHETIC application (fabricated identity, no PII), which lives
// as one app dir under the e2e fixtures dir.
const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "e2e",
  "fixtures",
);
const APP_NAME = "live-app-kit";
const APP_DIR = join(FIXTURES_DIR, APP_NAME);

let savedApps: string | undefined;
let savedSeed: string | undefined;
const tmpDirs: string[] = [];

beforeEach(() => {
  savedApps = process.env.JOBAGENT_APPLICATIONS_DIR;
  savedSeed = process.env.OPENSIDEBAR_SEED_DIR;
  delete process.env.JOBAGENT_APPLICATIONS_DIR;
  delete process.env.OPENSIDEBAR_SEED_DIR;
});
afterEach(() => {
  if (savedApps === undefined) delete process.env.JOBAGENT_APPLICATIONS_DIR;
  else process.env.JOBAGENT_APPLICATIONS_DIR = savedApps;
  if (savedSeed === undefined) delete process.env.OPENSIDEBAR_SEED_DIR;
  else process.env.OPENSIDEBAR_SEED_DIR = savedSeed;
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function httpGet(
  url: string,
): Promise<{ status: number; contentType?: string; length: number }> {
  return new Promise((resolvePromise, reject) => {
    get(url, (res) => {
      let length = 0;
      res.on("data", (c: Buffer) => (length += c.length));
      res.on("end", () =>
        resolvePromise({
          status: res.statusCode ?? 0,
          contentType: res.headers["content-type"],
          length,
        }),
      );
    }).on("error", reject);
  });
}

describe("parseApplicationPackage", () => {
  test("accepts a valid package", () => {
    const pkg = parseApplicationPackage({
      schemaVersion: 1,
      company: "Acme",
      roleTitle: "Engineer",
      status: "ready",
    });
    expect(pkg.company).toBe("Acme");
  });

  test("rejects wrong schemaVersion, missing company, unknown status", () => {
    expect(() => parseApplicationPackage({ schemaVersion: 2, company: "A", roleTitle: "R" })).toThrow(/schemaVersion/);
    expect(() => parseApplicationPackage({ schemaVersion: 1, roleTitle: "R" })).toThrow(/company/);
    expect(() =>
      parseApplicationPackage({ schemaVersion: 1, company: "A", roleTitle: "R", status: "bogus" }),
    ).toThrow(/status/);
  });
});

describe("isLegalStatusTransition", () => {
  test("allows the immediate forward path", () => {
    expect(isLegalStatusTransition("ready", "filled-awaiting-submit")).toBe(true);
    expect(isLegalStatusTransition("filled-awaiting-submit", "submitted-by-user")).toBe(true);
    expect(isLegalStatusTransition("submitted-by-user", "applied")).toBe(true);
  });
  test("rejects skips and backward moves", () => {
    expect(isLegalStatusTransition("ready", "applied")).toBe(false);
    expect(isLegalStatusTransition("submitted-by-user", "ready")).toBe(false);
  });
  test("archived from anywhere; duplicate-risk only from triage", () => {
    expect(isLegalStatusTransition("applied", "archived")).toBe(true);
    expect(isLegalStatusTransition("ready", "duplicate-risk")).toBe(true);
    expect(isLegalStatusTransition("submitted-by-user", "duplicate-risk")).toBe(false);
  });
});

describe("loadApplication + listApplications", () => {
  test("loads the synthetic app and lists it", () => {
    process.env.JOBAGENT_APPLICATIONS_DIR = FIXTURES_DIR;
    const app = loadApplication(APP_NAME);
    expect(app.package.company).toBe("Sample Company");
    expect(app.package.status).toBe("ready");
    expect(app.manifest.formUrl).toContain("/apply");

    const list = listApplications();
    expect(list.find((a) => a.name === APP_NAME)?.roleTitle).toBe("Sample Engineer");
  });

  test("throws a precise error when the application is absent", () => {
    process.env.JOBAGENT_APPLICATIONS_DIR = FIXTURES_DIR;
    expect(() => loadApplication("no-such-app")).toThrow(/application-package\.json/);
  });
});

describe("assembleFillBrief", () => {
  test("carries approved answers + fill-only guard + CV url; no fabrication", () => {
    process.env.JOBAGENT_APPLICATIONS_DIR = FIXTURES_DIR;
    const app = loadApplication(APP_NAME);
    const brief = assembleFillBrief(app.package, app.manifest, "http://127.0.0.1:9/cv.pdf");
    // An approved answer from the manifest is present verbatim.
    expect(brief).toContain("jordan.sample@example.com");
    // The not-submitted guard is present.
    expect(brief).toMatch(/DO NOT submit/i);
    // The CV URL is included.
    expect(brief).toContain("http://127.0.0.1:9/cv.pdf");
    // It names the role/company from the package, not invented data.
    expect(brief).toContain("Sample Engineer");
    expect(brief).toContain("Sample Company");
  });
});

describe("recordStatus", () => {
  test("writes a legal transition and rejects an illegal one", () => {
    // Copy the app into a temp workspace so we never mutate the committed fixture.
    const apps = mkdtempSync(join(tmpdir(), "jobagent-apps-"));
    tmpDirs.push(apps);
    const appDir = join(apps, APP_NAME);
    mkdirSync(appDir, { recursive: true });
    copyFileSync(join(APP_DIR, "application-package.json"), join(appDir, "application-package.json"));
    process.env.JOBAGENT_APPLICATIONS_DIR = apps;

    // ready → filled-awaiting-submit is legal and persists.
    const updated = recordStatus(appDir, "filled-awaiting-submit");
    expect(updated.status).toBe("filled-awaiting-submit");
    const onDisk = JSON.parse(readFileSync(join(appDir, "application-package.json"), "utf8"));
    expect(onDisk.status).toBe("filled-awaiting-submit");

    // filled-awaiting-submit → applied skips the human submit gate — rejected.
    expect(() => recordStatus(appDir, "applied")).toThrow(/illegal status transition/);
  });
});

describe("startCvServer", () => {
  test("serves the CV over loopback as PDF; 404s the rest", async () => {
    const server = await startCvServer(APP_DIR, "sample-cv.pdf");
    try {
      // The returned url embeds the port; sanity-check it is loopback.
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/sample-cv\.pdf$/);
      const ok = await httpGet(server.url);
      expect(ok.status).toBe(200);
      expect(ok.contentType).toBe("application/pdf");
      expect(ok.length).toBeGreaterThan(0);

      const port = server.url.match(/:(\d+)\//)![1];
      const missing = await httpGet(`http://127.0.0.1:${port}/nope.pdf`);
      expect(missing.status).toBe(404);
    } finally {
      await server.close();
    }
  });
});
