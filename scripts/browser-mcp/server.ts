/**
 * Browser MCP host (RFC LP-8, M2 "The Bridge").
 *
 * A Model Context Protocol server that exposes thick, intent-level browser tools
 * to an external orchestrator (OpenClaw). It mirrors the proven LP-7 pattern
 * (`scripts/obs/mcp-server.ts`): the server holds no browser logic — every call
 * is validated and forwarded over a `BrowserBridge` to the OpenSidebar
 * extension, which runs the actual `AgentLoop`.
 *
 * Two transports to the orchestrator (OpenClaw):
 *   - stdio (default)              — OpenClaw spawns this process as a child.
 *                                    Best for a native, single-machine install.
 *   - streamable-http (network)    — set BROWSER_MCP_HTTP_PORT. OpenClaw connects
 *                                    over the network. Required when OpenClaw runs
 *                                    in its own container (it can't spawn our repo).
 *
 * Transport to the *extension* is independent: a loopback WebSocket on
 * BROWSER_MCP_WS_PORT (the extension connects as a client). Until that is set the
 * default `NotConnectedBridge` returns a clean structured error.
 *
 * Run:  pnpm run mcp:browser   (or: tsx scripts/browser-mcp/server.ts)
 */

import { createServer as createHttpServer } from "node:http";
import { resolve } from "path";
import { fileURLToPath } from "url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  NotConnectedBridge,
  type BrowserBridge,
  type BrowserToolResponse,
} from "./bridge.js";
import { BROWSER_TOOLS } from "./tools.js";
import { WebSocketBridge } from "./ws-bridge.js";

type Args = Record<string, unknown>;

/** Validate required args against a tool's schema before forwarding. */
function validateArgs(name: string, args: Args): void {
  const tool = BROWSER_TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  for (const key of tool.inputSchema.required ?? []) {
    const value = args[key];
    if (value === undefined || value === null || value === "") {
      throw new Error(`Missing required argument for ${name}: ${key}`);
    }
  }
}

/**
 * Validate + forward one tool call to the extension over the bridge. Exported
 * for unit tests (injects a mock bridge). Throws only on a bad request; a failed
 * browser run comes back as a structured `{ status: "error" }` response.
 */
export async function dispatch(
  bridge: BrowserBridge,
  name: string,
  args: Args,
): Promise<BrowserToolResponse> {
  validateArgs(name, args);
  return bridge.call({ tool: name, args });
}

/** Build a configured MCP server bound to the given bridge (no transport yet). */
export function buildBrowserMcpServer(bridge: BrowserBridge): Server {
  const server = new Server(
    { name: "opensidebar-browser", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: BROWSER_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const response = await dispatch(bridge, name, (args ?? {}) as Args);
      return {
        // `needs_human` is informational, not an error — let the orchestrator act.
        isError: response.status === "error",
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          { type: "text", text: `Error in ${name}: ${(error as Error).message}` },
        ],
      };
    }
  });

  return server;
}

export type BrowserMcpTransport =
  | { kind: "stdio" }
  | { kind: "http"; port: number; host?: string };

/** Connect the server over stdio (OpenClaw spawns us as a child process). */
async function startStdio(bridge: BrowserBridge): Promise<void> {
  const server = buildBrowserMcpServer(bridge);
  await server.connect(new StdioServerTransport());
}

function readBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve(undefined);
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve(undefined);
      }
    });
    req.on("error", () => resolve(undefined));
  });
}

/**
 * Serve MCP over streamable-http (stateless) so a networked orchestrator — e.g.
 * OpenClaw running in its own container — can reach us. One server+transport per
 * request keeps it stateless (no cross-request session state; the bridge holds
 * all the real state).
 */
async function startHttp(
  bridge: BrowserBridge,
  port: number,
  host = "127.0.0.1",
): Promise<void> {
  const httpServer = createHttpServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${host}:${port}`);
    if (url.pathname !== "/mcp") {
      res.writeHead(404).end("not found");
      return;
    }
    if (req.method !== "POST") {
      // Stateless mode needs no GET/DELETE session channel.
      res.writeHead(405).end("method not allowed");
      return;
    }
    const body = await readBody(req);
    const server = buildBrowserMcpServer(bridge);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      if (!res.headersSent) res.writeHead(500).end(String(error));
    }
  });
  await new Promise<void>((ready) => httpServer.listen(port, host, ready));
  console.error(`[browser-mcp] streamable-http on http://${host}:${port}/mcp`);
}

export async function startBrowserMcpServer(
  bridge: BrowserBridge = new NotConnectedBridge(),
  transport: BrowserMcpTransport = { kind: "stdio" },
): Promise<void> {
  if (transport.kind === "http") {
    await startHttp(bridge, transport.port, transport.host);
  } else {
    await startStdio(bridge);
  }
}

// Auto-start only when run directly (not when imported by tests).
//   - Extension transport: loopback WebSocket when BROWSER_MCP_WS_PORT is set;
//     otherwise NotConnectedBridge (extension transport not configured).
//   - OpenClaw transport: streamable-http when BROWSER_MCP_HTTP_PORT is set
//     (Docker / networked); otherwise stdio (native, OpenClaw spawns us).
const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  const wsPort = process.env.BROWSER_MCP_WS_PORT;
  const bridge: BrowserBridge = wsPort
    ? new WebSocketBridge({
        port: Number(wsPort),
        // In Docker, bind 0.0.0.0 so the published (host-loopback) port routes in.
        host: process.env.BROWSER_MCP_WS_HOST,
      })
    : new NotConnectedBridge();

  const httpPort = process.env.BROWSER_MCP_HTTP_PORT;
  const transport: BrowserMcpTransport = httpPort
    ? { kind: "http", port: Number(httpPort), host: process.env.BROWSER_MCP_HTTP_HOST }
    : { kind: "stdio" };

  startBrowserMcpServer(bridge, transport).catch((error) => {
    console.error("[browser-mcp] fatal:", error);
    process.exit(1);
  });
}
