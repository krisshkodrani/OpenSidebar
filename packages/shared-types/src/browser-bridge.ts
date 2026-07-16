/**
 * Browser bridge wire contract (RFC LP-8, M2 "The Bridge").
 *
 * The cross-process contract between the browser MCP host (`scripts/browser-mcp/`)
 * and the OpenSidebar extension. Lives in shared-types so both sides import one
 * source of truth instead of duplicating the shape.
 */

import type { PartialProgressHandoff } from "./progress";

/**
 * Terminal status of a thick browser tool call.
 * - `ok`          — intent finished; `result` holds the payload.
 * - `needs_human` — the agent paused (CAPTCHA / auth / ambiguity); `reason` says
 *                   why. The orchestrator surfaces it and may resume. NOT an error.
 * - `error`       — the call failed; `reason` holds the message.
 */
export type BrowserToolStatus = "ok" | "needs_human" | "error";

export interface BrowserToolRequest {
  tool: string;
  args: Record<string, unknown>;
  /**
   * Out-of-band session key, minted once per caller process (e.g. one pi run).
   * Transport metadata only — it never appears in any LLM-facing tool schema.
   * Calls sharing a session reuse one workspace and one browser tab, so a
   * follow-up mission lands on the page the previous mission left open.
   */
  session?: string;
}

export interface BrowserToolResponse {
  status: BrowserToolStatus;
  /** Tool-specific payload when `status === "ok"`. */
  result?: unknown;
  /** Why the agent paused (`needs_human`) or failed (`error`). */
  reason?: string;
  /**
   * Structured account of the run when it produced one: what got done, what
   * remains, what the agent is unsure about, the evidence behind it, and a
   * suggested prompt to continue from. Present on any status — an external
   * orchestrator needs it most when the run did not simply succeed.
   */
  handoff?: PartialProgressHandoff;
}

/**
 * WebSocket wire frames between the browser MCP host and the extension.
 * This module is type-only (both sides bundle/erase it), so the canonical
 * canceled-reason VALUE lives host-side: `BROWSER_TOOL_CANCELED_REASON` in
 * `scripts/browser-mcp/bridge.ts` = "canceled by caller". The extension mirrors
 * the same string; nothing compares the two programmatically.
 */
export interface BrowserToolCallFrame {
  id: string;
  request: BrowserToolRequest;
}

/**
 * Host → extension: the caller aborted call `id`. Fire-and-forget — the host
 * resolves the call locally the moment it sends this; the extension stops the
 * run and its eventual response frame is dropped as an unknown id.
 */
export interface BrowserToolCancelFrame {
  id: string;
  cancel: true;
}

export type BrowserBridgeHostFrame = BrowserToolCallFrame | BrowserToolCancelFrame;

export interface BrowserToolResponseFrame {
  id: string;
  response: BrowserToolResponse;
}
