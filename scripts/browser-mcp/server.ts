/**
 * Browser MCP host (RFC LP-8, M2 "The Bridge").
 *
 * A stdio Model Context Protocol server that exposes thick, intent-level browser
 * tools to an external orchestrator (OpenClaw). It mirrors the proven LP-7
 * pattern (`scripts/obs/mcp-server.ts`): the server holds no browser logic —
 * every call is validated and forwarded over a `BrowserBridge` to the
 * OpenSidebar extension, which runs the actual `AgentLoop`.
 *
 * Transport to the extension is pluggable (decided: loopback WebSocket — wired
 * in M2 Stage 2 alongside the extension-side handler). Until then the default
 * `NotConnectedBridge` returns a clean structured error.
 *
 * Run:  pnpm run mcp:browser   (or: tsx scripts/browser-mcp/server.ts)
 */

import { resolve } from "path";
import { fileURLToPath } from "url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

export async function startBrowserMcpServer(
  bridge: BrowserBridge = new NotConnectedBridge(),
): Promise<void> {
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Auto-start only when run directly (not when imported by tests).
const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  startBrowserMcpServer().catch((error) => {
    console.error("[browser-mcp] fatal:", error);
    process.exit(1);
  });
}
