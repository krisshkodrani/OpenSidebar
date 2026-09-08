import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../setup";
import {
  DEFAULT_SETTINGS_VIEW_SESSION_STATE,
  parseSettingsViewSessionState,
  settingsViewSessionKey,
  useSettingsViewSession,
} from "../../src/sidepanel/hooks/useSettingsViewSession";
import {
  chromeUiRuntimePort,
  setUiRuntimePortForTesting,
  type UiRuntimeStorageArea,
} from "../../src/sidepanel/runtime";

function sessionArea() {
  const values = new Map<string, unknown>();
  const listeners = new Set<
    (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) => void
  >();
  const area: UiRuntimeStorageArea = {
    async get(keys) {
      const names =
        typeof keys === "string"
          ? [keys]
          : Array.isArray(keys)
            ? keys
            : [...values.keys()];
      return Object.fromEntries(
        names.filter((key) => values.has(key)).map((key) => [key, values.get(key)]),
      );
    },
    async set(items) {
      const changes: Record<
        string,
        { oldValue?: unknown; newValue?: unknown }
      > = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: values.get(key), newValue: value };
        values.set(key, value);
      }
      for (const listener of listeners) listener(changes);
    },
    async remove(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) values.delete(key);
    },
    onChanged(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { area, values };
}

function Harness() {
  const [view, update] = useSettingsViewSession();
  return (
    <div>
      <output>{`${view.open}:${view.activeTab}`}</output>
      <button onClick={() => update({ open: true })}>Open</button>
      <button onClick={() => update({ open: false })}>Close</button>
      <button onClick={() => update({ activeTab: "browser" })}>Browser</button>
    </div>
  );
}

describe("Settings view session", () => {
  let container: HTMLDivElement;
  let root: Root;
  let restoreRuntime: (() => void) | undefined;
  const storage = sessionArea();
  let windowId = 7;

  const mount = async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<Harness />);
    });
  };

  const unmount = async () => {
    if (!root) return;
    await act(async () => root.unmount());
    container.remove();
  };

  const click = async (label: string) => {
    const button = [...container.querySelectorAll("button")].find(
      (item) => item.textContent === label,
    );
    await act(async () => button?.click());
  };

  beforeEach(() => {
    windowId = 7;
    storage.values.clear();
    restoreRuntime = setUiRuntimePortForTesting({
      ...chromeUiRuntimePort,
      getCurrentWindow: async () => ({ id: windowId }),
      storage: { ...chromeUiRuntimePort.storage, session: storage.area },
    });
  });

  afterEach(async () => {
    await unmount();
    restoreRuntime?.();
  });

  it("validates stored state and scopes it by window", () => {
    expect(settingsViewSessionKey(4)).toBe("opensidebar:settingsView:v1:4");
    expect(
      parseSettingsViewSessionState({ open: true, activeTab: "advanced" }),
    ).toEqual({ open: true, activeTab: "advanced" });
    expect(
      parseSettingsViewSessionState({ open: "yes", activeTab: "unknown" }),
    ).toEqual(DEFAULT_SETTINGS_VIEW_SESSION_STATE);
  });

  it("restores the open drawer and selected section after a remount", async () => {
    await mount();
    await click("Open");
    await click("Browser");
    await expect.poll(() => storage.values.get(settingsViewSessionKey(7))).toEqual({
      open: true,
      activeTab: "browser",
    });

    await unmount();
    await mount();
    await expect.poll(() => container.querySelector("output")?.textContent).toBe(
      "true:browser",
    );
  });

  it("synchronizes close state between sidepanel instances", async () => {
    storage.values.set(settingsViewSessionKey(7), {
      open: true,
      activeTab: "browser",
    });
    await mount();
    await expect.poll(() => container.querySelector("output")?.textContent).toBe(
      "true:browser",
    );

    await act(async () => {
      await storage.area.set({
        [settingsViewSessionKey(7)]: { open: false, activeTab: "browser" },
      });
    });
    expect(container.querySelector("output")?.textContent).toBe(
      "false:browser",
    );
  });

  it("does not restore another window's Settings view", async () => {
    storage.values.set(settingsViewSessionKey(7), {
      open: true,
      activeTab: "browser",
    });
    windowId = 8;
    await mount();
    await expect.poll(() => container.querySelector("output")?.textContent).toBe(
      "false:account",
    );
  });
});
