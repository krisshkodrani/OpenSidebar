import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

/** Loopback GET via node:http — avoids happy-dom's same-origin fetch policy. */
function httpGet(
  url: string,
): Promise<{ status: number; contentType?: string; length: number }> {
  return new Promise((resolvePromise, reject) => {
    get(url, (res) => {
      let length = 0;
      res.on("data", (chunk: Buffer) => (length += chunk.length));
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

import {
  loadKitConfig,
  resolveLiveAppKitDir,
  resolveSeedDir,
  serveKitFiles,
} from "../e2e/helpers/seed";

// The committed SYNTHETIC kit (fabricated identity, no PII).
const FIXTURE_KIT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "e2e",
  "fixtures",
  "live-app-kit",
);

// Always control the seed location so these never read the real ~/.opensidebar
// seed (which, after Phase 0's move, would exist and make resolution non-deterministic).
let savedSeed: string | undefined;
let savedKit: string | undefined;
const tmpDirs: string[] = [];

beforeEach(() => {
  savedSeed = process.env.OPENSIDEBAR_SEED_DIR;
  savedKit = process.env.E2E_LIVE_APP_KIT;
  delete process.env.OPENSIDEBAR_SEED_DIR;
  delete process.env.E2E_LIVE_APP_KIT;
});

afterEach(() => {
  if (savedSeed === undefined) delete process.env.OPENSIDEBAR_SEED_DIR;
  else process.env.OPENSIDEBAR_SEED_DIR = savedSeed;
  if (savedKit === undefined) delete process.env.E2E_LIVE_APP_KIT;
  else process.env.E2E_LIVE_APP_KIT = savedKit;
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeTmpDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

describe("resolveSeedDir", () => {
  test("honors OPENSIDEBAR_SEED_DIR", () => {
    const seed = makeTmpDir("seed-");
    process.env.OPENSIDEBAR_SEED_DIR = seed;
    expect(resolveSeedDir()).toBe(resolve(seed));
  });
});

describe("resolveLiveAppKitDir", () => {
  test("undefined when the seed dir has no kit", () => {
    process.env.OPENSIDEBAR_SEED_DIR = makeTmpDir("seed-empty-");
    expect(resolveLiveAppKitDir()).toBeUndefined();
  });

  test("derives the kit under the seed dir when its run-config.json exists", () => {
    const seed = makeTmpDir("seed-");
    const kit = join(seed, "applications", "refurbed-ai-product");
    mkdirSync(kit, { recursive: true });
    writeFileSync(join(kit, "run-config.json"), "{}");
    process.env.OPENSIDEBAR_SEED_DIR = seed;
    expect(resolveLiveAppKitDir()).toBe(kit);
  });

  test("E2E_LIVE_APP_KIT overrides the derived path", () => {
    const seed = makeTmpDir("seed-");
    const kit = join(seed, "applications", "refurbed-ai-product");
    mkdirSync(kit, { recursive: true });
    writeFileSync(join(kit, "run-config.json"), "{}");
    process.env.OPENSIDEBAR_SEED_DIR = seed;
    process.env.E2E_LIVE_APP_KIT = "/explicit/kit/override";
    expect(resolveLiveAppKitDir()).toBe("/explicit/kit/override");
  });
});

describe("loadKitConfig", () => {
  test("returns null for an absent or unspecified kit", () => {
    expect(loadKitConfig(undefined)).toBeNull();
    expect(loadKitConfig(makeTmpDir("no-config-"))).toBeNull();
  });

  test("parses the synthetic fixture (fabricated identity, no PII)", () => {
    const cfg = loadKitConfig(FIXTURE_KIT);
    expect(cfg).not.toBeNull();
    expect(cfg!.expectedFieldValues).toContain("jordan.sample@example.com");
    // The not-submitted guard survives the move to a shared helper.
    expect(cfg!.forbiddenPageText).toContain("Application submitted");
    expect(cfg!.cvServe?.file).toBe("sample-cv.pdf");
  });
});

describe("serveKitFiles", () => {
  test("serves a kit file over loopback as PDF; 404s missing/traversal", async () => {
    const server = await serveKitFiles(FIXTURE_KIT, 0);
    try {
      const port = (server.address() as AddressInfo).port;
      const base = `http://127.0.0.1:${port}`;

      const ok = await httpGet(`${base}/sample-cv.pdf`);
      expect(ok.status).toBe(200);
      expect(ok.contentType).toBe("application/pdf");
      expect(ok.length).toBeGreaterThan(0);

      const missing = await httpGet(`${base}/does-not-exist.pdf`);
      expect(missing.status).toBe(404);

      // A path that resolves outside the kit dir is refused (not served).
      const outside = await httpGet(`${base}/seed.ts`);
      expect(outside.status).toBe(404);
    } finally {
      server.close();
    }
  });
});
