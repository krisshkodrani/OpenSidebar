/**
 * Seed-kit resolution + loading (pi-backend Phase 0: contain seed PII).
 *
 * Real seed data — the name/email/phone/address/CVs a job-application run fills
 * forms with — lives OUTSIDE the repo tree, so it is never one gitignore line
 * from a leak. Location resolution mirrors helpers/profile.ts:
 * `OPENSIDEBAR_SEED_DIR`, defaulting to `~/.opensidebar/seed/` (alongside the
 * `~/.opensidebar/profiles/` store). A kit is a directory holding a
 * `run-config.json` manifest plus any CV PDF(s) it references.
 *
 * These helpers carry no personal data; they only locate and parse it. The
 * committed `fixtures/live-app-kit/` kit is entirely synthetic (fake identity)
 * for offline, PII-free coverage of this machinery.
 */

import { createServer, type Server } from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, normalize, resolve } from "node:path";

/** The manifest at the root of a kit directory. */
export interface LiveAppRunConfig {
  formUrl: string;
  maxTurns: number;
  cvServe?: { dir: string; port: number; file: string };
  promptLines: string[];
  /** Must appear byte-exact among input/textarea values. */
  expectedFieldValues: string[];
  /** Must appear whitespace-normalized among field values or selected options. */
  expectedLongTexts: string[];
  /** Must appear in the page's visible text (e.g. the attached CV filename). */
  expectedPageText: string[];
  /** Must NOT appear anywhere — the not-submitted guard. */
  forbiddenPageText: string[];
}

/** The out-of-repo seed root: `OPENSIDEBAR_SEED_DIR` or `~/.opensidebar/seed`. */
export function resolveSeedDir(): string {
  return resolve(
    process.env.OPENSIDEBAR_SEED_DIR || join(homedir(), ".opensidebar", "seed"),
  );
}

/**
 * Locate the live-application kit directory: an explicit `E2E_LIVE_APP_KIT`
 * wins; otherwise the refurbed kit under the seed dir, but only if its
 * `run-config.json` is actually present. Returns undefined when neither exists
 * — the live test then self-skips.
 */
export function resolveLiveAppKitDir(): string | undefined {
  const explicit = process.env.E2E_LIVE_APP_KIT;
  if (explicit) return explicit;
  const kit = join(resolveSeedDir(), "applications", "refurbed-ai-product");
  return existsSync(join(kit, "run-config.json")) ? kit : undefined;
}

/** Parse a kit's `run-config.json`, or null when the dir/manifest is absent. */
export function loadKitConfig(
  kitDir: string | undefined,
): LiveAppRunConfig | null {
  if (!kitDir) return null;
  const configPath = join(kitDir, "run-config.json");
  if (!existsSync(configPath)) return null;
  return JSON.parse(readFileSync(configPath, "utf8")) as LiveAppRunConfig;
}

/**
 * Loopback-only static server so `upload_file` can fetch a kit's CV by URL.
 * Serves exactly the files in `dir` (no traversal, no listing) as PDF.
 */
export function serveKitFiles(dir: string, port: number): Promise<Server> {
  const server = createServer((req, res) => {
    const name = normalize(decodeURIComponent(req.url ?? "/")).replace(
      /^[/\\]+/,
      "",
    );
    const filePath = join(dir, name);
    if (!filePath.startsWith(normalize(dir)) || !existsSync(filePath)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": "application/pdf",
      "content-length": statSync(filePath).size,
    });
    createReadStream(filePath).pipe(res);
  });
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolvePromise(server));
  });
}
