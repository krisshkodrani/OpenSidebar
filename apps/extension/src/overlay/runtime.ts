import { MessageSource, type RuntimeMessage } from "../types";
import type {
  UiRuntimeActiveTabInfo,
  UiRuntimePort,
  UiRuntimeStorageArea,
  UiRuntimeStorageKeys,
  UiRuntimeTab,
  UiRuntimeWindow,
} from "../sidepanel/runtime";

export const OVERLAY_SEND_MESSAGE_EVENT = "opensidebar:overlay:send-message";
export const OVERLAY_RECEIVE_MESSAGE_EVENT =
  "opensidebar:overlay:receive-message";

export interface OverlayRuntimeMessageEventDetail {
  message: RuntimeMessage;
}

export type StorageAreaName = "local" | "sync" | "session";

export interface OverlayUiRuntimeOptions {
  tab?: UiRuntimeTab;
  window?: UiRuntimeWindow;
  storage?: Partial<Record<StorageAreaName, Record<string, unknown>>>;
  onSendMessage?: (message: unknown) => unknown | Promise<unknown>;
  requestPermissions?: (permissions: string[]) => boolean | Promise<boolean>;
}

export interface OverlayUiRuntimeHarness {
  port: UiRuntimePort;
  sentMessages: unknown[];
  emitMessage(message: RuntimeMessage): void;
  setActiveTab(tab: UiRuntimeTab): void;
  getStorageSnapshot(area: StorageAreaName): Record<string, unknown>;
  dispose(): void;
}

function hasOwn(data: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(data, key);
}

function getStorageValues(
  data: Record<string, unknown>,
  keys?: UiRuntimeStorageKeys,
): Record<string, unknown> {
  if (keys == null) return { ...data };
  if (typeof keys === "string") {
    return hasOwn(data, keys) ? { [keys]: data[keys] } : {};
  }
  if (Array.isArray(keys)) {
    return Object.fromEntries(
      keys.filter((key) => hasOwn(data, key)).map((key) => [key, data[key]]),
    );
  }
  return Object.fromEntries(
    Object.entries(keys).map(([key, fallback]) => [
      key,
      hasOwn(data, key) ? data[key] : fallback,
    ]),
  );
}

function createStorageArea(
  data: Record<string, unknown>,
): UiRuntimeStorageArea {
  return {
    async get(keys) {
      return getStorageValues(data, keys);
    },
    async set(items) {
      Object.assign(data, items);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete data[key];
      }
    },
  };
}

function defaultTab(input?: UiRuntimeTab): UiRuntimeTab {
  return {
    id: input?.id ?? 1,
    url:
      input?.url ??
      (typeof window !== "undefined" ? window.location.href : "about:blank"),
    title:
      input?.title ??
      (typeof document !== "undefined" ? document.title : "Overlay"),
    active: input?.active ?? true,
    windowId: input?.windowId ?? 1,
  };
}

function dispatchOverlaySendMessage(message: unknown): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(OVERLAY_SEND_MESSAGE_EVENT, {
      detail: { message },
    }),
  );
}

export function createOverlayUiRuntimeHarness(
  options: OverlayUiRuntimeOptions = {},
): OverlayUiRuntimeHarness {
  const storageData: Record<StorageAreaName, Record<string, unknown>> = {
    local: { ...(options.storage?.local ?? {}) },
    sync: { ...(options.storage?.sync ?? {}) },
    session: { ...(options.storage?.session ?? {}) },
  };
  const currentWindow: UiRuntimeWindow = {
    id: options.window?.id ?? options.tab?.windowId ?? 1,
  };
  let activeTab = defaultTab({
    ...options.tab,
    windowId: options.tab?.windowId ?? currentWindow.id,
  });
  let nextSyntheticTabId = (activeTab.id ?? 1) + 1;
  const tabs = new Map<number, UiRuntimeTab>();
  if (typeof activeTab.id === "number") {
    tabs.set(activeTab.id, activeTab);
  }
  const sentMessages: unknown[] = [];
  const messageListeners = new Set<(message: RuntimeMessage) => void>();
  const activeTabListeners = new Set<
    (activeInfo: UiRuntimeActiveTabInfo) => void | Promise<void>
  >();

  const setActiveTab = (tab: UiRuntimeTab) => {
    activeTab = {
      ...tab,
      id: tab.id ?? activeTab.id ?? 1,
      active: true,
      windowId: tab.windowId ?? currentWindow.id,
    };
    if (typeof activeTab.id === "number") {
      tabs.set(activeTab.id, activeTab);
      for (const listener of activeTabListeners) {
        void listener({
          tabId: activeTab.id,
          windowId: activeTab.windowId ?? currentWindow.id ?? 1,
        });
      }
    }
  };

  const emitMessage = (message: RuntimeMessage) => {
    for (const listener of messageListeners) {
      listener(message);
    }
  };

  const onRuntimeMessageEvent = (event: Event) => {
    const message = (
      event as CustomEvent<Partial<OverlayRuntimeMessageEventDetail>>
    ).detail?.message;
    if (
      message &&
      typeof message === "object" &&
      typeof (message as { type?: unknown }).type === "string"
    ) {
      emitMessage(message as RuntimeMessage);
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener(OVERLAY_RECEIVE_MESSAGE_EVENT, onRuntimeMessageEvent);
  }

  const port: UiRuntimePort = {
    source: MessageSource.UI,

    getUrl(path) {
      return path;
    },

    async sendMessage<TResponse = unknown>(
      message: unknown,
    ): Promise<TResponse> {
      sentMessages.push(message);
      dispatchOverlaySendMessage(message);
      if (options.onSendMessage) {
        return (await options.onSendMessage(message)) as TResponse;
      }
      return {} as TResponse;
    },

    subscribeMessages(listener) {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },

    connectKeepalive() {
      return {
        disconnect() {},
      };
    },

    async getActiveTab() {
      return activeTab;
    },

    async getTab(tabId) {
      return tabs.get(tabId) ?? null;
    },

    async getCurrentWindow() {
      return currentWindow;
    },

    onActiveTabChanged(listener) {
      activeTabListeners.add(listener);
      return () => activeTabListeners.delete(listener);
    },

    async createTab(url, createOptions = {}) {
      const tab: UiRuntimeTab = {
        id: nextSyntheticTabId++,
        url,
        title: url,
        active: createOptions.active ?? true,
        windowId: currentWindow.id,
      };
      if (typeof tab.id === "number") {
        tabs.set(tab.id, tab);
      }
      if (tab.active) setActiveTab(tab);
      return tab;
    },

    async requestPermissions(permissions) {
      return Boolean(await options.requestPermissions?.(permissions));
    },

    storage: {
      local: createStorageArea(storageData.local),
      sync: createStorageArea(storageData.sync),
      session: createStorageArea(storageData.session),
    },
  };

  return {
    port,
    sentMessages,
    emitMessage,
    setActiveTab,
    getStorageSnapshot(area) {
      return { ...storageData[area] };
    },
    dispose() {
      if (typeof window !== "undefined") {
        window.removeEventListener(
          OVERLAY_RECEIVE_MESSAGE_EVENT,
          onRuntimeMessageEvent,
        );
      }
      messageListeners.clear();
      activeTabListeners.clear();
    },
  };
}

export function createOverlayUiRuntimePort(
  options: OverlayUiRuntimeOptions = {},
): UiRuntimePort {
  return createOverlayUiRuntimeHarness(options).port;
}
