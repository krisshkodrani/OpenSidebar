import {
  filterTraceFilesByWorkspace,
  findAllNewTraceFiles,
  readTrace,
  snapshotTraceFiles,
} from "./diagnostics";

export interface MemoryFactExpectation {
  label: string;
  patterns: RegExp[];
}

export function missingExpectedFacts(
  text: string,
  expectations: MemoryFactExpectation[],
): string[] {
  return expectations
    .filter((expectation) =>
      expectation.patterns.every((pattern) => !pattern.test(text)),
    )
    .map((expectation) => expectation.label);
}

export function collectTraceToolNames(traceFiles: string[]): string[] {
  return traceFiles.flatMap((filePath) =>
    readTrace(filePath).flatMap((turn) => turn.toolCalls.map((call) => call.name)),
  );
}

export function collectNewWorkspaceTraceFiles(
  before: Set<string>,
  workspaceId: string,
): string[] {
  return filterTraceFilesByWorkspace(findAllNewTraceFiles(before), workspaceId);
}

export function snapshotTraceBaseline(): Set<string> {
  return snapshotTraceFiles();
}
