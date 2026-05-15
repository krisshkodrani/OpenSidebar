export function normalizeProgressLabel(
  label: string | null | undefined,
): string {
  return (label ?? "").replace(/\s+/g, " ").trim();
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

function stripActorPrefix(label: string): string {
  return label.replace(/^(agent|executor|planner|verifier)\s*:\s*/i, "");
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

function truncateDisplayLabel(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const slice = value.slice(0, Math.max(0, maxChars - 3)).trimEnd();
  const boundary = slice.lastIndexOf(" ");
  const trimmed =
    boundary >= Math.min(80, Math.floor(maxChars * 0.5))
      ? slice.slice(0, boundary).trimEnd()
      : slice;
  return `${trimmed}...`;
}

export function compactTaskDisplayLabel(
  label: string | null | undefined,
  maxChars = DEFAULT_TASK_DISPLAY_LABEL_MAX_CHARS,
): string {
  let normalized = normalizeProgressLabel(label);
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
  return truncateDisplayLabel(normalized, maxChars);
}

function normalizedDisplayKey(label: string): string {
  return stripActorPrefix(normalizeProgressLabel(label))
    .toLowerCase()
    .replace(/\.+$/, "");
}

export function displayProgressLabel(
  label: string | null | undefined,
): string | null {
  const normalized = normalizeProgressLabel(label);
  if (!normalized) return null;

  const stripped = stripActorPrefix(normalized);
  const key = normalizedDisplayKey(normalized);
  if (key === "thinking") return null;
  if (key === "read page") return "Scanning page";
  if (key === "toggle x-ray mode") return "Inspecting page structure";
  if (key === "verifying completion") return "Checking result";
  if (key === "planning task") return "Planning task";
  if (key === "understanding request") return "Understanding request";
  if (key.startsWith("inspect hidden")) {
    return stripped.replace(/^Inspect hidden/i, "Checking hidden page state");
  }
  if (key.startsWith("read text of") || key.startsWith("read ")) {
    return stripped.replace(/^Read/i, "Checking");
  }
  if (key.startsWith("escalate")) return "Switching strategy";
  return compactTaskDisplayLabel(stripped);
}

export function isGenericProgressLabel(
  label: string | null | undefined,
): boolean {
  const normalized = normalizedDisplayKey(label ?? "");
  return normalized === "thinking";
}

export function isLowLevelProgressLabel(
  label: string | null | undefined,
): boolean {
  const key = normalizedDisplayKey(label ?? "");
  return (
    key === "read page" ||
    key === "scanning page" ||
    key === "toggle x-ray mode" ||
    key === "inspecting page structure" ||
    key === "verifying completion" ||
    key === "checking result" ||
    key === "planning task" ||
    key === "understanding request" ||
    key.startsWith("inspect hidden") ||
    key.startsWith("checking hidden page state") ||
    key.startsWith("read text of") ||
    key.startsWith("checking text of") ||
    key.startsWith("verifier checked node")
  );
}

export function usefulProgressLabel(
  label: string | null | undefined,
): string | null {
  return displayProgressLabel(label);
}
