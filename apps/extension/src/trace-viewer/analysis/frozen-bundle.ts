import type { TraceEntry, TracePageStateCapture } from "../../types/traces";
import type { SessionLogEntry } from "../store/types";
import { buildTraceInvestigationReport } from "./report";
import type {
  FrozenTraceBundle,
  FrozenTraceScreenshot,
  TraceAnalysisInput,
} from "./types";

interface BuildFrozenTraceBundleInput extends TraceAnalysisInput {
  logs?: SessionLogEntry[];
}

function screenshotFileName(
  sessionId: string,
  turnNumber: number,
  suffix?: string,
): string {
  return `${sessionId}-T${turnNumber}${suffix ?? ""}.jpg`;
}

function collectCaptureScreenshots(
  entry: TraceEntry,
  capture: TracePageStateCapture | undefined,
): FrozenTraceScreenshot[] {
  if (!capture?.screenshots?.length) return [];
  return capture.screenshots.map((shot, index) => ({
    sessionId: entry.sessionId,
    turnNumber: entry.turnNumber,
    fileName:
      shot.kind === "panorama"
        ? screenshotFileName(entry.sessionId, entry.turnNumber, `-pan${index}`)
        : screenshotFileName(entry.sessionId, entry.turnNumber),
    dataUrl: shot.dataUrl,
  }));
}

export function collectFrozenTraceScreenshots(
  entries: TraceEntry[],
): FrozenTraceScreenshot[] {
  const screenshots: FrozenTraceScreenshot[] = [];
  const seen = new Set<string>();

  function push(screenshot: FrozenTraceScreenshot): void {
    const key = `${screenshot.sessionId}:${screenshot.turnNumber}:${screenshot.fileName ?? ""}:${screenshot.dataUrl ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    screenshots.push(screenshot);
  }

  for (const entry of entries) {
    if (entry.perception?.screenshotDataUrl) {
      push({
        sessionId: entry.sessionId,
        turnNumber: entry.turnNumber,
        fileName: screenshotFileName(entry.sessionId, entry.turnNumber),
        dataUrl: entry.perception.screenshotDataUrl,
      });
    } else if (entry.perception?.screenshotStatus === "captured") {
      push({
        sessionId: entry.sessionId,
        turnNumber: entry.turnNumber,
        fileName: screenshotFileName(entry.sessionId, entry.turnNumber),
      });
    }

    for (const screenshot of collectCaptureScreenshots(
      entry,
      entry.pageState?.preDecision,
    )) {
      push(screenshot);
    }
    for (const screenshot of collectCaptureScreenshots(
      entry,
      entry.pageState?.postTool,
    )) {
      push(screenshot);
    }
  }

  return screenshots;
}

export function buildFrozenTraceBundle({
  session,
  entries,
  runEvents = [],
  logs = [],
}: BuildFrozenTraceBundleInput): FrozenTraceBundle {
  const reportInput: TraceAnalysisInput = {
    session,
    entries,
    runEvents,
    logs,
  };

  return {
    schemaVersion: "2026-05-30",
    traceKind: "trace.viewer.frozen_bundle",
    frozenAt: new Date().toISOString(),
    session,
    entries,
    runEvents: runEvents.length > 0 ? runEvents : undefined,
    logs: logs.length > 0 ? logs : undefined,
    screenshots: collectFrozenTraceScreenshots(entries),
    report: buildTraceInvestigationReport(reportInput, {
      maxFindings: 8,
      maxTurns: 8,
      turnWindow: 1,
    }),
  };
}
