/**
 * OpenClaw adapter / stub gateway (RFC LP-8, M5).
 *
 * A dependency-free loopback HTTP server implementing the contract the extension
 * client (`apps/extension/src/utils/openclaw-client.ts`) expects. It lets the
 * whole integration run end-to-end WITHOUT a full OpenClaw install: knowledge
 * sync (M3) is fully exercised (in-memory last-writer-wins KV); the planner
 * endpoint (M4) returns a minimal stub plan (swap in the real OpenClaw
 * LLM+memory call when wiring the daemon).
 *
 * Run:  pnpm run openclaw:adapter   (PORT via OPENCLAW_ADAPTER_PORT, default 18789)
 * Then set the extension setting `opensidebar:openClawGatewayUrl` to the URL.
 */

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";

interface SyncedItem {
  value: unknown;
  updatedAt: number;
  deleted?: boolean;
}
type SyncMap = Record<string, SyncedItem>;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", () => resolve(""));
  });
}

function cors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
}

function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  cors(res);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/** Build the adapter server (in-memory). Exported for tests + the runnable entry. */
export function createOpenClawAdapter(): Server {
  const knowledge: Record<string, SyncMap> = {};

  return createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      cors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    if (path === "/health" && req.method === "GET") {
      sendJson(res, { ok: true });
      return;
    }

    if (path === "/api/planner" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}") as { query?: string };
      // Stub plan: a single subtask echoing the query (the planner accepts a
      // `subtasks` decomposition). Replace with OpenClaw's LLM+memory call.
      const content = JSON.stringify({
        difficulty: "simple",
        subtasks: [String(body.query ?? "").slice(0, 200)],
      });
      sendJson(res, { content, injectedContext: "stub-openclaw-memory" });
      return;
    }

    const match = path.match(/^\/api\/knowledge\/(.+)$/);
    if (match) {
      const namespace = decodeURIComponent(match[1]);
      if (req.method === "GET") {
        sendJson(res, knowledge[namespace] ?? {});
        return;
      }
      if (req.method === "PUT") {
        const body = JSON.parse((await readBody(req)) || "{}") as { items?: SyncMap };
        const items = body.items ?? {};
        const current = (knowledge[namespace] ??= {});
        for (const [key, item] of Object.entries(items)) {
          const existing = current[key];
          // Last-writer-wins on the item clock.
          if (!existing || item.updatedAt >= existing.updatedAt) current[key] = item;
        }
        cors(res);
        res.writeHead(200);
        res.end();
        return;
      }
    }

    cors(res);
    res.writeHead(404);
    res.end("not found");
  });
}

// Auto-start when run directly.
const isMain = process.argv[1]?.endsWith("server.ts");
if (isMain) {
  const port = Number(process.env.OPENCLAW_ADAPTER_PORT) || 18789;
  createOpenClawAdapter().listen(port, "127.0.0.1", () => {
    console.log(`[openclaw-adapter] loopback gateway on http://127.0.0.1:${port}`);
  });
}
