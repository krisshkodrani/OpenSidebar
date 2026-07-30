/**
 * OpenSidebar — User settings, workspaces, navigation, and utility types
 */

import type { AgentLoopState } from "./agent";

// --- Configuration Types ---

export type PerceptionRuntimeMode = "auto" | "unified_vl" | "structured";
/** LP-24 presence layer: visible agent cursor rendered in-page while acting */
export type PresenceMode = "off" | "subtle" | "cinematic";
export const DEFAULT_PRESENCE_MODE: PresenceMode = "subtle";
export type LaneTopologyMode = "simple" | "standard" | "full";
export const DEFAULT_MAX_IMAGE_PROMPT_TOKEN_ESTIMATE = 25_000;
export const DEFAULT_ENABLED_SKILL_PACK_IDS = [
  "communication-workflows",
  "procurement-workflows",
  "servicenow-platform",
];

export interface UserSettings {
  openRouterApiKey: string;
  /** Provider mode: how LLM providers are combined across roles */
  providerMode?:
    | "openrouter"
    | "openrouter-groq"
    | "openai-groq"
    | "fireworks"
    | "fireworks-deepseek"
    | "cerebras-fireworks"
    | "moonshot"
    | "xiaomi";
  /** @deprecated Use providerMode instead. Kept for migration. */
  provider?: "openrouter" | "openai" | "groq";
  /** @deprecated Retained for migration; no product-ready OpenAI stack is exposed. */
  openaiApiKey?: string;
  /** Groq API key (required for hybrid modes) */
  groqApiKey?: string;
  /** @deprecated Retained for migration; the runtime has no Gemini model seat. */
  geminiApiKey?: string;
  /** Fireworks AI API key (required for fireworks mode) */
  fireworksApiKey?: string;
  /** DeepSeek API key (required for fireworks-deepseek planner/verifier mode) */
  deepseekApiKey?: string;
  /** Moonshot AI API key (required for moonshot mode) */
  kimiApiKey?: string;
  /** Xiaomi MiMo API key (required for xiaomi mode) */
  xiaomiApiKey?: string;
  /** Cerebras API key (required for cerebras-fireworks executor mode) */
  cerebrasApiKey?: string;
  maxTurns: number;
  theme: "light" | "dark" | "system";
  /** Show token usage and cost metrics during and after agent sessions */
  showSessionMetrics: boolean;
  /** Expand step timeline + tool logs by default in each assistant message */
  showMessageDetailsByDefault?: boolean;
  /** Show debug screenshot toasts in the sidepanel when captures are emitted */
  showDebugScreenshots?: boolean;
  /** Show Chrome browser notifications for important agent events */
  enableBrowserNotifications?: boolean;
  /** Site access policy for agent execution */
  siteAccessMode?: "allow_all" | "blocklist";
  /** Blocked domains when `siteAccessMode` is `blocklist` */
  siteAccessBlocklist?: string[];
  /** Require user approval for high-risk actions (default: true) */
  requireApprovals: boolean;
  /** Allow agent to open or switch to new pages (default: true) */
  allowNavigation: boolean;
  /**
   * Optional runtime navigation boundary. When set, browser navigation tools may
   * only navigate to these origins, and generic web-search navigation is blocked.
   */
  allowedNavigationOrigins?: string[];
  /** Require user confirmation before executing multi-step plans (default: true) */
  requirePlanConfirmation?: boolean;
  /** Orchestrator lane topology. Defaults to full planner/executor/verifier topology. */
  laneTopologyMode?: LaneTopologyMode;
  /** Enabled optional built-in skill packs. Defaults to DEFAULT_ENABLED_SKILL_PACK_IDS. */
  enabledSkillPackIds?: string[];
  /**
   * Skill ids excluded from selection — the ablation switch. Lets a run (or an
   * A/B eval) execute with specific skills off without editing the catalog.
   */
  disabledSkillIds?: string[];
  /** Override executor model. Must support screenshots and tool calling. */
  executorModel?: string;
  /** Override planner model. */
  plannerModel?: string;
  /**
   * Optional specialist Writer model for composing free-text/prose answers
   * (e.g. job-application questions, message bodies). When set, the agent
   * prefers it within that scope; when empty it falls back to the executor.
   */
  writerModel?: string;
  /** Append :nitro variant suffix to all model IDs for faster inference (default: false) */
  useNitro?: boolean;
  /** Override default LLM temperature (default: 0.0 for deterministic agentic behavior) */
  temperature?: number;
  /**
   * Runtime observation path.
   * - `auto`: runtime chooses structured DOM text or unified VL from task/page signals
   * - `unified_vl`: screenshot always goes directly to the executor
   * - `structured`: DOM text and element data; screenshots are not sent directly to the executor
   */
  perceptionMode?: PerceptionRuntimeMode;
  /**
   * Maximum estimated image prompt tokens per agent session.
   * Uses conservative high-detail screenshot estimates; auto perception falls
   * back to structured DOM mode when this budget is exhausted.
   */
  maxImagePromptTokenEstimate?: number;
  /**
   * LP-24 presence layer: synthetic cursor + action choreography rendered
   * in-page while the agent acts. Presentation-only — never changes event
   * dispatch. Default: "subtle".
   */
  presenceMode?: PresenceMode;
  /**
   * Hide the presence cursor while the agent captures its own screenshots
   * (default: true — the model never sees the synthetic pointer). Turning it
   * off removes the brief per-turn blink at the cost of the cursor being
   * visible in the agent's view of the page.
   */
  presenceHideDuringCapture?: boolean;
}

// --- Workspace / Tab Group Types ---

export interface Workspace {
  id: string;
  name: string;
  /** Original "OS N" name, preserved for restoration after tasks complete */
  baseName?: string;
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
