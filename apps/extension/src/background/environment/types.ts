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

export interface ExecuteFunctionOptions {
  allFrames?: boolean;
  world?: "MAIN" | "ISOLATED";
}

export interface ExecuteFunctionResult<T> {
  result: T | undefined;
  frameId: number;
}

export interface ContentBridgePort {
  sendMessage<TResponse = unknown>(
    tabId: number,
    message: unknown,
  ): Promise<TResponse>;
  executeContentScripts(tabId: number, files: string[]): Promise<void>;
  /** Inject and run a function in the page (scripting.executeScript{func}). */
  executeFunction<T>(
    tabId: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- injected page fn
    fn: (...args: any[]) => T,
    args?: unknown[],
    options?: ExecuteFunctionOptions,
  ): Promise<ExecuteFunctionResult<T>[]>;
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

// --- Runtime messaging (RFC LP-15, Phase 4a) ---

export interface RuntimeMessagingPort {
  /**
   * Fire-and-forget broadcast to all extension contexts.
   *
   * Contract: this MUST also deliver to listeners registered via this port's own
   * `onMessage`. `chrome.runtime.sendMessage` skips the sending context, so a
   * port that only forwards to chrome silently strips every message from
   * same-context subscribers — which is precisely how the browser bridge's
   * completion path was dead while its tests were green.
   */
  broadcast(message: unknown): void;
  /** Send a message and await a response. */
  request<TResponse = unknown>(message: unknown): Promise<TResponse>;
  /**
   * Subscribe to messages — inbound from other contexts, and those this context
   * broadcasts itself. The listener may return a value (or a promise) to respond
   * (cross-context only). Returns an unsubscribe function.
   */
  onMessage(
    listener: (
      message: unknown,
      sender: { tabId?: number },
    ) => unknown | Promise<unknown> | void,
  ): () => void;
}

// --- Navigation events (RFC LP-15, Phase 4a) ---

export interface NavigationEventDetails {
  tabId: number;
  frameId: number;
  url: string;
}

export interface NavigationErrorDetails extends NavigationEventDetails {
  error: string;
}

export interface NavigationEventsPort {
  onCommitted(listener: (details: NavigationEventDetails) => void): () => void;
  onCompleted(listener: (details: NavigationEventDetails) => void): () => void;
  onHistoryStateUpdated(
    listener: (details: NavigationEventDetails) => void,
  ): () => void;
  onErrorOccurred(
    listener: (details: NavigationErrorDetails) => void,
  ): () => void;
}

// --- Scheduler / alarms (RFC LP-15, Phase 4a) ---

export interface SchedulerAlarmOptions {
  when?: number;
  delayInMinutes?: number;
  periodInMinutes?: number;
}

export interface SchedulerPort {
  createAlarm(name: string, options: SchedulerAlarmOptions): Promise<void>;
  clearAlarm(name: string): Promise<boolean>;
  onAlarm(listener: (alarm: { name: string }) => void): () => void;
}

// --- Tool API-family ports (RFC LP-15, Phase 4b) ---

export interface DownloadsPort {
  isAvailable(): boolean;
  download(options: { url: string; filename?: string }): Promise<number>;
}

export interface CookieRecord {
  name: string;
  value: string;
  domain?: string;
  path?: string;
}

export interface CookiesPort {
  getAll(details: {
    url?: string;
    name?: string;
    domain?: string;
  }): Promise<CookieRecord[]>;
  set(details: {
    url: string;
    name: string;
    value: string;
    domain?: string;
    path?: string;
  }): Promise<void>;
  remove(details: { url: string; name: string }): Promise<void>;
}

export interface HistoryItemRecord {
  url?: string;
  title?: string;
  lastVisitTime?: number;
  visitCount?: number;
}

export interface HistoryPort {
  search(query: {
    text: string;
    maxResults?: number;
    startTime?: number;
  }): Promise<HistoryItemRecord[]>;
}

export interface SearchPort {
  query(options: {
    text: string;
    disposition?: "CURRENT_TAB" | "NEW_TAB" | "NEW_WINDOW";
  }): Promise<void>;
}

export interface WindowRecord {
  id?: number;
}

export interface WindowsPort {
  create(options: { url?: string }): Promise<WindowRecord>;
}

// --- Peripheral ports (RFC LP-15, Phase 4c) ---

export interface NotificationCreateOptions {
  type: "basic";
  iconUrl: string;
  title: string;
  message: string;
  priority?: number;
  buttons?: { title: string }[];
}

export interface NotificationsPort {
  isAvailable(): boolean;
  create(id: string, options: NotificationCreateOptions): Promise<string>;
  clear(id: string): Promise<boolean>;
  getPermissionLevel(): Promise<"granted" | "denied">;
  onClicked(listener: (notificationId: string) => void): () => void;
  onClosed(listener: (notificationId: string) => void): () => void;
}

/** Hides tabCapture + the offscreen document lifecycle behind one port. */
export interface AudioCapturePort {
  isAvailable(): boolean;
  getMediaStreamId(tabId: number): Promise<string>;
  ensureOffscreenDocument(
    path: string,
    justification: string,
  ): Promise<void>;
  closeOffscreenDocument(): Promise<void>;
}

/**
 * Aggregate bundle of every environment port, for injection only (RFC LP-15).
 * Deliberately NOT a god port — consumers depend on the specific ports they
 * need; this bundle exists so the Phase 5 composition root can pass one value.
 */
export interface RuntimeEnvironment {
  persistence: PersistencePort;
  messaging: RuntimeMessagingPort;
  navigationEvents: NavigationEventsPort;
  scheduler: SchedulerPort;
  page: BrowserPagePort;
  content: ContentBridgePort;
  downloads: DownloadsPort;
  cookies: CookiesPort;
  history: HistoryPort;
  search: SearchPort;
  windows: WindowsPort;
  notifications: NotificationsPort;
  audioCapture: AudioCapturePort;
}
