import type { TraceSession } from "../types/traces";

export function formatTime(ms: number | undefined | null): string {
  if (!ms) return "---";
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  const secs = String(d.getSeconds()).padStart(2, "0");
  return `${month}/${day} ${hours}:${mins}:${secs}`;
}

export function formatDate(ms: number | undefined | null): string {
  if (!ms) return "---";
  const d = new Date(ms);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

export function formatDuration(ms: number | undefined | null): string {
  if (ms == null) return "---";
  if (!Number.isFinite(ms)) return "---";
  const safeMs = Math.max(0, Math.round(ms));
  if (safeMs < 1000) return `${safeMs}ms`;
  if (safeMs < 60000) return `${(safeMs / 1000).toFixed(1)}s`;
  return `${(safeMs / 60000).toFixed(1)}m`;
}

export function formatCost(cost: number | undefined | null): string {
  if (cost == null || cost === 0) return "";
  if (cost < 0.001) return `$${cost.toFixed(6)}`;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

export function formatTokens(n: number | undefined | null): string {
  if (n == null) return "---";
  if (n >= 10000) return `${(n / 1000).toFixed(1)}K`;
  if (n >= 1000) return n.toLocaleString("en-US");
  return String(n);
}

export function formatCount(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "-";
  return Math.round(n).toLocaleString("en-US");
}

export function formatPercent(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${Math.round(value * 100)}%`;
}

export function truncate(s: string | undefined | null, len: number): string {
  if (!s) return "";
  return s.length > len ? s.slice(0, len) + "..." : s;
}

const DEFAULT_TASK_DISPLAY_LABEL_MAX_CHARS = 220;
const CURRENT_REQUEST_MARKER = "CURRENT REQUEST:";
const INTERNAL_CONTEXT_MARKERS = [
  "RECENT WORKSPACE CONVERSATION:",
  "PROFILE DIGEST CONTEXT:",
  "PROFILE DIGEST FACTS:",
  "PROFILE POLICY:",
  "PROFILE DATA POLICY:",
  "JOB APPLICATION POLICY:",
  "ASHBY APPLICATION POLICY:",
  "Execution policy:",
  "Planner assumptions:",
  "Handoff context:",
  "Selected workflow skill:",
  "Skill procedure:",
  "Skill evidence requirements:",
  "Skill execution contract:",
  "Parallel work context:",
  "Reality check signal:",
  "Original user request",
  "Use this only to resolve follow-up references",
];

function normalizeTaskLabel(label: string | null | undefined): string {
  return (label ?? "").replace(/\s+/g, " ").trim();
}

function markerIndex(value: string, marker: string): number {
  return value.toLowerCase().indexOf(marker.toLowerCase());
}

function firstMarkerIndex(value: string, markers: string[]): number {
  let index = -1;
  for (const marker of markers) {
    const candidate = markerIndex(value, marker);
    if (candidate >= 0 && (index < 0 || candidate < index)) {
      index = candidate;
    }
  }
  return index;
}

function sectionAfterMarker(value: string, marker: string): string | null {
  const index = markerIndex(value, marker);
  if (index < 0) return null;
  const start = index + marker.length;
  const rest = value.slice(start).trim();
  if (!rest) return null;
  const end = firstMarkerIndex(rest, INTERNAL_CONTEXT_MARKERS);
  return (end >= 0 ? rest.slice(0, end) : rest).trim();
}

function truncateTaskLabel(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const slice = value.slice(0, Math.max(0, maxChars - 3)).trimEnd();
  const boundary = slice.lastIndexOf(" ");
  const trimmed =
    boundary >= Math.min(80, Math.floor(maxChars * 0.5))
      ? slice.slice(0, boundary).trimEnd()
      : slice;
  return `${trimmed}...`;
}

function containsInternalTaskContext(value: string): boolean {
  return (
    markerIndex(value, CURRENT_REQUEST_MARKER) >= 0 ||
    INTERNAL_CONTEXT_MARKERS.some((marker) => markerIndex(value, marker) >= 0)
  );
}

export function compactTraceTaskLabel(
  label: string | null | undefined,
  maxChars = DEFAULT_TASK_DISPLAY_LABEL_MAX_CHARS,
): string {
  let normalized = normalizeTaskLabel(label);
  if (!normalized) return "";

  const currentRequest = sectionAfterMarker(normalized, CURRENT_REQUEST_MARKER);
  if (currentRequest) {
    normalized = currentRequest;
  } else {
    const firstInternalMarker = firstMarkerIndex(
      normalized,
      INTERNAL_CONTEXT_MARKERS,
    );
    if (firstInternalMarker > 0) {
      normalized = normalized.slice(0, firstInternalMarker).trim();
    } else if (firstInternalMarker === 0) {
      normalized = "Working on the current task";
    }
  }

  normalized = normalized.replace(/^Objective:\s*/i, "").trim();
  return truncateTaskLabel(normalized, maxChars);
}

/** Extract a clean title from a query — strips "Objective:" prefix, takes first line. */
export function extractQueryTitle(query: string | undefined | null): {
  title: string;
  hasMore: boolean;
} {
  if (!query) return { title: "(no query)", hasMore: false };
  if (containsInternalTaskContext(query)) {
    return {
      title: compactTraceTaskLabel(query) || "(no query)",
      hasMore: false,
    };
  }
  const match = query.match(/^Objective:\s*(.+?)(?:\n|$)/);
  if (match) {
    return { title: match[1].trim(), hasMore: query.length > match[0].length };
  }
  const firstLine = query.split("\n")[0].trim();
  return { title: firstLine || "(no query)", hasMore: query.includes("\n") };
}

export function shortModel(model: string | undefined | null): string {
  if (!model) return "?";
  return model
    .replace("openai/", "")
    .replace("z-ai/", "")
    .replace("-instruct", "");
}

export function getSessionModels(
  session: Pick<TraceSession, "models" | "metrics">,
): string[] {
  const storedModels = Array.isArray(session.models)
    ? session.models.filter(
        (model): model is string => typeof model === "string" && model.length > 0,
      )
    : [];
  const breakdownModels = session.metrics?.modelBreakdown
    ? Object.keys(session.metrics.modelBreakdown)
    : [];
  return Array.from(new Set([...storedModels, ...breakdownModels]));
}

export function outcomeClass(outcome: string | undefined): string {
  switch (outcome) {
    case "completed":
    case "success":
      return "completed";
    case "stopped":
      return "stopped";
    case "failure":
    case "error":
      return "error";
    case "max_turns":
      return "max_turns";
    default:
      return "error";
  }
}

export function isoDayOffset(daysBack: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function summarizeEventData(ev: {
  data?: Record<string, unknown>;
}): string {
  if (!ev.data || Object.keys(ev.data).length === 0) return "";
  const parts: string[] = [];
  const keys = Object.keys(ev.data);
  for (let i = 0; i < keys.length && i < 4; i++) {
    const val = ev.data[keys[i]];
    if (typeof val === "string") parts.push(`${keys[i]}: ${truncate(val, 40)}`);
    else if (typeof val === "number" || typeof val === "boolean")
      parts.push(`${keys[i]}: ${val}`);
    else if (val != null)
      parts.push(`${keys[i]}: ${truncate(JSON.stringify(val), 40)}`);
  }
  if (keys.length > 4) parts.push("...");
  return parts.join(", ");
}
