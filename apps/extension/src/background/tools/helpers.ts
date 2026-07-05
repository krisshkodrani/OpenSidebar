/**
 * Shared generic helpers used by tool executors in this directory.
 *
 * Extracted from tools/index.ts so that adapter modules (e.g. servicenow/)
 * can import them without depending on the tools barrel.
 */

export function getTabUrl(tab: chrome.tabs.Tab): string {
  return tab.url || tab.pendingUrl || "";
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function getFrameIdsForMainWorldBridge(
  tabId: number,
): Promise<number[]> {
  try {
    if (!chrome.webNavigation?.getAllFrames) return [0];
    const frames = await new Promise<any[]>((resolve) => {
      chrome.webNavigation.getAllFrames({ tabId }, (details) => {
        if (chrome.runtime.lastError) {
          resolve([]);
          return;
        }
        resolve(Array.isArray(details) ? details : []);
      });
    });
    const frameIds = frames
      .map((frame) => frame?.frameId)
      .filter((frameId): frameId is number => Number.isInteger(frameId));
    return [...new Set([0, ...frameIds])];
  } catch {
    return [0];
  }
}
