/**
 * Browser bridge contract (RFC LP-8, M2 "The Bridge").
 *
 * The browser MCP host (this package) exposes thick, intent-level browser tools
 * to an external orchestrator (a pi session, or any MCP client). It does NOT run the browser itself —
 * each tool call is forwarded over a `BrowserBridge` to the OpenSidebar
 * extension, which runs a full internal `AgentLoop` and returns one result.
 *
 * This module defines only the wire contract + transport interface, so the
 * server is unit-testable with a mock bridge and the actual transport
 * (native-messaging / local WebSocket to the MV3 service worker) can be swapped
 * in without touching tool logic.
 */

// The wire contract is shared with the extension via shared-types (one source of
// truth). The transport interface + default bridge stay host-local. All
// shared-types imports here MUST stay type-only: the pi loader resolves this
// file at runtime and cannot resolve the `@shared-types` alias (typecheck-only).
export type {
  BrowserToolStatus,
  BrowserToolRequest,
  BrowserToolResponse,
  BrowserToolCallFrame,
  BrowserToolCancelFrame,
  BrowserBridgeHostFrame,
  BrowserToolResponseFrame,
} from "@shared-types/browser-bridge";
import type {
  BrowserToolRequest,
  BrowserToolResponse,
} from "@shared-types/browser-bridge";

/**
 * Reason string a canceled call resolves with. Host-local value (see the
 * type-only note above); the extension mirrors the same string in
 * `browser-bridge/orchestrator-driver.ts`. Nothing matches on it — it is for
 * the caller's (pi's) eyes.
 */
export const BROWSER_TOOL_CANCELED_REASON = "canceled by caller";

export interface BrowserToolCallOptions {
  /** Aborting resolves the call as canceled and tells the extension to stop the run. */
  signal?: AbortSignal;
}

export interface BrowserBridge {
  call(
    request: BrowserToolRequest,
    opts?: BrowserToolCallOptions,
  ): Promise<BrowserToolResponse>;
}

/**
 * Default bridge used until the extension transport is wired (M2 Stage 2).
 * Always reports that the browser is unreachable, so the MCP contract is live
 * and the caller gets a clean, structured response instead of a hang.
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
