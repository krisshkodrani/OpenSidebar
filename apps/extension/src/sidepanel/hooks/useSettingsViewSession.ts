import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "../../utils";
import { uiRuntime } from "../runtime";
import type { SettingsTab } from "../components/settings/types";

const SETTINGS_VIEW_SESSION_KEY_PREFIX = "opensidebar:settingsView:v1";
const SETTINGS_TABS = new Set<SettingsTab>([
  "account",
  "sync",
  "agent",
  "browser",
  "advanced",
]);

export type SettingsViewSessionState = {
  open: boolean;
  activeTab: SettingsTab;
};

export const DEFAULT_SETTINGS_VIEW_SESSION_STATE: SettingsViewSessionState = {
  open: false,
  activeTab: "account",
};

export function settingsViewSessionKey(windowId?: number | null): string {
  return `${SETTINGS_VIEW_SESSION_KEY_PREFIX}:${windowId ?? "default"}`;
}

export function parseSettingsViewSessionState(
  value: unknown,
): SettingsViewSessionState {
  if (!value || typeof value !== "object")
    return DEFAULT_SETTINGS_VIEW_SESSION_STATE;
  const candidate = value as { open?: unknown; activeTab?: unknown };
  if (
    typeof candidate.open !== "boolean" ||
    typeof candidate.activeTab !== "string" ||
    !SETTINGS_TABS.has(candidate.activeTab as SettingsTab)
  ) {
    return DEFAULT_SETTINGS_VIEW_SESSION_STATE;
  }
  return {
    open: candidate.open,
    activeTab: candidate.activeTab as SettingsTab,
  };
}

/**
 * Keep lightweight Settings navigation state consistent across the tab-specific
 * sidepanel instances in one Chrome window. Deliberately excludes form values,
 * credentials, link codes, and other user-entered drafts.
 */
export function useSettingsViewSession(): [
  SettingsViewSessionState,
  (patch: Partial<SettingsViewSessionState>) => void,
] {
  const [state, setState] = useState<SettingsViewSessionState>(
    DEFAULT_SETTINGS_VIEW_SESSION_STATE,
  );
  const stateRef = useRef(state);
  const keyRef = useRef<string | null>(null);
  const hydratedRef = useRef(false);
  const changedBeforeHydrationRef = useRef(false);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    const initialize = async () => {
      const currentWindow = await uiRuntime.getCurrentWindow().catch(() => null);
      const key = settingsViewSessionKey(currentWindow?.id);
      keyRef.current = key;

      try {
        const stored = await uiRuntime.storage.session.get(key);
        if (!active) return;
        if (changedBeforeHydrationRef.current) {
          await uiRuntime.storage.session.set({ [key]: stateRef.current });
        } else {
          const restored = parseSettingsViewSessionState(stored[key]);
          stateRef.current = restored;
          setState(restored);
        }
      } catch (error) {
        logger.warn("ui", "Failed to restore Settings view state", { error });
      } finally {
        hydratedRef.current = true;
      }

      if (!active) return;
      unsubscribe = uiRuntime.storage.session.onChanged?.((changes) => {
        if (!active || !changes[key]) return;
        const restored = parseSettingsViewSessionState(
          changes[key]?.newValue,
        );
        stateRef.current = restored;
        setState(restored);
      });
    };

    void initialize();
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const update = useCallback((patch: Partial<SettingsViewSessionState>) => {
    const next = { ...stateRef.current, ...patch };
    stateRef.current = next;
    setState(next);
    if (!hydratedRef.current) changedBeforeHydrationRef.current = true;
    const key = keyRef.current;
    if (key) {
      void uiRuntime.storage.session
        .set({ [key]: next })
        .catch((error) =>
          logger.warn("ui", "Failed to persist Settings view state", {
            error,
          }),
        );
    }
  }, []);

  return [state, update];
}
