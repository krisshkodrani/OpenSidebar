/**
 * Context types and constants - compression levels, metrics, personas
 */

export enum CompressionLevel {
  NONE = "none",
  LIGHT = "light",
  MEDIUM = "medium",
  HEAVY = "heavy",
}

export interface ContextMetrics {
  systemTokens: number;
  historyTokens: number;
  totalTokens: number;
  maxTokens: number;
  utilization: number;
  elementCount: number;
  compressionLevel: CompressionLevel;
}

export interface LastActionOutcome {
  toolName: string;
  deltaPercent: number;
  urlChanged: boolean;
  prevUrl?: string;
  currentUrl: string;
  elementsAdded: number;
  elementsRemoved: number;
}

/** One workspace tab rendered in the "## Open Tabs" prompt section. */
export interface OpenTabInfo {
  tabId: number;
  title: string;
  url: string;
}

export interface PlanStatusGate {
  trigger: string;
  action: "call_done" | "advance_step" | "retry_step";
  maxRetries?: number;
  pattern?: string;
}

export interface PlanStatus {
  subtasks: {
    description: string;
    status: "pending" | "running" | "completed" | "failed" | "skipped";
    completedAtUrl?: string;
    result?: string;
    verificationGate?: PlanStatusGate;
    toolProfile?: string;
  }[];
  currentIndex: number;
}

/** Persona injected when the executor model is active (speed-optimised, action-biased). */
export const EXECUTOR_PERSONA =
  "You are the execution model. Keep Think blocks to 2-3 lines. Prefer the most obvious action. Call one tool per turn unless batching independent fills. If an action fails twice, call escalate() instead of retrying.";

/** Persona injected when the planner model is active (reasoning-heavy, investigation-biased). */
export const PLANNER_PERSONA =
  "You are the reasoning model, called when the executor model gets stuck. Before acting: (1) Analyze why previous attempts failed using the conversation history. (2) Use investigation tools (inspect_hidden, xray_page, execute_js, read_element) to gather missing information. (3) Formulate a strategy that differs from what was already tried. Make each turn count.";

/** Tools whose results carry reference data worth preserving longer in history compression. */
export const REFERENCE_VALUE_TOOLS: ReadonlySet<string> = new Set([
  "inspect_hidden",
  "execute_js",
  "get_cookies",
  "search_history",
  "read_element",
]);
