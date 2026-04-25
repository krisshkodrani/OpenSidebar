import type { TaskCompletionMessage } from "../types";
import { logger } from "../utils";
import { loadSettings } from "../utils/settings-storage";
import { workspaceManager } from "./workspaces/manager";

const NOTIFICATION_PREFIX = "opensidebar";
const NOTIFICATION_ROUTE_PREFIX = "opensidebar:notification:";
const NOTIFICATION_DEDUPE_TTL_MS = 10 * 60 * 1000;

type NotificationPermissionLevel = "granted" | "denied";

type NotificationRoute = {
  workspaceId: string;
  tabId?: number;
  createdAt: number;
};

type AgentNotificationInput = {
  workspaceId: string;
  eventId: string;
  tabId?: number;
  title: string;
  message: string;
  requireInteraction?: boolean;
};

type TaskCompletionNotificationInput = {
  workspaceId: string;
  tabId?: number;
  payload: TaskCompletionMessage["payload"];
};

type AttentionNotificationInput = {
  workspaceId: string;
  taskId: string;
  eventId: string;
  tabId?: number;
  reason: string;
  detail?: string;
};

type StoppedNotificationInput = {
  workspaceId: string;
  taskId: string;
  tabId?: number;
  detail?: string;
};

class AgentNotificationService {
  private readonly routes = new Map<string, NotificationRoute>();
  private readonly emittedEvents = new Map<string, number>();
  private registered = false;

  registerHandlers(): void {
    if (this.registered) return;
    this.registered = true;

    chrome.notifications?.onClicked?.addListener((notificationId) => {
      void this.handleClick(notificationId);
    });
    chrome.notifications?.onClosed?.addListener((notificationId) => {
      this.routes.delete(notificationId);
      void chrome.storage.session
        ?.remove(this.storageKey(notificationId))
        .catch(() => {});
    });
  }

  async notifyTaskCompletion(
    input: TaskCompletionNotificationInput,
  ): Promise<void> {
    const status = input.payload.status;
    const title =
      status === "completed"
        ? "OpenSidebar finished"
        : status === "partial"
          ? "OpenSidebar needs review"
          : "OpenSidebar task failed";
    const fallback =
      status === "completed"
        ? "Task complete"
        : status === "partial"
          ? "Task partially completed"
          : "Task failed";

    await this.notify({
      workspaceId: input.workspaceId,
      tabId: input.tabId,
      eventId: `completion:${input.payload.taskId}:${status}`,
      title,
      message: this.compactText(
        input.payload.terminationReason || input.payload.summary || fallback,
      ),
      requireInteraction: false,
    });
  }

  async notifyAttention(input: AttentionNotificationInput): Promise<void> {
    await this.notify({
      workspaceId: input.workspaceId,
      tabId: input.tabId,
      eventId: `attention:${input.taskId}:${input.eventId}`,
      title: "OpenSidebar needs your input",
      message: this.compactText(input.detail || input.reason),
      requireInteraction: true,
    });
  }

  async notifyStopped(input: StoppedNotificationInput): Promise<void> {
    await this.notify({
      workspaceId: input.workspaceId,
      tabId: input.tabId,
      eventId: `stopped:${input.taskId}`,
      title: "OpenSidebar stopped",
      message: this.compactText(input.detail || "Task stopped"),
      requireInteraction: false,
    });
  }

  async handleClick(notificationId: string): Promise<void> {
    const route = await this.getRoute(notificationId);
    if (!route) return;

    try {
      await this.focusWorkspace(route);
    } finally {
      void this.clearNotification(notificationId);
      this.routes.delete(notificationId);
      await chrome.storage.session
        ?.remove(this.storageKey(notificationId))
        .catch(() => {});
    }
  }

  resetForTests(): void {
    this.routes.clear();
    this.emittedEvents.clear();
    this.registered = false;
  }

