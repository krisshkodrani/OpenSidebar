/**
 * OpenSidebar extension for pi (https://pi.dev) — pi is the brain, the
 * OpenSidebar Chrome extension is the hands.
 *
 * Registers the seven thick browser tools from `scripts/browser-mcp/tools.ts`
 * over the existing loopback WebSocket bridge. The schemas are passed through
 * VERBATIM: pi-ai validates plain JSON Schema first-class (verified against
 * pi-ai 0.80.7 — `validateToolArguments` has an explicit non-TypeBox branch),
 * so `tools.ts` stays the single source of truth. Do not hand-port schemas.
 *
 * Topology: this extension hosts the WebSocket server (started lazily on the
 * first tool call); the OpenSidebar service worker connects as the client.
 * Setup, once: load the extension and set the port in chrome.storage.local —
 *   chrome.storage.local.set({ "opensidebar:browserMcpWsPort": 8787 })
 * then reload the extension (the port is read at startup only).
 *
 * Mission protocol (LP-8 / pi-backend plan): tool calls are bounded missions.
 * The response carries `handoff` (PartialProgressHandoff) — completed[],
 * remaining[], uncertainty[], suggestedContinuationPrompt — whenever the run
 * ended with work outstanding. `needs_human` is a report, not an error.
 *
 * Removability: delete this file (or the whole `.pi/` dir) and pi knows
 * nothing about OpenSidebar. Nothing here is imported by extension code.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

import { BROWSER_TOOLS } from "../../scripts/browser-mcp/tools";
import type { BrowserToolResponse } from "../../scripts/browser-mcp/bridge";
import { WebSocketBridge } from "../../scripts/browser-mcp/ws-bridge";

const WS_PORT = Number(process.env.OPENSIDEBAR_WS_PORT ?? 8787);
/** Long ceiling: intent tools wrap a full multi-turn agent run. */
const CALL_TIMEOUT_MS = 600_000;

let bridge: WebSocketBridge | null = null;

async function getBridge(): Promise<WebSocketBridge> {
  if (!bridge) {
    bridge = await WebSocketBridge.create({
      port: WS_PORT,
      timeoutMs: CALL_TIMEOUT_MS,
    });
  }
  return bridge;
}

function describe(response: BrowserToolResponse): string {
  // The full response as JSON — pi reads status/result/handoff from it. The
  // handoff is the mission report; serializing it verbatim is the point.
  return JSON.stringify(response, null, 2);
}

export default function opensidebarExtension(pi: ExtensionAPI): void {
  for (const tool of BROWSER_TOOLS) {
    pi.registerTool({
      name: tool.name,
      label: tool.name.replace(/^browser_/, "OpenSidebar: "),
      description: tool.description,
      // Plain JSON Schema — supported by pi-ai at runtime; the cast only
      // bridges the nominal TSchema type. Never rewrite these into TypeBox.
      parameters: tool.inputSchema as unknown as TSchema,
      promptSnippet: tool.description,
      promptGuidelines:
        tool.kind === "intent"
          ? [
              `${tool.name}: a bounded mission in the user's real, authenticated browser. ` +
                "Put every concrete value the task needs (names, exact answer text, URLs) " +
                "in the request — the browser agent fills forms verbatim from what you " +
                "send and must never invent personal data.",
              `${tool.name}: if the response status is "needs_human", read ` +
                "response.handoff (completed / remaining / uncertainty / " +
                "suggestedContinuationPrompt), resolve the uncertainty from your own " +
                "context or by asking the user, then issue a follow-up call. It is a " +
                "progress report, not an error.",
            ]
          : undefined,
      async execute(_toolCallId, params, signal) {
        if (signal?.aborted) {
          throw new Error(`${tool.name} aborted before dispatch`);
        }
        const ws = await getBridge();
        // Cancellation mid-run needs a cancel frame on the wire + a STOP_AGENT
        // path in the extension — Phase 3 of the pi-backend plan. Until then
        // the signal is only honored up front.
        const response = await ws.call({
          tool: tool.name,
          args: (params ?? {}) as Record<string, unknown>,
        });
        return {
          content: [{ type: "text", text: describe(response) }],
          details: response,
        };
      },
    });
  }
}
