/**
 * Loopback CV server (pi-backend Phase 5).
 *
 * Serves only the approved file (no traversal, no listing) as PDF over
 * 127.0.0.1, so the browser agent can `upload_file` the CV by URL. Same shape as
 * the live-app kit's `serveKitFiles`, but host-side (pi runs here) and returning
 * a ready `{url, close}` for the specific CV file. Port 0 lets the OS pick.
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { isAbsolute, join, normalize, resolve } from "node:path";
import { resolveSeedDir } from "./paths";

export interface CvServer {
  /** The loopback URL of the CV file (e.g. http://127.0.0.1:54321/cv.pdf). */
  url: string;
  /** Stop the server. */
  close(): Promise<void>;
}

/** Existing kits may contain a seed-relative CV directory; prefer the
 * documented application-relative path, then recognize that legacy form. */
export function resolveCvServeDir(appDir: string, dir: string, file: string): string {
  const applicationPath = resolve(appDir, dir);
  if (isAbsolute(dir) || existsSync(join(applicationPath, file))) return applicationPath;
  const seedPath = resolve(resolveSeedDir(), dir);
  return existsSync(join(seedPath, file)) ? seedPath : applicationPath;
}

/** Start a loopback server for `dir` and return the URL of `file` within it. */
export function startCvServer(dir: string, file: string): Promise<CvServer> {
  const root = normalize(dir);
  const cvPath = join(root, file);
  if (normalize(file) !== file || file === "." || file === ".." ||
      file.includes("/") || file.includes("\\") ||
      !existsSync(cvPath) || !statSync(cvPath).isFile()) {
    return Promise.reject(new Error(`CV file is missing or invalid: ${cvPath}`));
  }
  const server = createServer((req, res) => {
    let requested: string;
    try {
      requested = decodeURIComponent(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (requested !== `/${file}`) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": "application/pdf",
      "content-length": statSync(cvPath).size,
    });
    createReadStream(cvPath).pipe(res);
  });

  return new Promise<CvServer>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolvePromise({
        url: `http://127.0.0.1:${port}/${encodeURIComponent(file)}`,
        close: () =>
          new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}
