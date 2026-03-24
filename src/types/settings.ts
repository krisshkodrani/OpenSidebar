/**
 * OpenSidebar — User settings, workspaces, navigation, and utility types
 */

import type { AgentLoopState } from "./agent";

// --- Configuration Types ---

export interface UserSettings {
  openRouterApiKey: string;
  /** LLM provider: "openrouter" (default) or "groq" */
  provider?: "openrouter" | "groq";
  /** Groq API key (optional — enables Groq as provider) */
  groqApiKey?: string;
  maxTurns: number;
  theme: "light" | "dark" | "system";
  /** Show token usage and cost metrics during and after agent sessions */
  showSessionMetrics: boolean;
  /** Expand step timeline + tool logs by default in each assistant message */
  showMessageDetailsByDefault?: boolean;
  /** Site access policy for agent execution */
  siteAccessMode?: "allow_all" | "blocklist";
  /** Blocked domains when `siteAccessMode` is `blocklist` */
  siteAccessBlocklist?: string[];
  /** Require user approval for high-risk actions (default: true) */
  requireApprovals: boolean;
  /** Allow agent to open or switch to new pages (default: true) */
  allowNavigation: boolean;
  /** Require user confirmation before executing multi-step plans (default: true) */
  requirePlanConfirmation?: boolean;
  /** Override executor model (default depends on provider) */
  executorModel?: string;
  /** Override planner model (default depends on provider) */
  plannerModel?: string;
  /** Override perception model (default depends on provider) */
  perceptionModel?: string;
  /** Append :nitro variant suffix to all model IDs for faster inference (default: false, OpenRouter only) */
  useNitro?: boolean;
}

// --- Workspace / Tab Group Types ---

export interface Workspace {
  id: string;
  name: string;
  color:
    | "grey"
    | "blue"
    | "red"
    | "yellow"
    | "green"
    | "pink"
    | "purple"
    | "cyan"
    | "orange";
  tabGroupId: number | null;
  tabIds: number[];
}

// --- Navigation Bridge Types ---

/** State persisted to chrome.storage.local during page navigations */
export interface NavigationState {
  /** Full agent loop state to restore */
  agentState: AgentLoopState;
  /** URL before navigation started */
  fromUrl: string;
  /** Expected destination URL (null for click-triggered navigations) */
  toUrl: string | null;
  /** Timestamp when navigation started (for timeout detection) */
  navigationStartTs: number;
  /** Timeout in milliseconds (default: 30000) */
  timeoutMs: number;
}

// --- Utility Types ---

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };
