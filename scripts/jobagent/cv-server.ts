/**
 * Loopback CV server (pi-backend Phase 5).
 *
 * Serves exactly the files in a directory (no traversal, no listing) as PDF over
 * 127.0.0.1, so the browser agent can `upload_file` the CV by URL. Same shape as
 * the live-app kit's `serveKitFiles`, but host-side (pi runs here) and returning
 * a ready `{url, close}` for the specific CV file. Port 0 lets the OS pick.
 */

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join, normalize } from "node:path";

export interface CvServer {
  /** The loopback URL of the CV file (e.g. http://127.0.0.1:54321/cv.pdf). */
  url: string;
  /** Stop the server. */
  close(): Promise<void>;
}

/** Start a loopback server for `dir` and return the URL of `file` within it. */
export function startCvServer(dir: string, file: string): Promise<CvServer> {
  const root = normalize(dir);
  const server = createServer((req, res) => {
    const name = normalize(decodeURIComponent(req.url ?? "/")).replace(
      /^[/\\]+/,
      "",
    );
    const filePath = join(root, name);
    if (!filePath.startsWith(root) || !existsSync(filePath)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": "application/pdf",
      "content-length": statSync(filePath).size,
    });
    createReadStream(filePath).pipe(res);
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
