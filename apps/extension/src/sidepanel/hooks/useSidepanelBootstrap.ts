import { useEffect } from "react";
import { type Workspace } from "../../types";
import { logger } from "../../utils";
import { useStore } from "../store";
import { getE2EPanelConfig, uiRuntime } from "../runtime";
import { migrateLegacyWorkSurfaceState } from "../work-surface-storage";

export function useSidepanelBootstrap(): void {
  const loadSettingsFromStorage = useStore((s) => s.loadSettingsFromStorage);
  const loadMessagesFromStorage = useStore((s) => s.loadMessagesFromStorage);
  const loadAgentStateFromStorage = useStore(
    (s) => s.loadAgentStateFromStorage,
  );
  const loadSavedPrompts = useStore((s) => s.loadSavedPrompts);
  const loadUserWebsiteSkills = useStore((s) => s.loadUserWebsiteSkills);
  const loadPersonalProfile = useStore((s) => s.loadPersonalProfile);
  const setReady = useStore((s) => s.setReady);

  useEffect(() => {
    logger.info("ui", "Side Panel Mounted");

    (async () => {
      // 0.7.4 intentionally starts the redesigned work surface fresh. The
      // marker makes this destructive UI-only migration run exactly once.
      try {
        await migrateLegacyWorkSurfaceState(uiRuntime.storage.local);
      } catch (error) {
        logger.warn("ui", "Work surface migration could not be completed", {
          error,
        });
      }
      await loadSettingsFromStorage();
      const e2ePanelConfig = getE2EPanelConfig();
      if (e2ePanelConfig?.workspaceId) {
        useStore.getState().setActiveWorkspaceId(
          e2ePanelConfig.workspaceId,
        );
        await loadMessagesFromStorage();
        await loadAgentStateFromStorage();
        await loadSavedPrompts();
        await loadUserWebsiteSkills();
        await loadPersonalProfile();
        setReady();
        return;
      }

      try {
        const tab = await uiRuntime.getActiveTab();
        if (tab?.id) {
          const stored = await uiRuntime.storage.local.get(
            "opensidebar:workspaces",
          );
          const workspaces =
            (stored["opensidebar:workspaces"] as Workspace[] | undefined) ??
            [];
          const workspace = workspaces.find((item) =>
            item.tabIds.includes(tab.id!),
          );
          if (workspace && !e2ePanelConfig?.workspaceId) {
            useStore.getState().setActiveWorkspaceId(workspace.id);
          }

          try {
            const response = await uiRuntime.sendMessage<{
              workspaceId?: string;
            }>({
              type: "SIDE_PANEL_OPENED",
              requestId: crypto.randomUUID(),
              source: uiRuntime.source,
              payload: { tabId: tab.id, windowId: tab.windowId },
            });
            if (
              response?.workspaceId &&
              !useStore.getState().activeWorkspaceId &&
              !e2ePanelConfig?.workspaceId
            ) {
              useStore.getState().setActiveWorkspaceId(response.workspaceId);
            }
          } catch (error) {
            logger.error("ui", "Failed to notify background of panel open", {
              error,
            });
          }
        }
      } catch (error) {
        logger.warn("ui", "Failed to resolve workspace on mount", { error });
      }

      await loadMessagesFromStorage();
      await loadAgentStateFromStorage();
      await loadSavedPrompts();
      await loadUserWebsiteSkills();
      await loadPersonalProfile();
      setReady();
    })();
  }, [
    loadAgentStateFromStorage,
    loadMessagesFromStorage,
    loadPersonalProfile,
    loadSavedPrompts,
    loadSettingsFromStorage,
    loadUserWebsiteSkills,
    setReady,
  ]);
}
