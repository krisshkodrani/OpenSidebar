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

/**
 * Terminal status of a thick tool call.
 * - `ok`          — the agent finished the intent; `result` holds the payload.
 * - `needs_human` — the agent paused (CAPTCHA, auth, ambiguous step); `reason`
 *                   says why. The orchestrator surfaces this (e.g. via Telegram)
 *                   and may resume later. This is NOT an error.
 * - `error`       — the call failed; `reason` holds the message.
 */
export type BrowserToolStatus = "ok" | "needs_human" | "error";

export interface BrowserToolRequest {
  tool: string;
  args: Record<string, unknown>;
}

export interface BrowserToolResponse {
  status: BrowserToolStatus;
  /** Tool-specific payload when `status === "ok"`. */
  result?: unknown;
  /** Why the agent paused (`needs_human`) or failed (`error`). */
  reason?: string;
}

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
