import type { TraceEntry, TraceSession } from "../types/traces";
import { computeSessionDiagnostics, type SessionDiagnostics } from "./diagnostics";
import { getSessionModels } from "./utils";

export interface SessionComparison {
  leftDiagnostics: SessionDiagnostics;
  rightDiagnostics: SessionDiagnostics;
  divergenceTurn: number | null;
  sharedToolPrefixTurns: number;
  leftModels: string[];
  rightModels: string[];
}

function toolSignature(entry: TraceEntry): string {
  const tools = entry.toolExecutions.map((tool) => tool.toolName).join("|");
  const model = entry.llmResponse?.actualModel ?? entry.llmRequest?.model ?? "";
  return `${tools}::${model}::${entry.snapshot.url}`;
}

export function summarizeSessionComparison(
  leftSession: TraceSession,
  rightSession: TraceSession,
  leftEntries: TraceEntry[],
  rightEntries: TraceEntry[],
): SessionComparison {
  const sharedTurns = Math.min(leftEntries.length, rightEntries.length);
  let sharedToolPrefixTurns = 0;
  let divergenceTurn: number | null = null;

  for (let i = 0; i < sharedTurns; i++) {
    if (toolSignature(leftEntries[i]) === toolSignature(rightEntries[i])) {
      sharedToolPrefixTurns++;
      continue;
    }
    divergenceTurn = i + 1;
    break;
  }

  if (divergenceTurn == null && leftEntries.length !== rightEntries.length) {
    divergenceTurn = sharedTurns + 1;
  }

  return {
    leftDiagnostics: computeSessionDiagnostics(leftSession, leftEntries),
    rightDiagnostics: computeSessionDiagnostics(rightSession, rightEntries),
    divergenceTurn,
    sharedToolPrefixTurns,
    leftModels: getSessionModels(leftSession),
    rightModels: getSessionModels(rightSession),
  };
}
