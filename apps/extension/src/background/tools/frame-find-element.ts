import { MessageSource, ToolName, type ToolResultMessage } from "../../types";
import { frameActionRoutes } from "../perception/frame-action-routes";
import { executeContentTool } from "./bridge";

/** Search the top document, then each observed child, preserving actionable tags. */
export async function findElementAcrossFrames(
  args: Record<string, unknown>,
  tabId: number,
): Promise<string | { result: string; errorCode: "stale_observation" }> {
  const topResult = await executeContentTool(ToolName.FIND_ELEMENT, args, tabId);
  if (typeof topResult !== "string" ||
      /^Found .*\bnear \[\d+\]/.test(topResult))
    return topResult;

  let unavailableFrames = 0;
  for (const { frameId, documentState } of frameActionRoutes.childTargets(tabId)) {
    const requestId = crypto.randomUUID();
    let response: ToolResultMessage;
    try {
      response = await Promise.race([
        chrome.tabs.sendMessage(tabId, {
          type: "FRAME_TOOL_EXECUTE",
          requestId,
          source: MessageSource.BACKGROUND,
          payload: { toolName: ToolName.FIND_ELEMENT, args,
            toolCallId: requestId, observationBasis: documentState },
        }, { frameId }) as Promise<ToolResultMessage>,
        new Promise<never>((_, reject) => setTimeout(
          () => reject(new Error("Frame search timed out")), 3_000)),
      ]);
    } catch {
      unavailableFrames += 1;
      continue;
    }
    if (response.type !== "TOOL_RESULT" || response.requestId !== requestId ||
        response.payload?.errorCode === "stale_observation") {
      unavailableFrames += 1;
      continue;
    }
    if (!response.payload?.success || !response.payload.result.startsWith("Found "))
      continue;
    const localTag = /\bnear \[(\d+)\]/.exec(response.payload.result)?.[1];
    if (!localTag) continue;
    const globalTag = frameActionRoutes.assignFoundTag(tabId, frameId,
      Number(localTag), documentState);
    if (globalTag === null) return { result: "Error: The observed frame is no longer available. Read the page again before retrying.",
      errorCode: "stale_observation" };
    return response.payload.result.replaceAll(`[${localTag}]`, `[${globalTag}]`);
  }
  return unavailableFrames ? `${topResult}\nContent in ${unavailableFrames} embedded frame(s) could not be searched.`
    : topResult;
}
