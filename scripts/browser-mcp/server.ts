/**
 * Browser MCP host (RFC LP-8, M2 "The Bridge").
 *
 * A Model Context Protocol server that exposes thick, intent-level browser tools
 * to an external MCP client. It mirrors the proven LP-7 pattern
 * (`scripts/obs/mcp-server.ts`): the server holds no browser logic — every call
 * is validated and forwarded over a `BrowserBridge` to the OpenSidebar
 * extension, which runs the actual `AgentLoop`. (A local pi session skips this
 * server entirely and drives the WebSocket bridge directly via
 * `.pi/extensions/opensidebar.ts`.)
 *
 * Two transports to the MCP client:
 *   - stdio (default)              — the client spawns this process as a child.
 *                                    Best for a native, single-machine install.
 *   - streamable-http (loopback)   — set BROWSER_MCP_HTTP_PORT and the shared
 *                                    bearer token. This transport deliberately
 *                                    refuses non-loopback bind addresses.
 *
 * Transport to the *extension* is independent: a loopback WebSocket on
 * BROWSER_MCP_WS_PORT (the extension connects as a client). Until that is set the
 * default `NotConnectedBridge` returns a clean structured error.
 *
 * Run:  pnpm run mcp:browser   (or: tsx scripts/browser-mcp/server.ts)
 */

import { createServer as createHttpServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import { resolve } from "path";
import { fileURLToPath } from "url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SpanStatusCode, metrics, trace } from "@opentelemetry/api";
import { SeverityNumber, logs } from "@opentelemetry/api-logs";

import {
  NotConnectedBridge,
  type BrowserBridge,
  type BrowserToolResponse,
} from "./bridge.js";
import { BROWSER_TOOLS } from "./tools.js";
import { WebSocketBridge } from "./ws-bridge.js";

type Args = Record<string, unknown>;

// Telemetry handles (Bluebox, see scripts/otel/sdk.ts). Pure no-ops until
// startOtel() runs in the auto-start block — unit tests never export anything.
const otelTracer = trace.getTracer("opensidebar-browser-mcp");
const otelLogger = logs.getLogger("opensidebar-browser-mcp");
const toolCallCounter = metrics
  .getMeter("opensidebar-browser-mcp")
  .createCounter("opensidebar.browser_tool.calls", {
    description: "Thick browser tool calls dispatched over the bridge, by outcome",
  });

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
  const forwardedArgs =
    name === "request_browser_file_upload"
      ? await prepareLocalFileUpload(args)
      : args;
  return otelTracer.startActiveSpan(
    `browser_tool ${name}`,
    { attributes: { "opensidebar.tool.name": name } },
    async (span) => {
      try {
        const response = await bridge.call({ tool: name, args: forwardedArgs });
        span.setAttribute("opensidebar.tool.status", response.status);
        toolCallCounter.add(1, { tool: name, status: response.status });
        if (response.status === "error") {
          span.setStatus({ code: SpanStatusCode.ERROR, message: response.reason });
          otelLogger.emit({
            severityNumber: SeverityNumber.ERROR,
            severityText: "ERROR",
            body: `browser_tool ${name} failed: ${response.reason ?? "unknown"}`,
            attributes: { "opensidebar.tool.name": name },
          });
        }
        return response;
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: (error as Error).message,
        });
        toolCallCounter.add(1, { tool: name, status: "thrown" });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

const MAX_LOCAL_UPLOAD_BYTES = 10 * 1024 * 1024;
const LOCAL_UPLOAD_MIME: Record<string, string> = {
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".txt": "text/plain",
  ".zip": "application/zip",
};

export async function prepareLocalFileUpload(
  args: Args,
): Promise<Args> {
  const requestedPath =
    typeof args.file_path === "string" ? args.file_path.trim() : "";
  if (!requestedPath || !isAbsolute(requestedPath)) {
    throw new Error("file_path must be an absolute local path");
  }
  const canonicalPath = await realpath(requestedPath);
  const info = await stat(canonicalPath);
  if (!info.isFile()) throw new Error("file_path must refer to a regular file");
  if (info.size <= 0) throw new Error("file_path must not be empty");
  if (info.size > MAX_LOCAL_UPLOAD_BYTES) {
    throw new Error("local file exceeds the 10MB upload limit");
  }
  const bytes = await readFile(canonicalPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const extension = extname(canonicalPath).toLowerCase();
  return {
    task_id: args.task_id,
    tab_id: args.tab_id,
    origin: args.origin,
    input_id: args.input_id,
    _validated_local_file: {
      filename: basename(canonicalPath),
      size: bytes.byteLength,
      sha256,
      mimeType: LOCAL_UPLOAD_MIME[extension] ?? "application/octet-stream",
      dataBase64: bytes.toString("base64"),
    },
  };
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
  | { kind: "http"; port: number; host?: string; authToken: string };

/** Connect the server over stdio (the MCP client spawns us as a child process). */
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
 * Serve MCP over streamable-http (stateless) so a networked orchestrator —
 * e.g. one running in its own container — can reach us. One server+transport
 * per request keeps it stateless (no cross-request session state; the bridge
 * holds all the real state).
 */
async function startHttp(
  bridge: BrowserBridge,
  port: number,
  host = "127.0.0.1",
  authToken: string,
): Promise<void> {
  if (!["127.0.0.1", "::1", "localhost"].includes(host.toLowerCase())) {
    throw new Error("Browser MCP HTTP transport must bind to a loopback host.");
  }
  if (authToken.length < 32) {
    throw new Error(
      "Browser MCP HTTP transport needs an auth token of at least 32 characters.",
    );
  }
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
    if (req.headers.authorization !== `Bearer ${authToken}`) {
      res.writeHead(401, { "WWW-Authenticate": "Bearer" }).end("unauthorized");
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
    await startHttp(
      bridge,
      transport.port,
      transport.host,
      transport.authToken,
    );
  } else {
    await startStdio(bridge);
  }
}

// Auto-start only when run directly (not when imported by tests).
//   - Extension transport: loopback WebSocket when BROWSER_MCP_WS_PORT is set;
//     otherwise NotConnectedBridge (extension transport not configured).
//   - MCP-client transport: streamable-http when BROWSER_MCP_HTTP_PORT is set
//     (Docker / networked); otherwise stdio (native, the client spawns us).
const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  // Bluebox telemetry (default-off; no-op without OTEL_EXPORTER_OTLP_ENDPOINT
  // / .env.otel). Dynamic import keeps the SDK out of unit-test module graphs.
  const { startOtel } = await import("../otel/sdk.js");
  await startOtel("opensidebar-browser-mcp");
  const wsPort = process.env.BROWSER_MCP_WS_PORT;
  const authToken = process.env.BROWSER_MCP_AUTH_TOKEN;
  const bridge: BrowserBridge = wsPort
    ? new WebSocketBridge({
        port: Number(wsPort),
        host: process.env.BROWSER_MCP_WS_HOST,
        authToken,
      })
    : new NotConnectedBridge();

  const httpPort = process.env.BROWSER_MCP_HTTP_PORT;
  const transport: BrowserMcpTransport = httpPort
    ? {
        kind: "http",
        port: Number(httpPort),
        host: process.env.BROWSER_MCP_HTTP_HOST,
        authToken: authToken ?? "",
      }
    : { kind: "stdio" };

  startBrowserMcpServer(bridge, transport).catch((error) => {
    console.error("[browser-mcp] fatal:", error);
    process.exit(1);
  });
}
