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
const REACT_APP_DIR = path.join(FIXTURES_DIR, "online-shop-pro", "dist");
const DOWNLOADS_DIR = path.join(FIXTURES_DIR, "downloads");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

let server: http.Server | null = null;
let serverPort = 0;
const STOP_TIMEOUT_MS = 3_000;

export function getFixtureUrl(route: string): string {
  if (!serverPort) throw new Error("Fixture server not started");
  // Remove leading slash if present
  const path = route.startsWith("/") ? route.slice(1) : route;
  return `http://127.0.0.1:${serverPort}/${path}`;
}

function serveReactApp(res: http.ServerResponse) {
  const indexPath = path.join(REACT_APP_DIR, "index.html");
  if (fs.existsSync(indexPath)) {
    const content = fs.readFileSync(indexPath);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(content);
    return true;
  }
  return false;
}

function serveStucknessFixture(
  filename: string,
  res: http.ServerResponse,
): boolean {
  if (!filename.startsWith("stuckness/")) return false;

  const filePath = path.resolve(FIXTURES_DIR, filename);
  const stucknessRoot = `${path.resolve(FIXTURES_DIR, "stuckness")}${path.sep}`;
  if (!filePath.startsWith(stucknessRoot) || !fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return true;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || "text/html";
  res.writeHead(200, { "Content-Type": contentType });
  res.end(fs.readFileSync(filePath));
  return true;
}

function serveWatchFixture(
  filename: string,
  res: http.ServerResponse,
): boolean {
  if (!filename.startsWith("watch/")) return false;

  const filePath = path.resolve(FIXTURES_DIR, filename);
  const watchRoot = `${path.resolve(FIXTURES_DIR, "watch")}${path.sep}`;
  if (!filePath.startsWith(watchRoot) || !fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return true;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || "text/html";
  res.writeHead(200, { "Content-Type": contentType });
  res.end(fs.readFileSync(filePath));
  return true;
}

function serveDownloadFixture(
  filename: string,
  res: http.ServerResponse,
): boolean {
  if (!filename.startsWith("downloads/")) return false;

  const filePath = path.resolve(FIXTURES_DIR, filename);
  const downloadsRoot = `${path.resolve(DOWNLOADS_DIR)}${path.sep}`;
  if (!filePath.startsWith(downloadsRoot) || !fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return true;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const content = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${path.basename(filePath)}"`,
  });
  res.end(content);
  return true;
}

export async function startFixtureServer(): Promise<number> {
  if (server && serverPort) {
    return serverPort;
  }

  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      const urlPath = req.url?.split("?")[0] ?? "/";
      const filename = urlPath.slice(1); // Remove leading slash

      // Serve React app assets directly
      if (filename.startsWith("assets/")) {
        const assetPath = path.join(REACT_APP_DIR, filename);
        if (fs.existsSync(assetPath)) {
          const ext = path.extname(assetPath);
          const contentType = MIME_TYPES[ext] || "application/octet-stream";
          const content = fs.readFileSync(assetPath);
          res.writeHead(200, { "Content-Type": contentType });
          res.end(content);
          return;
        }
      }

      if (serveStucknessFixture(filename, res)) {
        return;
      }

      if (serveWatchFixture(filename, res)) {
        return;
      }

      if (serveDownloadFixture(filename, res)) {
        return;
      }

      // For any other path, serve the React app (SPA routing)
      // This handles all the routes: /summarize, /article, /navigation, /dashboard, /shop, /form, /errors
      if (!serveReactApp(res)) {
        res.writeHead(404);
        res.end("Not found");
      }
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
  const activeServer = server;
  if (!activeServer) return;

  server = null;
  serverPort = 0;

  let closeError: Error | undefined;
  const closed = new Promise<void>((resolve) => {
    activeServer.close((error) => {
      closeError = error ?? undefined;
      resolve();
    });
  });

  const timedOut = await Promise.race([
    closed.then(() => false),
    new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(true), STOP_TIMEOUT_MS),
    ),
  ]);

  if (timedOut) {
    activeServer.closeAllConnections?.();
    activeServer.closeIdleConnections?.();
    await Promise.race([
      closed,
      new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
    ]);
    console.warn("[e2e] Fixture server close timed out; forced open connections closed.");
  }

  if (closeError) {
    console.warn(`[e2e] Fixture server close reported: ${closeError.message}`);
  }
}
