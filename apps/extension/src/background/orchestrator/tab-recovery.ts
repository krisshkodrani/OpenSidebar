import { isUsableTab } from "../infrastructure/tab-resolution";
import type { OrchestratorTask } from "./types";
import { claimTaskTab, selectResumeOwnedTab } from "./tab-coordination";

export function getDurableRecoveryUrl(
  task: OrchestratorTask,
  initialTabUrl: string,
): string | null {
  for (const candidate of [task.rootTabUrl, initialTabUrl]) {
    if (
      candidate &&
      candidate !== "about:blank" &&
      candidate !== "about:newtab" &&
      !candidate.startsWith("chrome://") &&
      !candidate.startsWith("chrome-extension://")
    ) {
      return candidate;
    }
  }
  return null;
}

export async function resolveRunnableTabId(input: {
  task: OrchestratorTask;
  preferredTabId: number | null | undefined;
  fallbackTabId: number;
  initialTabUrl: string;
  canNavigate: () => boolean;
  resolveResumeTabId: (
    preferredTabId: number,
  ) => Promise<ReturnType<typeof selectResumeOwnedTab>>;
  createWorkerTab: (url: string) => Promise<number>;
  emitRebound: (details: {
    tabId: number;
    reason: string;
    recoveryUrl: string;
  }) => void;
}): Promise<number | null> {
  const {
    task,
    preferredTabId,
    fallbackTabId,
    initialTabUrl,
    canNavigate,
    resolveResumeTabId,
    createWorkerTab,
    emitRebound,
  } = input;
  if (
    typeof preferredTabId === "number" &&
    (await isUsableTab(preferredTabId))
  ) {
    return preferredTabId;
  }

  const rebound = await resolveResumeTabId(
    typeof preferredTabId === "number" ? preferredTabId : fallbackTabId,
  );
  if (rebound.status === "safe" && (await isUsableTab(rebound.tabId))) {
    return rebound.tabId;
  }

  const recoveryUrl = getDurableRecoveryUrl(task, initialTabUrl);
  if (recoveryUrl && canNavigate()) {
    const recoveredTabId = await createWorkerTab(recoveryUrl);
    claimTaskTab(task, {
      tabId: recoveredTabId,
      role: "primary",
      createdByTask: true,
      url: recoveryUrl,
    });
    emitRebound({
      tabId: recoveredTabId,
      reason:
        rebound.status === "unsafe"
          ? rebound.reason
          : "Recovered onto a fresh task tab at the durable root URL.",
      recoveryUrl,
    });
    return recoveredTabId;
  }

  return null;
}
