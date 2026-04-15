/**
 * Backend Agent Service — shared types
 */

// ── Memory types (GBrain-backed) ──

export interface MemoryInput {
  category: MemoryCategory;
  title: string;
  content: string;
  workspaceId?: string;
  metadata?: MemoryMetadata;
}

export type MemoryMetadata = Record<string, unknown>;

export type MemoryCategory =
  | "execution-result"
  | "user-preference"
  | "site-knowledge"
  | "learned-pattern";

export interface MemoryResult {
  slug: string;
  title: string;
  category: MemoryCategory;
  content: string;
  score: number;
  metadata?: MemoryMetadata;
}

export interface MemoryListResult {
  slug: string;
  title: string;
  type: string;
}

// —— Profile types (filesystem-backed) ——

export type ProfileScalar = string | number | boolean | null;
export type ProfileValue =
  | ProfileScalar
  | ProfileScalar[]
  | Record<string, unknown>;

export interface PersonalProfileDocument {
  profile: Record<string, unknown>;
}

export interface ProfileResolveInput {
  fields: string[];
}

export interface ProfileResolveResult {
  profilePath: string;
  values: Record<string, ProfileValue>;
  missing: string[];
  sensitiveFields: string[];
}

// ── Task types (SQLite-backed) ──

export interface TaskInput {
  description: string;
  query: string;
  schedule?: string; // cron expression
  runAt?: number; // unix ms (for one-shot)
  tabUrl?: string;
  workspaceId?: string;
}

export interface ScheduledTask {
  id: string;
  description: string;
  query: string;
  tabUrl: string | null;
  workspaceId: string | null;
  schedule: string | null;
  runAt: number | null;
  status: TaskStatus;
  lastRunAt: number | null;
  result: string | null;
  createdAt: number;
  updatedAt: number;
}

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface TaskPatch {
  status?: TaskStatus;
  result?: string;
}

// ── Config ──

export interface BackendConfig {
  server: {
    port: number;
    host: string;
  };
  gbrain: {
    enabled: boolean;
    databasePath: string;
    mcpCommand: string;
    mcpArgs: string[];
  };
  tasks: {
    databasePath: string;
    tickIntervalSeconds: number;
    maxConcurrent: number;
  };
}

// ── Health ──

export interface HealthResponse {
  status: "ok" | "degraded";
  uptime: number;
  gbrainConnected: boolean;
  pendingTasks: number;
  memoryStats?: { pageCount: number };
}
