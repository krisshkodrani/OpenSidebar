import type { TraceEntry } from "../../types/traces";

export interface RepeatActionPattern {
  previous: TraceEntry;
  current: TraceEntry;
  kind: "exact" | "near";
  toolSequence: string[];
}

const VOLATILE_ID_KEYS = new Set([
  "id",
  "elementId",
  "nodeId",
  "sourceId",
  "targetId",
  "tag",
  "tagId",
]);

export const REPEAT_ACTION_DEFAULT_WINDOW_SIZE = 5;
export const REPEAT_ACTION_DEFAULT_MAX_FINDINGS = 3;

function stableValue(
  value: unknown,
  normalizeVolatileIds: boolean,
  key?: string,
): unknown {
  const isVolatileIdKey = key ? VOLATILE_ID_KEYS.has(key) : false;
  if (value == null) return value;
  if (typeof value === "number") {
    return normalizeVolatileIds && isVolatileIdKey ? "<number>" : value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (normalizeVolatileIds && isVolatileIdKey && /^\d+$/.test(trimmed)) {
      return "<number>";
    }
    try {
      const url = new URL(trimmed);
      return `${url.origin}${url.pathname}`;
    } catch {
      return trimmed.toLowerCase();
    }
  }
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item, normalizeVolatileIds));
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      result[key] =
        normalizeVolatileIds && VOLATILE_ID_KEYS.has(key)
          ? "<element-id>"
          : stableValue(
              (value as Record<string, unknown>)[key],
              normalizeVolatileIds,
              key,
            );
    }
    return result;
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function toolFingerprints(
  entry: TraceEntry,
  normalizeVolatileIds: boolean,
): string[] {
  return (entry.toolExecutions ?? []).map((tool) =>
    stableJson({
      tool: String(tool.toolName),
      args: stableValue(tool.args ?? {}, normalizeVolatileIds),
    }),
  );
}

export function toolNames(entry: TraceEntry): string[] {
  return (entry.toolExecutions ?? []).map((tool) => String(tool.toolName));
}

export function sameSnapshot(
  a: TraceEntry | undefined,
  b: TraceEntry | undefined,
): boolean {
  if (!a || !b) return false;
  return (
    a.snapshot?.url === b.snapshot?.url &&
    a.snapshot?.title === b.snapshot?.title &&
    a.snapshot?.elementCount === b.snapshot?.elementCount
  );
}

export function compareToolSequence(
  a: TraceEntry | undefined,
  b: TraceEntry | undefined,
): "exact" | "near" | null {
  if (!a || !b) return null;
  const prevNames = toolNames(a);
  const nextNames = toolNames(b);
  if (prevNames.length === 0 || prevNames.join("|") !== nextNames.join("|")) {
    return null;
  }

  const exactPrev = toolFingerprints(a, false);
  const exactNext = toolFingerprints(b, false);
  if (exactPrev.join("|") === exactNext.join("|")) return "exact";

  const nearPrev = toolFingerprints(a, true);
  const nearNext = toolFingerprints(b, true);
  return nearPrev.join("|") === nearNext.join("|") ? "near" : null;
}

export function findRepeatedActionPatterns(
  entries: TraceEntry[],
  options: { windowSize?: number; maxFindings?: number } = {},
): RepeatActionPattern[] {
  const windowSize = options.windowSize ?? REPEAT_ACTION_DEFAULT_WINDOW_SIZE;
  const maxFindings =
    options.maxFindings ?? REPEAT_ACTION_DEFAULT_MAX_FINDINGS;
  const findings: RepeatActionPattern[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < entries.length; i++) {
    const current = entries[i];
    const start = Math.max(0, i - windowSize);
    for (let j = i - 1; j >= start; j--) {
      const previous = entries[j];
      if (!sameSnapshot(previous, current)) continue;
      const kind = compareToolSequence(previous, current);
      if (!kind) continue;
      const key = `${previous.turnNumber}:${current.turnNumber}:${kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        previous,
        current,
        kind,
        toolSequence: toolNames(current),
      });
      break;
    }
    if (findings.length >= maxFindings) break;
  }

  return findings;
}
