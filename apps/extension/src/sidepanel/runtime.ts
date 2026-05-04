import { MessageSource, type RuntimeMessage } from "../types";

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
  storage: UiRuntimeStorage;
}

function normalizeTab(tab: chrome.tabs.Tab | null | undefined): UiRuntimeTab | null {
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
      return chrome.runtime.getURL(path);
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
