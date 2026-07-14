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
