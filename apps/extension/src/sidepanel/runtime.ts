import { MessageSource } from "../types";
import type { RuntimeMessage } from "../types";

export interface UiRuntimeTab {
  id?: number;
  url?: string;
  title?: string;
  active?: boolean;
  windowId?: number;
}

export interface UiRuntimeWindow {
  id?: number;
}

export interface UiRuntimeActiveTabInfo {
  tabId: number;
  windowId: number;
}

export interface UiRuntimeKeepalivePort {
  disconnect(): void;
}

export type UiRuntimeStorageKeys =
  | string
  | string[]
  | Record<string, unknown>
  | null
  | undefined;

export interface UiRuntimeStorageArea {
  get(keys?: UiRuntimeStorageKeys): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface UiRuntimeStorage {
  local: UiRuntimeStorageArea;
  sync: UiRuntimeStorageArea;
  session: UiRuntimeStorageArea;
}

export interface UiRuntimePort {
  source: MessageSource.SIDEPANEL | MessageSource.UI;
  e2ePanelConfig?: E2EPanelConfig | null;
  getUrl(path: string): string;
  sendMessage<TResponse = unknown>(message: unknown): Promise<TResponse>;
  subscribeMessages(listener: (message: RuntimeMessage) => void): () => void;
  connectKeepalive(
    name: string,
    onDisconnect: () => void,
  ): UiRuntimeKeepalivePort | null;
  getActiveTab(): Promise<UiRuntimeTab | null>;
  getTab(tabId: number): Promise<UiRuntimeTab | null>;
  getCurrentWindow(): Promise<UiRuntimeWindow | null>;
  onActiveTabChanged(
    listener: (activeInfo: UiRuntimeActiveTabInfo) => void | Promise<void>,
  ): () => void;
  createTab(url: string, options?: { active?: boolean }): Promise<UiRuntimeTab>;
  requestPermissions(permissions: string[]): Promise<boolean>;
  getExtensionVersion?(): string;
  storage: UiRuntimeStorage;
}

export const E2E_DETACHED_PANEL_TARGET_TAB_PARAM = "e2eTargetTabId";
export const E2E_DETACHED_PANEL_WORKSPACE_PARAM = "e2eWorkspaceId";

export interface E2EPanelConfig {
  targetTabId: number | null;
  workspaceId: string | null;
}

export type E2EDetachedPanelConfig = E2EPanelConfig;

function parsePositiveInteger(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function getE2EDetachedPanelConfig(): E2EDetachedPanelConfig | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const targetTabId = parsePositiveInteger(
    params.get(E2E_DETACHED_PANEL_TARGET_TAB_PARAM),
  );
  const workspaceId =
    params.get(E2E_DETACHED_PANEL_WORKSPACE_PARAM)?.trim() || null;
  if (targetTabId == null && workspaceId == null) return null;
  return { targetTabId, workspaceId };
}

export function getE2EPanelConfig(): E2EPanelConfig | null {
  return uiRuntime.e2ePanelConfig ?? getE2EDetachedPanelConfig();
}

function getOverlayExtensionBaseUrl(): string | null {
  if (typeof document === "undefined") return null;
  const raw = document.getElementById(
    "opensidebar-overlay-config",
  )?.textContent;
  if (!raw) return null;
  try {
    const config = JSON.parse(raw) as {
      runtimeOptions?: { extensionBaseUrl?: unknown };
    };
    const baseUrl = config.runtimeOptions?.extensionBaseUrl;
    if (
      typeof baseUrl === "string" &&
      baseUrl &&
      !baseUrl.startsWith("chrome-extension://invalid/")
    ) {
      return baseUrl;
    }
  } catch {
    // Ignore malformed test harness config and fall back below.
  }
  return null;
}

function resolveFromExtensionBase(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\/+/, ""), baseUrl).toString();
}

function normalizeTab(
  tab: chrome.tabs.Tab | null | undefined,
): UiRuntimeTab | null {
  if (!tab) return null;
  return {
    id: tab.id,
    url: tab.url,
    title: tab.title,
    active: tab.active,
    windowId: tab.windowId,
  };
}

