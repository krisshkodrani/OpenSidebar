/**
 * Extension-side browser bridge handler (RFC LP-8, M2 Stage 2a).
 *
 * Pure translation between the MCP host's thick tool calls and an internal agent
 * run: maps a `BrowserToolRequest` to an `AgentTask`, runs it via an injected
 * `AgentRunner`, and maps the outcome back to a `BrowserToolResponse` (incl.
 * `needs_human`). The orchestrator hookup that supplies the real `AgentRunner`
 * (and the WebSocket transport) is Stage 2b — deferred until the completion-kernel
 * WIP settles. This module touches no live orchestrator code.
 */

import type {
  BrowserToolRequest,
  BrowserToolResponse,
  ForwardedApprovalRequest,
} from "@shared-types/browser-bridge";
import type { PartialProgressHandoff } from "@shared-types/progress";
import type { ToolProfile } from "../tools/metadata";
import type {
  RemoteMissionTargetBindingV1,
  RemoteMissionTargetSelectionV1,
} from "@shared-types/remote-missions";

export interface AgentTask {
  instruction: string;
  url?: string;
  /** Hard runtime ceiling applied after planning and replanning. */
  executionToolProfile?: ToolProfile;
  /** Session key: calls sharing it reuse one workspace + tab (see wire contract). */
  session?: string;
  /** Remote missions may explicitly use the user's active tab. */
  targetContext?: "active_tab" | "existing_tab" | "isolated_tab";
  /** Mission-scoped opaque handle chosen after an ambiguous existing-tab match. */
  targetHandle?: string;
}

export interface AgentRunOutcome {
  status: "completed" | "needs_human" | "error";
  summary?: string;
  data?: unknown;
  reason?: string;
  /** What was done / what remains / what is uncertain, when the run produced it. */
  handoff?: PartialProgressHandoff;
  /** Present when `needs_human` because a consequential action awaits approval. */
  approval?: ForwardedApprovalRequest;
  targetSelection?: RemoteMissionTargetSelectionV1;
  /** Sanitized target/workspace state captured by the device before execution. */
  target?: RemoteMissionTargetBindingV1;
}

export interface AgentRunOptions {
  /** Aborting requests a stop of the running task; the run settles normally. */
  signal?: AbortSignal;
  /** Report a verified, sanitized target binding before agent execution. */
  onTargetBound?: (target: RemoteMissionTargetBindingV1) => Promise<void> | void;
}

/** Runs one internal agent task. Implemented by the orchestrator in Stage 2b. */
export interface AgentRunner {
  run(task: AgentTask, opts?: AgentRunOptions): Promise<AgentRunOutcome>;
  /** Continue an existing-tab mission after the coordinator chose an opaque target. */
  selectTarget?(
    task: AgentTask & { session: string; targetHandle: string },
    opts?: AgentRunOptions,
  ): Promise<AgentRunOutcome>;
  /**
   * Answer a forwarded approval (pi-backend Phase 4), resuming the paused
   * mission. Optional so a runner without the capability can decline cleanly.
   */
  respondApproval?(
    req: BrowserToolRequest,
    opts?: AgentRunOptions,
  ): Promise<AgentRunOutcome>;
}

/** Map a thick browser tool request to an internal natural-language agent task. */
export function toAgentTask(req: BrowserToolRequest): AgentTask {
  const task = mapTool(req);
  if (req.session !== undefined) task.session = req.session;
  return task;
}

function mapTool(req: BrowserToolRequest): AgentTask {
  const a = req.args;
  const url = typeof a.url === "string" ? a.url : undefined;
  switch (req.tool) {
    case "browser_navigate":
      return { instruction: `Navigate to ${a.url} and report the page that loads.`, url };
    case "browser_screenshot":
      return { instruction: "Capture a screenshot of the current page.", url };
    case "browser_extract_structured":
      return {
        instruction: `Extract data from the page matching this schema: ${JSON.stringify(a.schema)}.`,
        url,
      };
    case "browser_research_company":
      return {
        instruction: `Research the company ${a.name ?? a.url} and return a structured profile (summary, products, size, links).`,
        url,
      };
    case "browser_apply_to_job": {
      // The instruction is the only channel to the inner agent, so the caller's
      // resume/cover-letter VALUES must ride in it — dropping them (as this did)
      // means a caller who passes them gets neither used.
      const resume = typeof a.resume === "string" ? a.resume.trim() : "";
      const coverLetter =
        typeof a.cover_letter === "string" ? a.cover_letter.trim() : "";
      const parts = [`Apply to the job at ${a.url}.`];
      if (resume) parts.push(`Resume to use: ${resume}`);
      if (coverLetter) parts.push(`Cover letter to use: ${coverLetter}`);
      return { instruction: parts.join(" "), url };
    }
    case "browser_run_task":
      return { instruction: String(a.instruction ?? ""), url };
    default:
      return { instruction: String(a.instruction ?? req.tool), url };
  }
}

function mapOutcome(outcome: AgentRunOutcome): BrowserToolResponse {
  // The handoff rides along on every status: a caller deciding what to do next
  // needs it most precisely when the run did not simply succeed.
  const handoff = outcome.handoff ? { handoff: outcome.handoff } : {};
  switch (outcome.status) {
    case "completed":
      return {
        status: "ok",
        result: outcome.data ?? outcome.summary ?? null,
        ...handoff,
      };
    case "needs_human":
      return {
        status: "needs_human",
        reason: outcome.reason ?? "human input required",
        ...handoff,
        ...(outcome.approval ? { approval: outcome.approval } : {}),
      };
    case "error":
      return {
        status: "error",
        reason: outcome.reason ?? "agent run failed",
        ...handoff,
      };
  }
}

/** Validate the args of a `browser_respond_approval` call. */
function parseApprovalResponse(
  args: Record<string, unknown>,
): { approvalId: string; approved: boolean } | null {
  if (typeof args.approvalId !== "string" || !args.approvalId) return null;
  if (typeof args.approved !== "boolean") return null;
  return { approvalId: args.approvalId, approved: args.approved };
}

/** Translate → run → translate back. Errors become a structured `error` response. */
export async function handleBrowserToolRequest(
  req: BrowserToolRequest,
  runner: AgentRunner,
  opts?: AgentRunOptions,
): Promise<BrowserToolResponse> {
  // Liveness check never runs a task.
  if (req.tool === "browser_ping") return { status: "ok", result: "pong" };
  // Approval answer: routes to the runner's resume capability, not a new run.
  if (req.tool === "browser_respond_approval") {
    if (!parseApprovalResponse(req.args)) {
      return {
        status: "error",
        reason: "browser_respond_approval needs { approvalId: string, approved: boolean }",
      };
    }
    if (!runner.respondApproval) {
      return {
        status: "error",
        reason: "this runner cannot answer approvals",
      };
    }
    try {
      return mapOutcome(await runner.respondApproval(req, opts));
    } catch (error) {
      return { status: "error", reason: (error as Error).message };
    }
  }
  try {
    const outcome = await runner.run(toAgentTask(req), opts);
    return mapOutcome(outcome);
  } catch (error) {
    return { status: "error", reason: (error as Error).message };
  }
}
