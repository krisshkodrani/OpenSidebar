/**
 * Browser bridge startup (RFC LP-8, M2 Stage 2b).
 *
 * Default-off: only connects when `opensidebar:browserMcpWsPort` is set in
 * chrome.storage.local (the loopback port the browser MCP host listens on,
 * started via `pnpm run mcp:browser` with `BROWSER_MCP_WS_PORT`). With no port
 * configured this is a no-op, so the extension is unchanged by default.
 */

import { createDefaultBrowserAgentRunner } from "./orchestrator-driver";
import { BrowserBridgeClient } from "./ws-client";

export const BROWSER_MCP_WS_PORT_KEY = "opensidebar:browserMcpWsPort";

let client: BrowserBridgeClient | null = null;

export async function startBrowserBridge(): Promise<boolean> {
  if (client) return true;
  let port: number | undefined;
  try {
    const stored = await chrome.storage.local.get(BROWSER_MCP_WS_PORT_KEY);
    const value = stored[BROWSER_MCP_WS_PORT_KEY];
    if (typeof value === "number") port = value;
    else if (typeof value === "string" && value.trim()) port = Number(value.trim());
  } catch {
    return false;
  }
  if (!port || Number.isNaN(port) || port <= 0) return false;

  client = new BrowserBridgeClient({
    url: `ws://127.0.0.1:${port}`,
    runner: createDefaultBrowserAgentRunner(),
  });
  client.start();
  return true;
}

export function stopBrowserBridge(): void {
  client?.stop();
  client = null;
}
