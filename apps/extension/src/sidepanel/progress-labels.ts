export function normalizeProgressLabel(
  label: string | null | undefined,
): string {
  return (label ?? "").replace(/\s+/g, " ").trim();
}

function stripActorPrefix(label: string): string {
  return label.replace(/^(agent|executor|planner|verifier)\s*:\s*/i, "");
}

export function isGenericProgressLabel(
  label: string | null | undefined,
): boolean {
  const normalized = stripActorPrefix(normalizeProgressLabel(label))
    .toLowerCase()
    .replace(/\.+$/, "");
  return normalized === "thinking";
}

export function usefulProgressLabel(
  label: string | null | undefined,
): string | null {
  const normalized = normalizeProgressLabel(label);
  if (!normalized || isGenericProgressLabel(normalized)) return null;
  return normalized;
}
