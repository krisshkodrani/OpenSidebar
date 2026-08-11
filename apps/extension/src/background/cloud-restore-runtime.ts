import { AgentStatus, MessageSource, type RuntimeMessage, type UserSettings } from "../types";
import { getProviderKeyStatus } from "../utils/provider-keys";
import { getBlockedRuleForUrl } from "../utils/site-access";
import { loadSettings } from "../utils/settings-storage";
import {
  DisabledCloudCheckpointPort,
  HttpCloudCheckpointPort,
  StoragePortableCheckpointLocalPort,
  chromeBrowserPagePort,
  chromeContentBridgePort,
  chromePersistencePort,
} from "./environment";
import { CloudAuthenticatedFetch } from "../cloud/authenticated-fetch";
import { orchestrator } from "./orchestrator";
import {
  CloudRestoreController,
  buildPortableRestoreQuery,
} from "./orchestrator/cloud-restore-controller";
import { PortableCheckpointCoordinator } from "./orchestrator/portable-restore";
import { workspaceManager } from "./workspaces/manager";
import { startKeepalive, stopKeepalive } from "./keepalive";

export const cloudRestoreEnabled =
  import.meta.env.VITE_CLOUD_SESSIONS_ENABLED === "true" &&
  import.meta.env.VITE_CHECKPOINT_RESTORE_ENABLED === "true";
const cloud = new CloudAuthenticatedFetch(chromePersistencePort.local);
const checkpointCloud = cloudRestoreEnabled
  ? new HttpCloudCheckpointPort((path, init) => cloud.request(path, init))
  : new DisabledCloudCheckpointPort();
const checkpoints = new PortableCheckpointCoordinator(
  new StoragePortableCheckpointLocalPort(chromePersistencePort.local),
  checkpointCloud,
  chrome.runtime.getManifest().version,
);

export const cloudRestoreController = new CloudRestoreController({
  enabled: cloudRestoreEnabled,
  cloud,
  checkpoints,
  pages: chromeBrowserPagePort,
  content: chromeContentBridgePort,
  async isPageAuthorized(url) {
    if (!/^https?:\/\//i.test(url)) return false;
    const settings = (await loadSettings()) ?? ({} as UserSettings);
    return getBlockedRuleForUrl(url, settings) === null;
  },
  async continueRestore(input) {
    const settings = (await loadSettings()) ?? ({} as UserSettings);
    const keyStatus = getProviderKeyStatus(settings);
    if (!keyStatus.hasRequiredKeys) throw new Error("provider_key_required");
    const tab = await chromeBrowserPagePort.getTab(input.tabId);
    if (!tab.url || getBlockedRuleForUrl(tab.url, settings))
      throw new Error("restore_page_unauthorized");
    const workspace = await workspaceManager.createWorkspace(
      "Restored session",
      "blue",
      input.tabId,
      input.localWorkspaceId,
    );
    const startInput = {
      query: buildPortableRestoreQuery(input),
      tabId: input.tabId,
      workspaceId: workspace.id,
      runId: input.runId,
      settings,
      openRouterApiKey: keyStatus.activeKey || settings.openRouterApiKey,
      conversationContextBrief: input.checkpoint.conversation.messages
        .slice(-8)
        .map((message) => `${message.role}: ${message.content}`)
        .join("\n")
        .slice(0, 1600),
    };
    await startKeepalive();
    queueMicrotask(() => {
      void orchestrator
        .startTask(startInput)
        .catch((error) => {
          void chrome.runtime.sendMessage({
            type: "AGENT_STATUS",
            requestId: crypto.randomUUID(),
            source: MessageSource.BACKGROUND,
            workspaceId: workspace.id,
            payload: {
              status: AgentStatus.ERROR,
              detail:
                error instanceof Error
                  ? error.message
                  : "Restored task could not start.",
            },
          }).catch(() => undefined);
        })
        .finally(() => {
          if (!orchestrator.hasActiveTasks()) void stopKeepalive();
        });
    });
    return { workspaceId: workspace.id };
  },
});

export function isCloudRestoreMessage(
  message: RuntimeMessage,
): message is Extract<
  RuntimeMessage,
  {
    type:
      | "CLOUD_RESTORE_LIST_REQUEST"
      | "CLOUD_RESTORE_PREPARE"
      | "CLOUD_RESTORE_CONTINUE";
  }
> {
  return message.type.startsWith("CLOUD_RESTORE_");
}

export async function handleCloudRestoreMessage(
  message: ReturnTypeGuarded,
) {
  if (message.type === "CLOUD_RESTORE_LIST_REQUEST")
    return cloudRestoreController.list();
  if (message.type === "CLOUD_RESTORE_PREPARE")
    return cloudRestoreController.prepare(message.payload);
  return cloudRestoreController.continue(
    message.payload.restoreId,
    message.payload.outcomeResolution,
  );
}

type ReturnTypeGuarded = Extract<
  RuntimeMessage,
  {
    type:
      | "CLOUD_RESTORE_LIST_REQUEST"
      | "CLOUD_RESTORE_PREPARE"
      | "CLOUD_RESTORE_CONTINUE";
  }
>;
