import type { TraceEntry, TraceEvent } from "../../types/traces";

export type SkillTraceEventKind = "ranking_applied" | "selected" | "unknown";

export interface SkillTraceEventView {
  id: string;
  skillId?: string;
  skillName: string;
  kind: SkillTraceEventKind;
  turnNumber: number;
  timestamp?: number;
  sourceEventType: string;
  preferredTools?: string[];
  discouragedTools?: string[];
  originalOrder?: string[];
  rankedOrder?: string[];
  selectedToolName?: string;
  selectionPreference?: "preferred" | "neutral" | "discouraged";
  selectionMode?: "parallel" | "sequential";
  details?: string;
}

export interface SkillEventExtractionResult {
  events: SkillTraceEventView[];
  unavailableReason?: "no_entries" | "no_skill_events" | "unsupported_schema";
  diagnostics: string[];
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}

function isPreference(
  value: unknown,
): value is "preferred" | "neutral" | "discouraged" {
  return value === "preferred" || value === "neutral" || value === "discouraged";
}

function isMode(value: unknown): value is "parallel" | "sequential" {
  return value === "parallel" || value === "sequential";
}

function eventData(event: TraceEvent): Record<string, unknown> {
  return event.data && typeof event.data === "object"
    ? (event.data as Record<string, unknown>)
    : {};
}

export function extractSkillEvents(
  entries: TraceEntry[],
): SkillEventExtractionResult {
  if (entries.length === 0) {
    return {
      events: [],
      unavailableReason: "no_entries",
      diagnostics: ["No trace entries were loaded for this session."],
    };
  }

  const events: SkillTraceEventView[] = [];

  for (const entry of entries) {
    const turnEvents = entry.events ?? [];
    turnEvents.forEach((event, eventIndexWithinTurn) => {
      if (
        event.type !== "skill_tool_ranking_applied" &&
        event.type !== "skill_tool_selected"
      ) {
        return;
      }

      const data = eventData(event);
      const skillId =
        typeof data.skillId === "string" ? data.skillId : undefined;
      const turnNumber =
        typeof data.turn === "number" ? data.turn : entry.turnNumber;
      const id =
        event.eventId ??
        `${entry.sessionId}:${turnNumber}:${eventIndexWithinTurn}:${event.type}:${skillId ?? "unknown"}`;

      if (event.type === "skill_tool_ranking_applied") {
        events.push({
          id,
          skillId,
          skillName: skillId ?? "unknown",
          kind: "ranking_applied",
          turnNumber,
          timestamp: event.timestamp,
          sourceEventType: event.type,
          preferredTools: asStringArray(data.preferredTools),
          discouragedTools: asStringArray(data.discouragedTools),
          originalOrder: asStringArray(data.originalOrder),
          rankedOrder: asStringArray(data.rankedOrder),
        });
        return;
      }

      events.push({
        id,
        skillId,
        skillName: skillId ?? "unknown",
        kind: "selected",
        turnNumber,
        timestamp: event.timestamp,
        sourceEventType: event.type,
        selectedToolName:
          typeof data.toolName === "string" ? data.toolName : undefined,
        selectionPreference: isPreference(data.preference)
          ? data.preference
          : undefined,
        selectionMode: isMode(data.mode) ? data.mode : undefined,
      });
    });
  }

  return {
    events,
    unavailableReason: events.length === 0 ? "no_skill_events" : undefined,
    diagnostics:
      events.length === 0
        ? ["No structured skill ranking or selection events were recorded."]
        : [],
  };
}
