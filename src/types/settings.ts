/**
 * OpenSidebar — User settings, workspaces, navigation, and utility types
 */

import type { AgentLoopState } from "./agent";

// --- Configuration Types ---

export interface UserSettings {
  openRouterApiKey: string;
  /** Groq API key for executor model (GPT-OSS-120B) */
  groqApiKey: string;
  maxTurns: number;
  contextWindowSize: number;
  workspaceEnabled: boolean;
  theme: "light" | "dark" | "system";
  /** Show token usage and cost metrics during and after agent sessions */
  showSessionMetrics: boolean;
  /** Expand step timeline + tool logs by default in each assistant message */
  showMessageDetailsByDefault?: boolean;
  /** Site access policy for agent execution */
  siteAccessMode?: "allow_all" | "blocklist";
  /** Blocked domains when `siteAccessMode` is `blocklist` */
  siteAccessBlocklist?: string[];
  /** Hide navigate from tools */
  disableNavigation: boolean;
  /** Skip all user approval prompts (including high-risk tool approvals) */
  bypassApprovals: boolean;
  /** Max parallel workers for orchestrator task execution */
  orchestratorMaxWorkers?: number;
  /** Global token budget for one orchestrator task (planner + executor + verifier) */
  orchestratorMaxTotalTokens?: number;
  /** Auto-inject matching demos into agent context (default: true) */
  demosAutoInject?: boolean;
  /** Require user confirmation before executing multi-step plans (default: true) */
  requirePlanConfirmation?: boolean;
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
