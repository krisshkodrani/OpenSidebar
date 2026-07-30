/**
 * Browser bridge startup (RFC LP-8, M2 Stage 2b).
 *
 * Default-off: only connects when `opensidebar:browserMcpWsPort` is set in
 * chrome.storage.local (the loopback port the browser MCP host listens on,
 * started via `pnpm run mcp:browser` with `BROWSER_MCP_WS_PORT`). With no port
 * configured this is a no-op, so the extension is unchanged by default.
 */

import {
  chromePersistencePort,
  chromeRuntimeEnvironment,
} from "../environment/chrome";
import { createDefaultBrowserAgentRunner } from "./orchestrator-driver";
import { BrowserBridgeClient } from "./ws-client";
import type { DelegatedTaskPersistence } from "./delegated-task-service";
import { MessageSource } from "../../types";
import { ToolName } from "../../types";
import { executeContentTool } from "../tools/bridge";

export const BROWSER_MCP_WS_PORT_KEY = "opensidebar:browserMcpWsPort";
export const BROWSER_MCP_AUTH_TOKEN_KEY = "opensidebar:browserMcpAuthToken";
const DELEGATED_TASKS_KEY = "opensidebar:delegatedBrowserTasks:v1";

let client: BrowserBridgeClient | null = null;
let stopListener: (() => void) | null = null;

export async function startBrowserBridge(): Promise<boolean> {
  if (client) return true;
  let port: number | undefined;
  let authToken: string | undefined;
  try {
    const stored = await chromePersistencePort.local.get([
      BROWSER_MCP_WS_PORT_KEY,
      BROWSER_MCP_AUTH_TOKEN_KEY,
    ]);
    const value = stored[BROWSER_MCP_WS_PORT_KEY];
    if (typeof value === "number") port = value;
    else if (typeof value === "string" && value.trim()) port = Number(value.trim());
    const tokenValue = stored[BROWSER_MCP_AUTH_TOKEN_KEY];
    if (typeof tokenValue === "string" && tokenValue.length >= 32) {
      authToken = tokenValue;
    }
  } catch {
    return false;
  }
  if (!port || Number.isNaN(port) || port <= 0 || !authToken) return false;

  client = new BrowserBridgeClient({
    url: `ws://127.0.0.1:${port}`,
    authToken,
    runner: createDefaultBrowserAgentRunner(),
    delegatedTaskOptions: {
      persistence: {
        async load() {
          const stored = await chromePersistencePort.local.get(DELEGATED_TASKS_KEY);
          const value = stored[DELEGATED_TASKS_KEY];
          return Array.isArray(value)
            ? (value as Awaited<ReturnType<DelegatedTaskPersistence["load"]>>)
            : [];
        },
        async save(records) {
          await chromePersistencePort.local.set({
            [DELEGATED_TASKS_KEY]: records,
          });
        },
      },
      onUpdate(task) {
        chromeRuntimeEnvironment.messaging.broadcast({
          type: "DELEGATED_BROWSER_TASK_UPDATE",
          requestId: crypto.randomUUID(),
          source: MessageSource.BACKGROUND,
          workspaceId: null,
          payload: task,
        });
      },
      fileUploader: {
        async getTabUrl(tabId) {
          const tab = await chrome.tabs.get(tabId);
          return tab.url ?? tab.pendingUrl ?? "";
        },
        async upload(input) {
          return executeContentTool(
            ToolName.UPLOAD_FILE,
            {
              id: input.inputId,
              data: input.dataBase64,
              filename: input.filename,
              mimeType: input.mimeType,
            },
            input.tabId,
          );
        },
      },
    },
  });
  stopListener = chromeRuntimeEnvironment.messaging.onMessage((message) => {
    const candidate = message as {
      type?: unknown;
      payload?: { workspaceId?: unknown };
    };
    if (
      candidate.type === "STOP_AGENT" &&
      (candidate.payload?.workspaceId === null ||
        candidate.payload?.workspaceId === undefined)
    ) {
      void client?.stopActiveDelegatedTask();
    }
  });
  client.start();
  return true;
}

export function stopBrowserBridge(): void {
  stopListener?.();
  stopListener = null;
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
      if (
        area !== "local" ||
        !(
          BROWSER_MCP_WS_PORT_KEY in changes ||
          BROWSER_MCP_AUTH_TOKEN_KEY in changes
        )
      ) {
        return;
      }
      stopBrowserBridge();
      void startBrowserBridge();
    });
  } catch {
    // No chrome.storage events (tests without a chrome mock): startup-only.
  }
  void startBrowserBridge();
}
