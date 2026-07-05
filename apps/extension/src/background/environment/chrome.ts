import type {
  BrowserCaptureOptions,
  BrowserPagePort,
  BrowserPageTab,
  BrowserTabQuery,
  BrowserTabUpdate,
  ContentBridgePort,
  PersistencePort,
  PersistenceStorageArea,
} from "./types";
import type { RuntimeMessage } from "../../types";

function normalizeTab(tab: chrome.tabs.Tab): BrowserPageTab {
  return {
    id: tab.id,
    url: tab.url,
    title: tab.title,
    active: tab.active,
    windowId: tab.windowId,
    groupId: tab.groupId,
  };
}

export const chromeBrowserPagePort: BrowserPagePort = {
  async getTab(tabId) {
    return normalizeTab(await chrome.tabs.get(tabId));
  },

  async queryTabs(query: BrowserTabQuery) {
    return (await chrome.tabs.query(query)).map(normalizeTab);
  },

  async updateTab(tabId, update: BrowserTabUpdate) {
    return normalizeTab(await chrome.tabs.update(tabId, update));
  },

  async createTab(options) {
    return normalizeTab(await chrome.tabs.create(options));
  },

  async removeTab(tabId) {
    await chrome.tabs.remove(tabId);
  },

  async reloadTab(tabId) {
    await chrome.tabs.reload(tabId);
  },

  async captureVisibleTab(windowId, options: BrowserCaptureOptions = {}) {
    return chrome.tabs.captureVisibleTab(
      windowId,
      options as chrome.tabs.CaptureVisibleTabOptions,
    );
  },
};

export const chromeContentBridgePort: ContentBridgePort = {
  sendMessage(tabId, message) {
    return chrome.tabs.sendMessage(tabId, message);
  },

  async executeContentScripts(tabId, files) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files,
    });
  },

  getContentScriptFiles() {
    return chrome.runtime.getManifest().content_scripts?.[0]?.js ?? [];
  },

  onContentScriptReady(listener) {
    const chromeListener = (message: RuntimeMessage, sender: chrome.runtime.MessageSender) => {
      if (message.type === "CONTENT_SCRIPT_READY" && sender.tab?.id) {
        listener(sender.tab.id);
      }
    };
    chrome.runtime.onMessage.addListener(chromeListener);
    return () => chrome.runtime.onMessage.removeListener(chromeListener);
  },

  onTabRemoved(listener) {
    chrome.tabs.onRemoved.addListener(listener);
    return () => chrome.tabs.onRemoved.removeListener(listener);
  },

  onBeforeNavigate(listener) {
    const event = chrome.webNavigation?.onBeforeNavigate;
    if (!event) return () => {};
    const chromeListener = (details: chrome.webNavigation.WebNavigationParentedCallbackDetails) => {
      listener(details.tabId, details.frameId);
    };
    event.addListener(chromeListener);
    return () => event.removeListener(chromeListener);
  },
};

function chromeStorageArea(
  areaName: "local" | "sync" | "session",
): PersistenceStorageArea {
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
    onChanged(listener) {
      const chromeListener = (
        changes: Record<string, chrome.storage.StorageChange>,
        changedArea: string,
      ) => {
        if (changedArea === areaName) listener(changes);
      };
      chrome.storage.onChanged.addListener(chromeListener);
      return () => chrome.storage.onChanged.removeListener(chromeListener);
    },
  };
}

export const chromePersistencePort: PersistencePort = {
  local: chromeStorageArea("local"),
  sync: chromeStorageArea("sync"),
  session: chromeStorageArea("session"),
};
