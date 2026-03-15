/**
 * Simple HTTP server to serve fixture HTML files.
 *
 * Chrome extensions don't inject content scripts into file:// URLs by default
 * (requires "Allow access to file URLs" toggle). Using http:// avoids this.
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

let server: http.Server | null = null;
let serverPort = 0;

export function getFixtureUrl(filename: string): string {
  if (!serverPort) throw new Error("Fixture server not started");
  return `http://127.0.0.1:${serverPort}/${filename}`;
}

export async function startFixtureServer(): Promise<number> {
  if (server && serverPort) {
    return serverPort;
  }

  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const urlPath = req.url?.split("?")[0] ?? "/";
      const filename = urlPath === "/" ? "test-page.html" : urlPath.slice(1);
      const filePath = path.join(FIXTURES_DIR, filename);

      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const ext = path.extname(filePath);
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server!.address();
      if (typeof addr === "object" && addr) {
        serverPort = addr.port;
        resolve(serverPort);
      } else {
        reject(new Error("Failed to bind fixture server"));
      }
    });

    server.on("error", reject);
  });
}

export async function stopFixtureServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => resolve());
      server = null;
      serverPort = 0;
    } else {
      resolve();
    }
  });
}
