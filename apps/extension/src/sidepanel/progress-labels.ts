export function normalizeProgressLabel(
  label: string | null | undefined,
): string {
  return (label ?? "").replace(/\s+/g, " ").trim();
}

function stripActorPrefix(label: string): string {
  return label.replace(/^(agent|executor|planner|verifier)\s*:\s*/i, "");
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
  return stripped;
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