function chromeStorageArea(
  areaName: "local" | "sync" | "session",
): UiRuntimeStorageArea {
  return {
    get(keys) {
      return chrome.storage[areaName].get(keys as any) as unknown as Promise<
        Record<string, unknown>
      >;
    },
    async set(items) {
      await chrome.storage[areaName].set(items);
    },
    async remove(keys) {
      const area = chrome.storage[areaName] as any;
      const remove = area.remove;
      if (typeof remove === "function") {
        await remove.call(area, keys);
      }
    },
  };
}

export const chromeUiRuntimePort: UiRuntimePort = {
  source: MessageSource.SIDEPANEL,

  getUrl(path) {
    if (
      typeof chrome !== "undefined" &&
      typeof chrome.runtime?.getURL === "function"
    ) {
      const url = chrome.runtime.getURL(path);
      if (!url.startsWith("chrome-extension://invalid/")) {
        return url;
      }
    }
    const overlayBaseUrl = getOverlayExtensionBaseUrl();
    if (overlayBaseUrl) {
      return resolveFromExtensionBase(overlayBaseUrl, path);
    }
    return path;
  },

  sendMessage(message) {
    return chrome.runtime.sendMessage(message);
  },

  subscribeMessages(listener) {
    const chromeListener = (message: RuntimeMessage) => listener(message);
    chrome.runtime.onMessage.addListener(chromeListener);
    return () => chrome.runtime.onMessage.removeListener(chromeListener);
  },

  connectKeepalive(name, onDisconnect) {
    const port = chrome.runtime.connect({ name });
    port.onDisconnect.addListener(onDisconnect);
    return {
      disconnect() {
        port.disconnect();
      },
    };
  },

  async getActiveTab() {
    const detachedPanelTargetTabId = getE2EDetachedPanelConfig()?.targetTabId;
    if (detachedPanelTargetTabId != null) {
      try {
        const tab = normalizeTab(
          await chrome.tabs.get(detachedPanelTargetTabId),
        );
        if (tab) return tab;
      } catch {
        // Fall back to the normal active-tab query if the E2E target tab closed.
      }
    }

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    return normalizeTab(tab);
  },

  async getTab(tabId) {
    return normalizeTab(await chrome.tabs.get(tabId));
  },

  async getCurrentWindow() {
    const win = await chrome.windows.getCurrent();
    return { id: win.id };
  },

  onActiveTabChanged(listener) {
    const chromeListener = (activeInfo: chrome.tabs.TabActiveInfo) => {
      void listener({
        tabId: activeInfo.tabId,
        windowId: activeInfo.windowId,
      });
    };
    chrome.tabs.onActivated.addListener(chromeListener);
    return () => chrome.tabs.onActivated.removeListener(chromeListener);
  },

  async createTab(url, options = {}) {
    return (
      normalizeTab(await chrome.tabs.create({ url, active: options.active })) ??
      {}
    );
  },

  async requestPermissions(permissions) {
    const api = chrome.permissions as
      | {
          request?: (
            permissions: { permissions: string[] },
            callback?: (granted: boolean) => void,
          ) => Promise<boolean> | void;
        }
      | undefined;
    if (!api?.request) return false;
    const requestPermission = api.request;
    return new Promise<boolean>((resolve) => {
      try {
        const result = requestPermission({ permissions }, (granted) =>
          resolve(Boolean(granted)),
        );
        if (result && typeof result.then === "function") {
          result
            .then((granted) => resolve(Boolean(granted)))
            .catch(() => resolve(false));
        }
      } catch {
        resolve(false);
      }
    });
  },

  getExtensionVersion() {
    return chrome.runtime.getManifest().version;
  },

  storage: {
    local: chromeStorageArea("local"),
    sync: chromeStorageArea("sync"),
    session: chromeStorageArea("session"),
  },
};

export let uiRuntime: UiRuntimePort = chromeUiRuntimePort;

export function setUiRuntimePortForTesting(port: UiRuntimePort): () => void {
  const previous = uiRuntime;
  uiRuntime = port;
  return () => {
    uiRuntime = previous;
  };
}
