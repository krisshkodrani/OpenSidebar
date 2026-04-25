/**
 * OpenSidebar — User settings, workspaces, navigation, and utility types
 */

import type { AgentLoopState } from "./agent";

// --- Configuration Types ---

export type TTSProviderMode = "auto" | "groq" | "openai" | "gemini";
export type PerceptionRuntimeMode = "auto" | "unified_vl" | "structured";

export type TTSStylePreset =
  | "neutral"
  | "friendly"
  | "calm"
  | "excited"
  | "serious";

export interface UserSettings {
  openRouterApiKey: string;
  /** Provider mode: how LLM providers are combined across roles */
  providerMode?:
    | "openrouter"
    | "openrouter-groq"
    | "openai-groq"
    | "fireworks"
    | "moonshot";
  /** @deprecated Use providerMode instead. Kept for migration. */
  provider?: "openrouter" | "openai" | "groq";
  /** OpenAI API key (required for openai-groq mode) */
  openaiApiKey?: string;
  /** Groq API key (required for hybrid modes) */
  groqApiKey?: string;
  /** Gemini API key (optional, used for Gemini TTS) */
  geminiApiKey?: string;
  /** Fireworks AI API key (required for fireworks mode) */
  fireworksApiKey?: string;
  /** Moonshot AI API key (required for moonshot mode) */
  kimiApiKey?: string;
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
  /** Require user confirmation before executing multi-step plans (default: true) */
  requirePlanConfirmation?: boolean;
  /** Override executor model (default: google/gemini-3-flash-preview) */
  executorModel?: string;
  /** Override planner model (default: minimax/minimax-m2.5) */
  plannerModel?: string;
  /** Override perception model (default: x-ai/grok-4.1-fast) */
  perceptionModel?: string;
  /** Append :nitro variant suffix to all model IDs for faster inference (default: false) */
  useNitro?: boolean;
  /** Override default LLM temperature (default: 0.0 for deterministic agentic behavior) */
  temperature?: number;
  /**
   * Runtime observation path.
   * - `auto`: unified VL on Fireworks, structured perception elsewhere
   * - `unified_vl`: screenshot goes directly to the executor
   * - `structured`: dedicated perception layer produces `Page Interpretation`
   */
  perceptionMode?: PerceptionRuntimeMode;
  /** @deprecated Use `perceptionMode` instead. */
  /** Use VL model as unified executor+perception — screenshot sent directly to executor (default: false) */
  useVLExecutor?: boolean;
  /** Enable voice input via microphone (STT) */
  enableVoiceInput?: boolean;
  /** Enable voice output on assistant messages (TTS) */
  enableVoiceOutput?: boolean;
  /** Preferred TTS provider (auto picks Groq first, then OpenAI, then Gemini) */
  ttsProvider?: TTSProviderMode;
  /** TTS voice selection for the active provider */
  ttsVoice?: string;
  /** Expressive speech preset for Gemini TTS */
  ttsStylePreset?: TTSStylePreset;
  /** Automatically speak the final assistant response when the agent finishes */
  autoVoiceResponse?: boolean;
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
