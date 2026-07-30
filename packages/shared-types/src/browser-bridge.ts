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

export type DelegatedBrowserTaskStatus =
  | "queued"
  | "planning"
  | "running"
  | "waiting_for_approval"
  | "waiting_for_clarification"
  | "completed"
  | "failed"
  | "cancelled";

export type DelegatedModelRole =
  | "planner"
  | "executor"
  | "verifier"
  | "judge"
  | "observation";

export interface DelegatedBrowserTaskPolicy {
  allowedDomains: string[];
  approvalPolicy: {
    mode: "mandatory_checkpoints";
    allowSupervisorRelay: boolean;
  };
  maxSteps?: number;
  maxCostUsd?: number;
  timeoutSeconds?: number;
  allowedModelRoles?: DelegatedModelRole[];
}

export interface DelegateBrowserTaskInput {
  goal: string;
  context?: string;
  constraints?: string[];
  preferredTabId?: number;
  policy: DelegatedBrowserTaskPolicy;
}

export interface BrowserTaskEvidence {
  url?: string;
  visibleText?: string;
  screenshotId?: string;
}

export interface BrowserTaskVerifiedOutcome {
  claim: string;
  evidence?: BrowserTaskEvidence;
}

export interface BrowserTaskProviderUsage {
  models: string[];
  estimatedCostUsd: number;
  actualCostUsd?: number;
}

export interface BrowserTaskResult {
  taskId: string;
  status: "completed";
  summary: string;
  verifiedOutcomes: BrowserTaskVerifiedOutcome[];
  changesMade: string[];
  approvalsUsed: string[];
  warnings: string[];
  providerUsage: BrowserTaskProviderUsage;
  traceId: string;
}

export interface BrowserTaskClarification {
  clarificationId: string;
  question: string;
  reason: string;
  availableOptions: string[];
}

export interface BrowserTaskTraceEvent {
  at: number;
  type:
    | "delegated"
    | "started"
    | "approval_requested"
    | "approval_answered"
    | "clarification_requested"
    | "clarification_answered"
    | "completed"
    | "failed"
    | "cancelled";
  detail?: string;
}

export interface DelegatedBrowserTask {
  taskId: string;
  status: DelegatedBrowserTaskStatus;
  goal: string;
  createdAt: number;
  updatedAt: number;
  currentPlan: string[];
  completedSteps: string[];
  currentUrl?: string;
  currentTabId?: number;
  approval?: ForwardedApprovalRequest;
  clarification?: BrowserTaskClarification;
  providerUsage: BrowserTaskProviderUsage;
  evidence: BrowserTaskEvidence[];
  finalResult?: BrowserTaskResult;
  failureReason?: string;
  traceId: string;
}

export interface DelegatedBrowserTaskTrace {
  taskId: string;
  traceId: string;
  goal: string;
  events: BrowserTaskTraceEvent[];
  providerUsage: BrowserTaskProviderUsage;
  finalStatus: DelegatedBrowserTaskStatus;
}

/**
 * Phase 8 form-submit dry-run evidence forwarded with an approval request:
 * the live form state diffed against the values the caller put in the
 * mission instruction. `entries` lets the caller byte-check what would be
 * submitted before approving.
 */
export interface ForwardedApprovalDryRun {
  kind: "clean" | "unexpected";
  formKey: string;
  diffHash: string;
  entries: Array<{
    label: string;
    expected: string;
    actual: string | null;
    status: "match" | "mismatch" | "missing";
  }>;
  /** Human-readable rendering of the non-matching rows, when any. */
  rendered?: string;
}

/**
 * A consequential-action approval, forwarded over the wire because the
 * mission has no sidepanel to answer it (pi-backend Phase 4). Answer with
 * the `browser_respond_approval` tool before `expiresAt` — an expired
 * approval auto-denies and the task resumes with the action refused.
 */
export interface ForwardedApprovalRequest {
  approvalId: string;
  toolName: string;
  args: Record<string, unknown>;
  /** Human-readable description of the action awaiting approval. */
  context: string;
  requestedAt: number;
  timeoutMs: number;
  expiresAt: number;
  dryRun?: ForwardedApprovalDryRun;
}

export interface ForwardedClarificationRequest {
  clarificationId: string;
  question: string;
  suggestions?: string[];
  requestedAt: number;
  timeoutMs: number;
  expiresAt: number;
}

export interface BrowserToolResponse {
  status: BrowserToolStatus;
  /** Tool-specific payload when `status === "ok"`. */
  result?: unknown;
  /** Why the agent paused (`needs_human`) or failed (`error`). */
  reason?: string;
  /**
   * Present with `needs_human` when the run paused for a consequential-action
   * approval: the mission is ALIVE and waiting; answer via
   * `browser_respond_approval` instead of starting a new mission (a new
   * mission on the same session stops the paused task).
   */
  approval?: ForwardedApprovalRequest;
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
