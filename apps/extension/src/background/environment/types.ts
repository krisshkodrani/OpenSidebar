export interface BrowserPageTab {
  id?: number;
  url?: string;
  title?: string;
  active?: boolean;
  windowId?: number;
  groupId?: number;
}

export interface BrowserTabQuery {
  active?: boolean;
  currentWindow?: boolean;
  lastFocusedWindow?: boolean;
  groupId?: number;
}

export interface BrowserTabUpdate {
  active?: boolean;
  url?: string;
}

export interface BrowserCaptureOptions {
  format?: "jpeg" | "png";
  quality?: number;
}

export interface BrowserPagePort {
  getTab(tabId: number): Promise<BrowserPageTab>;
  queryTabs(query: BrowserTabQuery): Promise<BrowserPageTab[]>;
  updateTab(tabId: number, update: BrowserTabUpdate): Promise<BrowserPageTab>;
  createTab(options: { url?: string; active?: boolean }): Promise<BrowserPageTab>;
  removeTab(tabId: number): Promise<void>;
  reloadTab(tabId: number): Promise<void>;
  captureVisibleTab(
    windowId: number,
    options?: BrowserCaptureOptions,
  ): Promise<string>;
}

export interface ContentBridgePort {
  sendMessage<TResponse = unknown>(
    tabId: number,
    message: unknown,
  ): Promise<TResponse>;
  executeContentScripts(tabId: number, files: string[]): Promise<void>;
  getContentScriptFiles(): string[];
  onContentScriptReady(listener: (tabId: number) => void): () => void;
  onTabRemoved(listener: (tabId: number) => void): () => void;
  onBeforeNavigate(listener: (tabId: number, frameId: number) => void): () => void;
}

export type PersistenceStorageKeys =
  | string
  | string[]
  | Record<string, unknown>
  | null
  | undefined;

export interface PersistenceStorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export interface PersistenceStorageArea {
  get(keys?: PersistenceStorageKeys): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  /**
   * Subscribe to changes in this storage area. Returns an unsubscribe function.
   * The listener receives only the changed keys for this area.
   */
  onChanged(
    listener: (changes: Record<string, PersistenceStorageChange>) => void,
  ): () => void;
}

export interface PersistencePort {
  local: PersistenceStorageArea;
  sync: PersistenceStorageArea;
  session: PersistenceStorageArea;
}
