/** Versioned contracts for LP-28's authenticated cloud control plane. */

import type {
  LaneTopologyMode,
  PerceptionRuntimeMode,
  PresenceMode,
} from "./settings";
import type { ToolDefinition } from "./tools";

export type RelayContentPart =
  | { type: "text"; text: string }
  | {
      type: "image_url";
      image_url: { url: string; detail?: "low" | "high" | "auto" };
    };

export interface RelayToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface RelayMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | RelayContentPart[];
  tool_calls?: RelayToolCall[];
  tool_call_id?: string;
  name?: string;
  cache_control?: { type: "ephemeral" };
}

export interface RelayTokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost?: number;
  cached_tokens?: number;
}

export const CLOUD_CONTROL_SCHEMA_VERSION = 1 as const;
export type CloudProviderId = "openrouter" | "fireworks";

export interface CloudPreferencesV1 {
  schemaVersion: typeof CLOUD_CONTROL_SCHEMA_VERSION;
  revision: number;
  inferenceMode: "local" | "cloud";
  providerMode: "openrouter" | "fireworks";
  executorModel?: string;
  plannerModel?: string;
  writerModel?: string;
  maxTurns: number;
  theme: "light" | "dark" | "system";
  showSessionMetrics: boolean;
  showMessageDetailsByDefault?: boolean;
  laneTopologyMode?: LaneTopologyMode;
  enabledSkillPackIds?: string[];
  disabledSkillIds?: string[];
  useNitro?: boolean;
  temperature?: number;
  perceptionMode?: PerceptionRuntimeMode;
  maxImagePromptTokenEstimate?: number;
  presenceMode?: PresenceMode;
  presenceHideDuringCapture?: boolean;
}

/** These settings must never become remotely authoritative. */
export interface LocalSafetySettingsV1 {
  schemaVersion: typeof CLOUD_CONTROL_SCHEMA_VERSION;
  requireApprovals: boolean;
  requirePlanConfirmation?: boolean;
  allowNavigation: boolean;
  allowedNavigationOrigins?: string[];
  siteAccessMode?: "allow_all" | "blocklist";
  siteAccessBlocklist?: string[];
  fleetTelemetryConsent?: boolean;
}

export interface CredentialStatusV1 {
  schemaVersion: typeof CLOUD_CONTROL_SCHEMA_VERSION;
  provider: CloudProviderId;
  configured: boolean;
  fingerprint?: string;
  lastVerifiedAt?: string;
  verification: "never" | "valid" | "invalid" | "unavailable";
}

export interface RelayRequestV1 {
  schemaVersion: typeof CLOUD_CONTROL_SCHEMA_VERSION;
  requestId: string;
  abortScopeId: string;
  provider: CloudProviderId;
  modelId: string;
  seat: "executor" | "planner" | "writer" | "judge";
  messages: RelayMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  responseFormat?: { type: "json_object" };
  toolChoice?: "auto" | "required" | "none";
}

export interface CloudAccountV1 {
  schemaVersion: typeof CLOUD_CONTROL_SCHEMA_VERSION;
  accountId: string;
  email: string;
  cloudAccess: boolean;
  sessionEpoch: number;
}

export interface CloudDeviceV1 {
  schemaVersion: typeof CLOUD_CONTROL_SCHEMA_VERSION;
  id: string;
  installationId: string;
  displayName: string;
  extensionVersion: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt?: string;
}

export interface ExtensionSessionV1 {
  schemaVersion: typeof CLOUD_CONTROL_SCHEMA_VERSION;
  accessToken: string;
  accessExpiresInSeconds: number;
  refreshToken: string;
  refreshExpiresInSeconds: number;
  account: CloudAccountV1;
  device: CloudDeviceV1;
}

export type RelayEventV1 =
  | {
      schemaVersion: 1;
      type: "delta";
      content?: string;
      toolCalls?: RelayToolCall[];
    }
  | {
      schemaVersion: 1;
      type: "completed";
      finishReason: "stop" | "length" | "tool_calls" | "content_filter";
      usage?: RelayTokenUsage;
      provider: CloudProviderId;
      model: string;
    }
  | {
      schemaVersion: 1;
      type: "error";
      code:
        | "not_authenticated"
        | "credential_missing"
        | "quota_exceeded"
        | "provider_rejected"
        | "provider_unavailable"
        | "invalid_request"
        | "cancelled";
      retryable: boolean;
    };

export interface UsageSnapshotV1 {
  schemaVersion: typeof CLOUD_CONTROL_SCHEMA_VERSION;
  periodStart: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  concurrentStreams: number;
  limits: {
    requests: number;
    tokens: number;
    concurrentStreams: number;
  };
}

export interface CloudDashboardSummaryV1 {
  schemaVersion: typeof CLOUD_CONTROL_SCHEMA_VERSION;
  account: CloudAccountV1;
  devices: CloudDeviceV1[];
  credentials: CredentialStatusV1[];
  preferences: CloudPreferencesV1 | null;
  usage: UsageSnapshotV1;
  sessions: {
    enabled: boolean;
    authorized: boolean;
    recent: import("./cloud-sessions").CloudSessionV1[];
  };
  detailedTraces: "local_only";
}

export interface CloudSessionTimelineEventV1 {
  schemaVersion: typeof CLOUD_CONTROL_SCHEMA_VERSION;
  id: string;
  kind:
    | "session_created"
    | "session_updated"
    | "checkpoint_committed"
    | "device_active";
  occurredAt: string;
  label: string;
  detail: string;
}

export interface CloudActivationStatusV1 {
  schemaVersion: typeof CLOUD_CONTROL_SCHEMA_VERSION;
  stage:
    | "disabled"
    | "sessions"
    | "checkpoint-writes"
    | "checkpoint-restore"
    | "commands"
    | "takeover";
  flags: {
    cloudSessions: boolean;
    checkpointWrites: boolean;
    checkpointRestore: boolean;
    sessionExports: boolean;
    deviceCommands: boolean;
    deviceTakeover: boolean;
    temporalShadow: boolean;
    temporalCoordination: boolean;
  };
  namedTesterCount: number;
  operatorMode: "read_only";
}
