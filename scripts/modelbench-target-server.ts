#!/usr/bin/env tsx

import { createReadStream, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import type { JsonObject, ScenarioActionV2 } from "@opensidebar/scenario-contracts";
import {
  MemoryScenarioStore,
  scenarioEngine,
  type ScenarioStoreV2,
} from "@opensidebar/scenario-engine";

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}

async function body(req: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON object required.");
  return value as JsonObject;
}

function cookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function safeStaticPath(root: string, pathname: string): string | null {
  const requested = pathname === "/" ? "/scenario-target.html" : pathname;
  const candidate = resolve(root, `.${decodeURIComponent(requested)}`);
  const prefix = `${resolve(root)}${sep}`;
  return candidate.startsWith(prefix) ? candidate : null;
}

export interface ModelBenchTargetServerOptions {
  host?: string;
  port?: number;
  staticDirectory?: string;
  store?: ScenarioStoreV2;
  now?: () => Date;
}

export interface ModelBenchTargetServer {
  origin: string;
  close(): Promise<void>;
}

export async function startModelBenchTargetServer(
  options: ModelBenchTargetServerOptions = {},
): Promise<ModelBenchTargetServer> {
  const host = options.host ?? "127.0.0.1";
  const store = options.store ?? new MemoryScenarioStore();
  const now = options.now ?? (() => new Date());
  const staticDirectory = resolve(options.staticDirectory ?? "apps/sandbox/dist");
  const launchTokens = new Map<string, string>();
  const sessions = new Map<string, string>();
  let origin = "";

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", origin || "http://127.0.0.1");
      if (req.method === "POST" && url.pathname === "/api/v2/modelbench/runs") {
        const input = await body(req);
        if (typeof input.caseId !== "string") return json(res, 400, { error: { message: "caseId is required." } });
        const definition = scenarioEngine.case(input.caseId);
        const id = `run_${crypto.randomUUID()}`;
        const token = crypto.randomUUID();
        const timestamp = now();
        await store.create({
          id,
          ownerId: "local-modelbench",
          caseId: definition.contract.id,
          createdAt: timestamp.toISOString(),
          expiresAt: new Date(timestamp.getTime() + 7_200_000).toISOString(),
        });
        launchTokens.set(token, id);
        return json(res, 201, { runId: id, launchUrl: `${origin}/launch/${token}` });
      }
      if (req.method === "GET" && url.pathname.startsWith("/api/v2/modelbench/runs/")) {
        const runId = decodeURIComponent(url.pathname.slice("/api/v2/modelbench/runs/".length));
        const run = await store.get(runId);
        return run
          ? json(res, 200, { run })
          : json(res, 404, { error: { message: "Run not found." } });
      }
      if (req.method === "GET" && url.pathname.startsWith("/launch/")) {
        const token = url.pathname.slice("/launch/".length);
        const runId = launchTokens.get(token);
        if (!runId) return json(res, 410, { error: { message: "Launch link expired." } });
        launchTokens.delete(token);
        const session = crypto.randomUUID();
        sessions.set(session, runId);
        res.writeHead(302, {
          location: "/scenario-target.html",
          "set-cookie": `mb_target=${encodeURIComponent(session)}; HttpOnly; SameSite=Lax; Path=/`,
          "referrer-policy": "no-referrer",
        });
        return res.end();
      }
      if (url.pathname.startsWith("/api/v2/target/")) {
        const session = cookie(req, "mb_target");
        const runId = session ? sessions.get(session) : null;
        const run = runId ? await store.get(runId) : null;
        if (!run || run.lifecycle === "expired") return json(res, 401, { error: { message: "Target session required." } });
        if (req.method === "GET" && url.pathname === "/api/v2/target/state") {
          return json(res, 200, { run: scenarioEngine.targetView(run.state) });
        }
        if (req.method === "POST" && url.pathname === "/api/v2/target/action") {
          const input = await body(req);
          if (input.type !== "case.submit" && input.type !== "case.terminal") {
            return json(res, 400, { error: { message: "Unsupported target action." } });
          }
          const action: ScenarioActionV2 = {
            type: input.type,
            payload:
              input.payload && typeof input.payload === "object" && !Array.isArray(input.payload)
                ? input.payload as JsonObject
                : {},
          };
          const updated = await store.apply(run.id, run.revision, action, now().toISOString());
          return json(res, 200, { run: scenarioEngine.targetView(updated.state) });
        }
        return json(res, 404, { error: { message: "Target endpoint not found." } });
      }
      if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: { message: "Method not allowed." } });
      const path = safeStaticPath(staticDirectory, url.pathname);
      if (!path || !existsSync(path)) return json(res, 404, { error: { message: "Asset not found." } });
      res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" });
      if (req.method === "HEAD") return res.end();
      createReadStream(path).pipe(res);
    } catch (error) {
      json(res, 500, { error: { message: error instanceof Error ? error.message : "Target server failed." } });
    }
  });
  await new Promise<void>((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => resolveReady());
  });
  const address = server.address() as AddressInfo;
  origin = `http://${host}:${address.port}`;
  return {
    origin,
    close: () => new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = await startModelBenchTargetServer({ port: Number(process.env.MODEL_BENCH_TARGET_PORT ?? 4318) });
  console.log(`[modelbench:target] ${server.origin}`);
}
