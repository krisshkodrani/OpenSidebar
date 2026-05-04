import { afterAll, beforeAll, describe, expect, it } from "vitest";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../../..");
const DIST_PATH = path.join(PROJECT_ROOT, "dist");
const DIST_MANIFEST_PATH = path.join(DIST_PATH, ".vite", "manifest.json");
const OVERLAY_ENTRY = "src/overlay/index.tsx";

interface ViteManifestEntry {
  file?: string;
}

interface StaticServerHandle {
  origin: string;
  close(): Promise<void>;
}

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

async function readOverlayBundlePath(): Promise<string> {
  let manifestRaw: string;
  try {
    manifestRaw = await readFile(DIST_MANIFEST_PATH, "utf8");
  } catch {
    throw new Error(
      `Missing built extension manifest at ${DIST_MANIFEST_PATH}. Run npm run build before the overlay harness smoke.`,
    );
  }

  const manifest = JSON.parse(manifestRaw) as Record<
    string,
    ViteManifestEntry
  >;
  const overlayEntry = manifest[OVERLAY_ENTRY];
  if (!overlayEntry?.file) {
    throw new Error(
      `Built manifest does not contain ${OVERLAY_ENTRY}. Run npm run build and verify the overlay-harness Rollup input.`,
    );
  }
  return overlayEntry.file;
}

async function startDistServer(): Promise<StaticServerHandle> {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/" || url.pathname === "/overlay-smoke") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(`<!doctype html>
        <html>
          <head><title>Overlay Harness Smoke</title></head>
          <body>
            <main>
              <h1>Generic page</h1>
              <p>This page has no Chrome extension APIs.</p>
            </main>
          </body>
        </html>`);
      return;
    }

    const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const filePath = path.resolve(DIST_PATH, relativePath);
    if (!filePath.startsWith(DIST_PATH + path.sep)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    try {
      const content = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type":
          MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream",
      });
      response.end(content);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Overlay smoke server did not bind to a TCP port.");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function injectModule(page: Page, scriptUrl: string): Promise<void> {
  await page.evaluate(
    (url) =>
      new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.type = "module";
        script.src = url;
        script.onload = () => resolve();
        script.onerror = () =>
          reject(new Error(`Failed to load overlay module: ${url}`));
        document.head.appendChild(script);
      }),
    scriptUrl,
  );
}

describe("Overlay harness browser injection", () => {
  let browser: Browser;
  let page: Page;
  let staticServer: StaticServerHandle;
  let overlayBundlePath: string;
  const pageErrors: string[] = [];

  beforeAll(async () => {
    overlayBundlePath = await readOverlayBundlePath();
    staticServer = await startDistServer();
    browser = await puppeteer.launch({
      headless: true,
      defaultViewport: { width: 1280, height: 900 },
      args: ["--no-first-run", "--disable-search-engine-choice-screen"],
      pipe: true,
    });
    page = await browser.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
  }, 60_000);

  afterAll(async () => {
    await page?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await staticServer?.close().catch(() => {});
  });

  it("injects the built overlay bundle and round-trips messages through browser events", async () => {
    await page.goto(`${staticServer.origin}/overlay-smoke`, {
      waitUntil: "domcontentloaded",
    });
    await injectModule(page, `${staticServer.origin}/${overlayBundlePath}`);
    await page.waitForSelector("#opensidebar-harness-host", {
      timeout: 15_000,
    });

    const mounted = await page.evaluate(() => {
      const host = document.getElementById("opensidebar-harness-host");
      const root = host?.shadowRoot?.getElementById("root");
      return {
        hasHost: Boolean(host),
        hasShadowRoot: Boolean(host?.shadowRoot),
        hasRoot: Boolean(root),
        runtimeSource: window.__opensidebarOverlayRuntime?.port.source,
      };
    });
    expect(mounted).toEqual({
      hasHost: true,
      hasShadowRoot: true,
      hasRoot: true,
      runtimeSource: "ui",
    });

    await page.evaluate(() => {
      window.__overlaySmoke = { outboundTypes: [], inboundTypes: [] };
      window.addEventListener("opensidebar:overlay:send-message", (event) => {
        const message = (event as CustomEvent<{ message?: { type?: string } }>)
          .detail?.message;
        if (message?.type) {
          window.__overlaySmoke.outboundTypes.push(message.type);
        }
      });
      window.__opensidebarOverlayRuntime?.port.subscribeMessages((message) => {
        window.__overlaySmoke.inboundTypes.push(message.type);
      });
    });

    await page.evaluate(async () => {
      const runtime = window.__opensidebarOverlayRuntime;
      if (!runtime) throw new Error("Overlay runtime was not mounted.");
      await runtime.port.sendMessage({
        type: "USER_CHAT",
        source: runtime.port.source,
        requestId: "overlay-smoke-user-chat",
        payload: {
          text: "Smoke test message",
          tabId: 1,
          workspaceId: null,
        },
      });
      window.dispatchEvent(
        new CustomEvent("opensidebar:overlay:receive-message", {
          detail: {
            message: {
              type: "AGENT_STATUS",
              source: "background",
              requestId: "overlay-smoke-status",
              payload: { status: "thinking", detail: "Working" },
            },
          },
        }),
      );
    });

    const roundTrip = await page.evaluate(() => window.__overlaySmoke);
    expect(roundTrip.outboundTypes).toContain("USER_CHAT");
    expect(roundTrip.inboundTypes).toContain("AGENT_STATUS");
    expect(pageErrors).toEqual([]);
  }, 60_000);
});

declare global {
  interface Window {
    __overlaySmoke: {
      outboundTypes: string[];
      inboundTypes: string[];
    };
  }
}
