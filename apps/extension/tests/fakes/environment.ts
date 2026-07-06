/**
 * Aggregate fake RuntimeEnvironment (RFC LP-15, Phase 5).
 *
 * Composes every per-port fake into one injectable environment with zero
 * chrome dependency, so a headless runtime can be driven end-to-end in a unit
 * test. `overrides` lets a test swap any single port (e.g. a scripted page
 * port) without rebuilding the rest.
 */

import type {
  AudioCapturePort,
  BrowserPagePort,
  ContentBridgePort,
  NotificationCreateOptions,
  NotificationsPort,
  RuntimeEnvironment,
} from "../../src/background/environment/types";
import { createFakePersistencePort } from "./persistence";
import {
  createFakeNavigationEventsPort,
  createFakeRuntimeMessagingPort,
  createFakeSchedulerPort,
  type FakeRuntimeMessagingPort,
} from "./environment-events";
import {
  createFakeCookiesPort,
  createFakeDownloadsPort,
  createFakeHistoryPort,
  createFakeSearchPort,
  createFakeWindowsPort,
} from "./environment-tools";

function createFakeBrowserPagePort(): BrowserPagePort {
  let nextTabId = 1;
  return {
    async getTab(tabId) {
      return { id: tabId, url: "https://fake.test/", title: "Fake" };
    },
    async queryTabs() {
      return [{ id: 1, url: "https://fake.test/", active: true }];
    },
    async updateTab(tabId, update) {
      return { id: tabId, url: update.url, active: update.active };
    },
    async createTab(options) {
      return { id: nextTabId++, url: options.url, active: options.active };
    },
    async removeTab() {},
    async reloadTab() {},
    async captureVisibleTab() {
      return "data:image/png;base64,";
    },
  };
}

function createFakeContentBridgePort(): ContentBridgePort {
  return {
    async sendMessage() {
      return undefined as never;
    },
    async executeContentScripts() {},
    async executeFunction(_tabId, fn, args = []) {
      // Run the injected function in-process (single "frame").
      return [{ result: fn(...args), frameId: 0 }];
    },
    getContentScriptFiles() {
      return [];
    },
    onContentScriptReady() {
      return () => {};
    },
    onTabRemoved() {
      return () => {};
    },
    onBeforeNavigate() {
      return () => {};
    },
  };
}

function createFakeNotificationsPort(): NotificationsPort {
  return {
    isAvailable: () => true,
    async create(id: string, _options: NotificationCreateOptions) {
      return id;
    },
    async clear() {
      return true;
    },
    async getPermissionLevel() {
      return "granted";
    },
    onClicked() {
      return () => {};
    },
    onClosed() {
      return () => {};
    },
  };
}

function createFakeAudioCapturePort(): AudioCapturePort {
  return {
    isAvailable: () => false,
    async getMediaStreamId() {
      return "fake-stream-id";
    },
    async ensureOffscreenDocument() {},
    async closeOffscreenDocument() {},
  };
}

export interface FakeEnvironmentHandles {
  env: RuntimeEnvironment;
  messaging: FakeRuntimeMessagingPort;
}

export function createFakeEnvironment(
  overrides: Partial<RuntimeEnvironment> = {},
): FakeEnvironmentHandles {
  const messaging = createFakeRuntimeMessagingPort();
  const env: RuntimeEnvironment = {
    persistence: createFakePersistencePort().port,
    messaging,
    navigationEvents: createFakeNavigationEventsPort(),
    scheduler: createFakeSchedulerPort(),
    page: createFakeBrowserPagePort(),
    content: createFakeContentBridgePort(),
    downloads: createFakeDownloadsPort(),
    cookies: createFakeCookiesPort(),
    history: createFakeHistoryPort(),
    search: createFakeSearchPort(),
    windows: createFakeWindowsPort(),
    notifications: createFakeNotificationsPort(),
    audioCapture: createFakeAudioCapturePort(),
    ...overrides,
  };
  return { env, messaging: (overrides.messaging as FakeRuntimeMessagingPort) ?? messaging };
}
