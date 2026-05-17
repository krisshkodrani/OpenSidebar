import { useEffect, useState } from "react";
import { type UserSettings, type Workspace } from "../../types";
import { logger } from "../../utils";
import { getBlockedRuleForUrl } from "../../utils/site-access";
import { useStore } from "../store";
import { getE2EPanelConfig, uiRuntime } from "../runtime";

export function useWorkspaceSync(settings: UserSettings): string | null {
  const loadMessagesFromStorage = useStore((s) => s.loadMessagesFromStorage);
  const loadAgentStateFromStorage = useStore(
    (s) => s.loadAgentStateFromStorage,
  );
  const [blockedSiteWarning, setBlockedSiteWarning] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const isE2EPanel = getE2EPanelConfig() != null;
    const refreshBlockedWarning = async (tabId?: number) => {
      try {
        const tab =
          tabId != null
            ? await uiRuntime.getTab(tabId)
            : await uiRuntime.getActiveTab();
        const url = tab?.url ?? "";
        const blocked = getBlockedRuleForUrl(url, settings);
        setBlockedSiteWarning(
          blocked
            ? `Agent is blocked on ${blocked.host} by site access rule "${blocked.rule}".`
            : null,
        );
      } catch {
        setBlockedSiteWarning(null);
      }
    };

    void refreshBlockedWarning();
    if (isE2EPanel) {
      return undefined;
    }

    const listener = async (activeInfo: { tabId: number }) => {
      try {
        const stored = await uiRuntime.storage.local.get(
          "opensidebar:workspaces",
        );
        const workspaces =
          (stored["opensidebar:workspaces"] as Workspace[] | undefined) ?? [];
        const workspace = workspaces.find((item) =>
          item.tabIds.includes(activeInfo.tabId),
        );
        const newWorkspaceId = workspace?.id ?? null;
        const currentWorkspaceId = useStore.getState().activeWorkspaceId;
        if (newWorkspaceId !== currentWorkspaceId && newWorkspaceId != null) {
          useStore.getState().setActiveWorkspaceId(newWorkspaceId);
          uiRuntime
            .sendMessage({
              type: "WORKSPACE_SYNC",
              requestId: crypto.randomUUID(),
              source: uiRuntime.source,
              payload: { workspaceId: newWorkspaceId },
            })
            .catch(() => {});
        }
        await refreshBlockedWarning(activeInfo.tabId);
      } catch (error) {
        logger.warn("ui", "Failed to resolve workspace on tab switch", {
          error,
        });
      }
    };

    return uiRuntime.onActiveTabChanged(listener);
  }, [settings]);

  useEffect(() => {
    const isE2EPanel = getE2EPanelConfig() != null;
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      // Overlay harness keeps live step screenshots only in memory.
      if (isE2EPanel) return;
      const workspaceId = useStore.getState().activeWorkspaceId;
      void loadMessagesFromStorage().then(() => loadAgentStateFromStorage());
      if (workspaceId) {
        uiRuntime
          .sendMessage({
            type: "WORKSPACE_SYNC",
            requestId: crypto.randomUUID(),
            source: uiRuntime.source,
            payload: { workspaceId },
          })
          .catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [loadAgentStateFromStorage, loadMessagesFromStorage]);

  return blockedSiteWarning;
}
