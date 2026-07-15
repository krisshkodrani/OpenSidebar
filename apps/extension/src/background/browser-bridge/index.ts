/**
 * Browser bridge startup (RFC LP-8, M2 Stage 2b).
 *
 * Default-off: only connects when `opensidebar:browserMcpWsPort` is set in
 * chrome.storage.local (the loopback port the browser MCP host listens on,
 * started via `pnpm run mcp:browser` with `BROWSER_MCP_WS_PORT`). With no port
 * configured this is a no-op, so the extension is unchanged by default.
 */

import { chromePersistencePort } from "../environment/chrome";
import { createDefaultBrowserAgentRunner } from "./orchestrator-driver";
import { BrowserBridgeClient } from "./ws-client";

export const BROWSER_MCP_WS_PORT_KEY = "opensidebar:browserMcpWsPort";

let client: BrowserBridgeClient | null = null;

export async function startBrowserBridge(): Promise<boolean> {
  if (client) return true;
  let port: number | undefined;
  try {
    const stored = await chromePersistencePort.local.get(BROWSER_MCP_WS_PORT_KEY);
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

/**
 * Start the bridge if configured, and react to the setting from then on:
 * setting or changing `opensidebar:browserMcpWsPort` (re)connects, clearing it
 * disconnects — no extension reload required. This is what background.ts calls.
 */
export function initBrowserBridge(): void {
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local" || !(BROWSER_MCP_WS_PORT_KEY in changes)) return;
      stopBrowserBridge();
      void startBrowserBridge();
    });
  } catch {
    // No chrome.storage events (tests without a chrome mock): startup-only.
  }
  void startBrowserBridge();
}
