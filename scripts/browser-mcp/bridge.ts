/**
 * Browser bridge contract (RFC LP-8, M2 "The Bridge").
 *
 * The browser MCP host (this package) exposes thick, intent-level browser tools
 * to an external orchestrator (OpenClaw). It does NOT run the browser itself —
 * each tool call is forwarded over a `BrowserBridge` to the OpenSidebar
 * extension, which runs a full internal `AgentLoop` and returns one result.
 *
 * This module defines only the wire contract + transport interface, so the
 * server is unit-testable with a mock bridge and the actual transport
 * (native-messaging / local WebSocket to the MV3 service worker) can be swapped
 * in without touching tool logic.
 */

// The wire contract is shared with the extension via shared-types (one source of
// truth). The transport interface + default bridge stay host-local.
export type {
  BrowserToolStatus,
  BrowserToolRequest,
  BrowserToolResponse,
} from "@shared-types/browser-bridge";
import type {
  BrowserToolRequest,
  BrowserToolResponse,
} from "@shared-types/browser-bridge";

export interface BrowserBridge {
  call(request: BrowserToolRequest): Promise<BrowserToolResponse>;
}

/**
 * Default bridge used until the extension transport is wired (M2 Stage 2).
 * Always reports that the browser is unreachable, so the MCP contract is live
 * and OpenClaw gets a clean, structured response instead of a hang.
 */
export class NotConnectedBridge implements BrowserBridge {
  async call(): Promise<BrowserToolResponse> {
    return {
      status: "error",
      reason:
        "OpenSidebar extension is not connected. Native-messaging/WebSocket transport not yet configured (RFC LP-8, M2 Stage 2).",
    };
  }
}
