/**
 * Stdio smoke test for the observability MCP server (RFC LP-7, Stage A).
 * Spawns the server as a subprocess over stdio, performs the MCP handshake,
 * lists the tools, and calls a couple of them. Proves the server speaks MCP.
 *
 * Run: pnpm run mcp:smoke
 */

import { resolve } from "path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const serverPath = resolve(import.meta.dirname, "mcp-server.ts");

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath, // node
    args: ["--import", "tsx", serverPath],
    cwd: repoRoot,
  });
  const client = new Client(
    { name: "obs-smoke", version: "0.1.0" },
    { capabilities: {} },
  );
  await client.connect(transport);

  const { tools } = await client.listTools();
  console.log(`✓ ${tools.length} tools:`, tools.map((t) => t.name).join(", "));

  const status = await client.callTool({
    name: "index_status",
    arguments: {},
  });
  const statusText = (status.content as { type: string; text?: string }[])
    .map((c) => c.text ?? "")
    .join("");
  console.log("✓ index_status:", statusText.replace(/\s+/g, " ").slice(0, 200));

  const search = await client.callTool({
    name: "search_traces",
    arguments: { limit: 2 },
  });
  const searchText = (search.content as { type: string; text?: string }[])
    .map((c) => c.text ?? "")
    .join("");
  console.log(
    "✓ search_traces(limit=2):",
    searchText.replace(/\s+/g, " ").slice(0, 200),
  );

  await client.close();
  console.log("✓ smoke OK");
}

main().catch((error) => {
  console.error("✗ smoke FAILED:", error);
  process.exit(1);
});
