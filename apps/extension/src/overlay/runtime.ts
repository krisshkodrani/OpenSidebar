import { MessageSource } from "../types";
import type { RuntimeMessage } from "../types";
import type {
  UiRuntimeActiveTabInfo,
  UiRuntimePort,
  UiRuntimeStorageArea,
  UiRuntimeStorageKeys,
  UiRuntimeTab,
  UiRuntimeWindow,
  E2EPanelConfig,
} from "../sidepanel/runtime";

export const OVERLAY_SEND_MESSAGE_EVENT = "opensidebar:overlay:send-message";
export const OVERLAY_RECEIVE_MESSAGE_EVENT =
  "opensidebar:overlay:receive-message";
export const OVERLAY_SEND_RESPONSE_EVENT =
  "opensidebar:overlay:send-response";
export const OVERLAY_STORAGE_REQUEST_EVENT =
  "opensidebar:overlay:storage-request";
export const OVERLAY_STORAGE_RESPONSE_EVENT =
  "opensidebar:overlay:storage-response";

export interface OverlayRuntimeMessageEventDetail {
  message: RuntimeMessage;
}

export interface OverlayRuntimeSendMessageEventDetail {
  message: unknown;
  requestId: string;
}

export interface OverlayRuntimeSendResponseEventDetail {
  requestId: string;
  response?: unknown;
  error?: string;
}

export type StorageAreaName = "local" | "sync" | "session";
export type OverlayStorageMode = "memory" | "chrome-bridge";

export interface OverlayStorageRequestEventDetail {
  requestId: string;
  area: StorageAreaName;
  operation: "get" | "set" | "remove";
  keys?: UiRuntimeStorageKeys;
  items?: Record<string, unknown>;
}

export interface OverlayStorageResponseEventDetail {
  requestId: string;
  response?: Record<string, unknown>;
  error?: string;
}

export interface OverlayUiRuntimeOptions {
  tab?: UiRuntimeTab;
  window?: UiRuntimeWindow;
  storage?: Partial<Record<StorageAreaName, Record<string, unknown>>>;
  storageMode?: OverlayStorageMode;
  extensionBaseUrl?: string;
  e2ePanelConfig?: E2EPanelConfig | null;
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

function createBridgeRequestId(): string {
  return `overlay:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function extensionUrl(baseUrl: string | undefined, inputPath: string): string {
  if (!baseUrl) return inputPath;
  return new URL(inputPath.replace(/^\/+/, ""), baseUrl).toString();
}

function dispatchOverlaySendMessage(message: unknown, requestId: string): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(OVERLAY_SEND_MESSAGE_EVENT, {
      detail: { message, requestId },
    }),
  );
}

function dispatchOverlayStorageRequest(
  detail: OverlayStorageRequestEventDetail,
): void {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(OVERLAY_STORAGE_REQUEST_EVENT, {
      detail,
    }),
  );
}

function createBridgeStorageArea(
  area: StorageAreaName,
  pendingResponses: Map<
    string,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >,
): UiRuntimeStorageArea {
  const request = (
    detail: Omit<OverlayStorageRequestEventDetail, "requestId" | "area">,
  ): Promise<Record<string, unknown>> => {
    if (typeof window === "undefined") return Promise.resolve({});
    const requestId = createBridgeRequestId();
    const responsePromise = new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingResponses.delete(requestId);
          reject(new Error(`Overlay storage ${detail.operation} timed out.`));
        }, 15_000);
        pendingResponses.set(requestId, { resolve, reject, timeout });
      },
    );
    dispatchOverlayStorageRequest({ requestId, area, ...detail });
    return responsePromise;
  };

  return {
    get(keys) {
      return request({ operation: "get", keys });
    },
    async set(items) {
      await request({ operation: "set", items });
    },
    async remove(keys) {
      await request({ operation: "remove", keys });
    },
  };
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
  const pendingResponses = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  const pendingStorageResponses = new Map<
    string,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
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

  const onSendResponseEvent = (event: Event) => {
    const detail = (
      event as CustomEvent<Partial<OverlayRuntimeSendResponseEventDetail>>
    ).detail;
    const requestId = detail?.requestId;
    if (!requestId) return;
    const pending = pendingResponses.get(requestId);
    if (!pending) return;
    pendingResponses.delete(requestId);
    clearTimeout(pending.timeout);
    if (detail.error) {
      pending.reject(new Error(detail.error));
      return;
    }
    pending.resolve(detail.response ?? {});
  };

  const onStorageResponseEvent = (event: Event) => {
    const detail = (
      event as CustomEvent<Partial<OverlayStorageResponseEventDetail>>
    ).detail;
    const requestId = detail?.requestId;
    if (!requestId) return;
    const pending = pendingStorageResponses.get(requestId);
    if (!pending) return;
    pendingStorageResponses.delete(requestId);
    clearTimeout(pending.timeout);
    if (detail.error) {
      pending.reject(new Error(detail.error));
      return;
    }
    pending.resolve(detail.response ?? {});
  };

  if (typeof window !== "undefined") {
    window.addEventListener(OVERLAY_RECEIVE_MESSAGE_EVENT, onRuntimeMessageEvent);
    window.addEventListener(OVERLAY_SEND_RESPONSE_EVENT, onSendResponseEvent);
    window.addEventListener(OVERLAY_STORAGE_RESPONSE_EVENT, onStorageResponseEvent);
  }

  const useChromeBridgeStorage = options.storageMode === "chrome-bridge";

  const port: UiRuntimePort = {
    source: MessageSource.UI,
    e2ePanelConfig: options.e2ePanelConfig ?? null,

    getUrl(path) {
      return extensionUrl(options.extensionBaseUrl, path);
    },

    async sendMessage<TResponse = unknown>(
      message: unknown,
    ): Promise<TResponse> {
      sentMessages.push(message);
      const requestId = createBridgeRequestId();
      if (options.onSendMessage) {
        dispatchOverlaySendMessage(message, requestId);
        return (await options.onSendMessage(message)) as TResponse;
      }
      if (typeof window === "undefined") return {} as TResponse;
      const responsePromise = new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingResponses.delete(requestId);
          resolve({});
        }, 15_000);
        pendingResponses.set(requestId, { resolve, reject, timeout });
      });
      dispatchOverlaySendMessage(message, requestId);
      return (await responsePromise) as TResponse;
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
      local: useChromeBridgeStorage
        ? createBridgeStorageArea("local", pendingStorageResponses)
        : createStorageArea(storageData.local),
      sync: useChromeBridgeStorage
        ? createBridgeStorageArea("sync", pendingStorageResponses)
        : createStorageArea(storageData.sync),
      session: useChromeBridgeStorage
        ? createBridgeStorageArea("session", pendingStorageResponses)
        : createStorageArea(storageData.session),
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
        window.removeEventListener(OVERLAY_SEND_RESPONSE_EVENT, onSendResponseEvent);
        window.removeEventListener(
          OVERLAY_STORAGE_RESPONSE_EVENT,
          onStorageResponseEvent,
        );
      }
      for (const pending of pendingResponses.values()) {
        clearTimeout(pending.timeout);
      }
      pendingResponses.clear();
      for (const pending of pendingStorageResponses.values()) {
        clearTimeout(pending.timeout);
      }
      pendingStorageResponses.clear();
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
