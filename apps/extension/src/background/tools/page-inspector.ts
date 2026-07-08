/**
 * Read-only page inspectors (RFC LP-16 Phase 4). Run a sync or async
 * read-only inspector function in the page's MAIN world and return its
 * result. Verbatim movement from tools/index.ts.
 */

import { chromeContentBridgePort } from "../environment/chrome";

export async function runReadOnlyPageInspector(
  tabId: number,
  func: (...args: any[]) => string,
  args: unknown[],
  emptyMessage: string,
): Promise<string> {
  try {
    const results = await chromeContentBridgePort.executeFunction(
      tabId,
      func,
      args,
      { allFrames: true, world: "MAIN" },
    );
    const frames = results
      .map((result, index) =>
        typeof result.result === "string" && result.result.trim()
          ? `Frame ${index + 1}:\n${result.result.trim()}`
          : "",
      )
      .filter(Boolean);
    return frames.length > 0 ? frames.join("\n\n") : emptyMessage;
  } catch (e: any) {
    return `Error inspecting page: ${e.message}`;
  }
}

export async function runAsyncReadOnlyPageInspector(
  tabId: number,
  func: (...args: any[]) => Promise<string> | string,
  args: unknown[],
  emptyMessage: string,
): Promise<string> {
  try {
    const results = await chromeContentBridgePort.executeFunction(
      tabId,
      func,
      args,
      { allFrames: true, world: "MAIN" },
    );
    const frames = results
      .map((result, index) =>
        typeof result.result === "string" && result.result.trim()
          ? `Frame ${index + 1}:\n${result.result.trim()}`
          : "",
      )
      .filter(Boolean);
    return frames.length > 0 ? frames.join("\n\n") : emptyMessage;
  } catch (e: any) {
    return `Error inspecting page: ${e.message}`;
  }
}

// --- Registration ---
