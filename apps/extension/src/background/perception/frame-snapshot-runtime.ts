import { MessageSource, type DomSnapshotRequest, type DomSnapshotResponse,
  type UserSettings } from "../../types";
import { logger } from "../../utils";
import { chromePersistencePort } from "../environment/chrome";
import { frameActionRoutes } from "./frame-action-routes";
import { collectCrossOriginFrameSnapshots } from "./frame-snapshot-collector";

export const FRAME_TEMPORARILY_UNAVAILABLE =
  "embedded frame(s) is temporarily unavailable.";
export const FRAME_COLLECTION_UNAVAILABLE =
  "Embedded frame content could not be checked for this page.";

async function frameReachEnabled(): Promise<boolean> {
  const stored = await chromePersistencePort.sync.get("userSettings")
    .catch(() => ({} as Record<string, unknown>));
  const settings = stored.userSettings as Partial<UserSettings> | undefined;
  return settings?.crossOriginFramesEnabled ?? __DEV__;
}

/** Merge a top-frame read with bounded child reads and refresh runtime tag routes. */
export async function mergeFrameSnapshotResponse(
  tabId: number,
  response: DomSnapshotResponse,
): Promise<DomSnapshotResponse> {
  const generation = frameActionRoutes.beginRead(tabId);
  if (!response?.payload?.snapshot || !response.payload.documentState ||
      !await frameReachEnabled()) {
    frameActionRoutes.invalidate(tabId);
    return response;
  }
  try {
    const { children, missingFrameIds, collectionUnavailable } =
      await collectCrossOriginFrameSnapshots(tabId, 150,
        response.payload.documentState.url);
    if (!frameActionRoutes.isCurrentRead(tabId, generation)) return response;
    const merged = frameActionRoutes.publish(tabId, response.payload.snapshot,
      response.payload.documentState, children);
    const skipped = new Set([...missingFrameIds, ...merged.skippedFrameIds]);
    const diagnostics = [
      ...(skipped.size ? [
        `Content in ${skipped.size} ${FRAME_TEMPORARILY_UNAVAILABLE}`,
      ] : []),
      ...(collectionUnavailable ? [
        FRAME_COLLECTION_UNAVAILABLE,
      ] : []),
    ];
    const snapshot = diagnostics.length === 0 ? merged.snapshot : {
      ...merged.snapshot,
      pageContent: [merged.snapshot.pageContent, ...diagnostics]
        .filter(Boolean).join("\n\n"),
    };
    return { ...response, payload: { ...response.payload, snapshot } };
  } catch (error) {
    if (frameActionRoutes.isCurrentRead(tabId, generation))
      frameActionRoutes.invalidate(tabId);
    logger.warn("perception", "Embedded frame collection failed", {
      tabId, error: error instanceof Error ? error.message : String(error),
    });
    return response;
  }
}

export async function requestPageSnapshot(
  tabId: number,
  payload: DomSnapshotRequest["payload"],
): Promise<DomSnapshotResponse> {
  const response = await chrome.tabs.sendMessage(tabId, {
    type: "DOM_SNAPSHOT_REQUEST",
    requestId: crypto.randomUUID(),
    source: MessageSource.BACKGROUND,
    payload,
  });
  return mergeFrameSnapshotResponse(tabId, response as DomSnapshotResponse);
}
