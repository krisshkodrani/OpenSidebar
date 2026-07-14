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
} from "@shared-types/browser-bridge";
import type { PartialProgressHandoff } from "@shared-types/progress";

export interface AgentTask {
  instruction: string;
  url?: string;
}

export interface AgentRunOutcome {
  status: "completed" | "needs_human" | "error";
  summary?: string;
  data?: unknown;
  reason?: string;
  /** What was done / what remains / what is uncertain, when the run produced it. */
  handoff?: PartialProgressHandoff;
}

/** Runs one internal agent task. Implemented by the orchestrator in Stage 2b. */
export interface AgentRunner {
  run(task: AgentTask): Promise<AgentRunOutcome>;
}

/** Map a thick browser tool request to an internal natural-language agent task. */
export function toAgentTask(req: BrowserToolRequest): AgentTask {
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
    case "browser_apply_to_job":
      return {
        instruction: `Apply to the job at ${a.url}.${a.cover_letter ? " Use the provided cover letter." : ""}`,
        url,
      };
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
      };
    case "error":
      return {
        status: "error",
        reason: outcome.reason ?? "agent run failed",
        ...handoff,
      };
  }
}

/** Translate → run → translate back. Errors become a structured `error` response. */
export async function handleBrowserToolRequest(
  req: BrowserToolRequest,
  runner: AgentRunner,
): Promise<BrowserToolResponse> {
  // Liveness check never runs a task.
  if (req.tool === "browser_ping") return { status: "ok", result: "pong" };
  try {
    const outcome = await runner.run(toAgentTask(req));
    return mapOutcome(outcome);
  } catch (error) {
    return { status: "error", reason: (error as Error).message };
  }
}