  private async notify(input: AgentNotificationInput): Promise<void> {
    if (!input.workspaceId) return;
    this.pruneEmittedEvents();

    const eventKey = `${input.workspaceId}:${input.eventId}`;
    if (this.emittedEvents.has(eventKey)) return;

    const enabled = await this.isNotificationEnabled();
    if (!enabled) return;

    if (await this.isFocusedWorkspace(input.workspaceId, input.tabId)) return;

    const notificationId = this.notificationId(input.workspaceId, input.eventId);
    const route: NotificationRoute = {
      workspaceId: input.workspaceId,
      tabId: input.tabId,
      createdAt: Date.now(),
    };

    try {
      const createdId = await this.createNotification(notificationId, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("public/icons/icon-128.png"),
        title: input.title,
        message: input.message,
        priority: 0,
        silent: true,
        requireInteraction: Boolean(input.requireInteraction),
      });
      const resolvedId = createdId || notificationId;
      this.routes.set(resolvedId, route);
      await chrome.storage.session?.set({
        [this.storageKey(resolvedId)]: route,
      });
      this.emittedEvents.set(eventKey, Date.now());
    } catch (error) {
      logger.debug("system", "Failed to create browser notification", {
        error,
        workspaceId: input.workspaceId,
        eventId: input.eventId,
      });
    }
  }

  private async isNotificationEnabled(): Promise<boolean> {
    const settings = await loadSettings().catch(() => null);
    if (settings?.enableBrowserNotifications !== true) return false;
    if (!chrome.notifications?.create) return false;

    const hasOptionalPermission = await this.hasOptionalPermission();
    if (!hasOptionalPermission) return false;

    const level = await this.getPermissionLevel();
    return level === "granted";
  }

  private async hasOptionalPermission(): Promise<boolean> {
    const permissions = chrome.permissions as
      | {
          contains?: (
            permissions: { permissions: string[] },
            callback?: (granted: boolean) => void,
          ) => Promise<boolean> | void;
        }
      | undefined;
    if (!permissions?.contains) return false;

    const contains = permissions.contains;
    return await new Promise<boolean>((resolve) => {
      try {
        const result = contains(
          { permissions: ["notifications"] },
          (granted) => resolve(Boolean(granted)),
        );
        if (result && typeof result.then === "function") {
          result.then((granted) => resolve(Boolean(granted))).catch(() => {
            resolve(false);
          });
        }
      } catch {
        resolve(false);
      }
    });
  }

  private async getPermissionLevel(): Promise<NotificationPermissionLevel> {
    const getPermissionLevel = chrome.notifications
      ?.getPermissionLevel as
      | ((
          callback?: (level: NotificationPermissionLevel) => void,
        ) => Promise<NotificationPermissionLevel> | void)
      | undefined;
    if (!getPermissionLevel) return "denied";

    return await new Promise<NotificationPermissionLevel>((resolve) => {
      try {
        const result = getPermissionLevel((level) => {
          resolve(level === "granted" ? "granted" : "denied");
        });
        if (result && typeof result.then === "function") {
          result
            .then((level) => resolve(level === "granted" ? "granted" : "denied"))
            .catch(() => resolve("denied"));
        }
      } catch {
        resolve("denied");
      }
    });
  }

  private async createNotification(
    id: string,
    options: chrome.notifications.NotificationOptions,
  ): Promise<string> {
    const create = chrome.notifications.create as any;
    return await new Promise<string>((resolve, reject) => {
      try {
        const result = create(id, options, (createdId: string) => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            reject(new Error(lastError.message));
          } else {
            resolve(createdId || id);
          }
        });
        if (result && typeof result.then === "function") {
          result.then((createdId: string) => resolve(createdId || id)).catch(reject);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  private async isFocusedWorkspace(
    workspaceId: string,
    tabId?: number,
  ): Promise<boolean> {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      if (!tab?.id) return false;
      if (tabId != null && tab.id === tabId) return true;
      const workspace = await workspaceManager.getWorkspaceForTab(tab.id);
      return workspace?.id === workspaceId;
    } catch {
      return false;
    }
  }

  private async getRoute(
    notificationId: string,
  ): Promise<NotificationRoute | null> {
    const cached = this.routes.get(notificationId);
    if (cached) return cached;

    const key = this.storageKey(notificationId);
    const stored = await chrome.storage.session?.get(key).catch(() => null);
    const route = stored?.[key] as NotificationRoute | undefined;
    if (!route?.workspaceId) return null;
    this.routes.set(notificationId, route);
    return route;
  }

  private async focusWorkspace(route: NotificationRoute): Promise<void> {
    const workspace = await workspaceManager.getWorkspaceById(route.workspaceId);
    if (!workspace) return;

    const candidateIds = [
      ...(route.tabId != null ? [route.tabId] : []),
      ...workspace.tabIds.filter((id) => id !== route.tabId),
    ];
    const tab = await this.firstLiveTab(candidateIds);
    if (!tab?.id) return;

    if (tab.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    }
    await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    await chrome.sidePanel
      ?.setOptions({
        tabId: tab.id,
        path: "src/sidepanel/index.html",
        enabled: true,
      })
      .catch(() => {});
    await chrome.sidePanel?.open({ tabId: tab.id }).catch((error) => {
      logger.debug("system", "Failed to open side panel from click", {
        error,
        tabId: tab.id,
      });
    });
  }

  private async firstLiveTab(
    tabIds: number[],
  ): Promise<chrome.tabs.Tab | null> {
    for (const tabId of tabIds) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab?.id) return tab;
      } catch {
        // tab closed; continue
      }
    }
    return null;
  }

  private async clearNotification(notificationId: string): Promise<void> {
    const clear = chrome.notifications?.clear as
      | ((id: string) => Promise<boolean> | void)
      | undefined;
    if (!clear) return;
    try {
      const result = clear(notificationId);
      if (result && typeof result.then === "function") {
        await result.catch(() => false);
      }
    } catch {
      // ignore notification cleanup failures
    }
  }

  private storageKey(notificationId: string): string {
    return `${NOTIFICATION_ROUTE_PREFIX}${notificationId}`;
  }

  private notificationId(workspaceId: string, eventId: string): string {
    return `${NOTIFICATION_PREFIX}:${workspaceId}:${this.hash(eventId)}`;
  }

  private hash(value: string): string {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
  }

  private compactText(value: string): string {
    const oneLine = value.replace(/\s+/g, " ").trim();
    if (oneLine.length <= 160) return oneLine || "OpenSidebar has an update.";
    return `${oneLine.slice(0, 157)}...`;
  }

  private pruneEmittedEvents(): void {
    const cutoff = Date.now() - NOTIFICATION_DEDUPE_TTL_MS;
    for (const [key, timestamp] of this.emittedEvents) {
      if (timestamp < cutoff) this.emittedEvents.delete(key);
    }
  }
}

export const agentNotifications = new AgentNotificationService();
