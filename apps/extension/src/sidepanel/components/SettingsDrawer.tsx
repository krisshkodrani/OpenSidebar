import React, { useEffect, useRef, useState } from "react";
import { Save, X } from "lucide-react";
import { useStore } from "../store";
import type { UserSettings } from "../../types";
import { DEFAULT_ENABLED_SKILL_PACK_IDS } from "../../types";
import {
  clearProviderModelOverrides,
  getProviderKeyStatus,
  reconcileProviderSelection,
  resolveAvailableProviderMode,
} from "../../utils/provider-keys";
import { DEFAULT_PROVIDER_MODE } from "../../utils/executor-model-policy";
import {
  loadSettings,
  normalizeMaxImagePromptTokenEstimate,
  saveSettings,
} from "../../utils/settings-storage";
import { uiRuntime } from "../runtime";
import { useOpenRouterModels } from "../hooks/useOpenRouterModels";
import { GeneralSettingsTab } from "./settings/GeneralSettingsTab";
import { ModelsSettingsTab } from "./settings/ModelsSettingsTab";
import type { SettingsChangeHandler, SettingsTab } from "./settings/types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
const PROVIDER_CREDENTIAL_KEYS: readonly (keyof UserSettings)[] = [
  "openRouterApiKey",
  "fireworksApiKey",
];

export function SettingsDrawer({ isOpen, onClose }: Props) {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);

  const [formState, setFormState] = useState<UserSettings>(settings);
  const [isDirty, setIsDirty] = useState(false);
  const [siteBlocklistText, setSiteBlocklistText] = useState("");
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [notificationPermissionError, setNotificationPermissionError] =
    useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const activeProviderMode = resolveAvailableProviderMode(formState);
  const openRouterCatalogActive = activeProviderMode === "openrouter";

  const {
    error: modelsError,
    models,
    loading: modelsLoading,
  } = useOpenRouterModels(
    activeTab === "models" && openRouterCatalogActive
      ? formState.openRouterApiKey
      : "",
  );

  useEffect(() => {
    const nextSettings = reconcileProviderSelection(settings);
    setFormState(nextSettings);
    setIsDirty(JSON.stringify(nextSettings) !== JSON.stringify(settings));
    setSiteBlocklistText((settings.siteAccessBlocklist ?? []).join("\n"));
    setSaveStatus(null);
    setIsSaving(false);
    setNotificationPermissionError(null);
  }, [settings, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) {
        onClose();
        return;
      }

      if (event.key === "Tab" && drawerRef.current) {
        const focusable =
          drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isSaving, onClose]);

  const handleChange: SettingsChangeHandler = (key, value) => {
    setFormState((previous) => {
      let next = { ...previous, [key]: value };
      const providerChanged =
        key === "providerMode" && value !== previous.providerMode;
      const credentialChanged = PROVIDER_CREDENTIAL_KEYS.includes(key);

      if (credentialChanged) {
        next = reconcileProviderSelection(next);
      } else if (providerChanged) {
        next = clearProviderModelOverrides(next);
      }

      setIsDirty(JSON.stringify(next) !== JSON.stringify(settings));
      return next;
    });
  };

  const handleSkillPackToggle = (packId: string, checked: boolean) => {
    setFormState((previous) => {
      const current =
        previous.enabledSkillPackIds ?? DEFAULT_ENABLED_SKILL_PACK_IDS;
      const nextPackIds = checked
        ? current.includes(packId)
          ? current
          : [...current, packId]
        : current.filter((id) => id !== packId);
      const next = { ...previous, enabledSkillPackIds: nextPackIds };
      setIsDirty(JSON.stringify(next) !== JSON.stringify(settings));
      return next;
    });
  };

  const handleBrowserNotificationToggle = async (checked: boolean) => {
    setNotificationPermissionError(null);
    if (!checked) {
      handleChange("enableBrowserNotifications", false);
      return;
    }

    const granted = await uiRuntime.requestPermissions(["notifications"]);
    if (granted) {
      handleChange("enableBrowserNotifications", true);
    } else {
      handleChange("enableBrowserNotifications", false);
      setNotificationPermissionError(
        "Browser notification permission was not granted.",
      );
    }
  };

  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveStatus(null);

    const blocklist = siteBlocklistText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const nextState: UserSettings = {
      ...formState,
      providerMode:
        resolveAvailableProviderMode(formState) ??
        formState.providerMode ??
        DEFAULT_PROVIDER_MODE,
      maxImagePromptTokenEstimate: normalizeMaxImagePromptTokenEstimate(
        formState.maxImagePromptTokenEstimate,
      ),
      siteAccessBlocklist: blocklist,
    };

    try {
      await saveSettings(nextState, uiRuntime.storage);
      const persisted = await loadSettings(uiRuntime.storage);
      updateSettings(persisted ?? nextState);
      setIsDirty(false);

      const savedState = persisted ?? nextState;
      const providerKeyStatus = getProviderKeyStatus(savedState);
      if (providerKeyStatus.hasRequiredKeys) {
        const { error, setError } = useStore.getState();
        if (error?.includes("API key")) setError(null);
      }

      onClose();
    } catch (error: unknown) {
      setSaveStatus(
        `Failed to save settings: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="absolute inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div
        className="absolute inset-0 bg-black/20 backdrop-enter backdrop-blur-sm"
        onClick={() => {
          if (!isSaving) onClose();
        }}
      />

      <div
        ref={drawerRef}
        className="relative flex h-full w-full max-w-[360px] flex-col border-l border-warm-200 bg-warm-50 shadow-2xl drawer-enter dark:border-warm-800 dark:bg-warm-900"
      >
        <header className="flex items-center justify-between border-b border-warm-200 p-4 dark:border-warm-800">
          <h2 className="text-lg font-semibold dark:text-warm-100">Settings</h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            disabled={isSaving}
            aria-label="Close settings"
            className="rounded-full p-2 hover:bg-warm-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-warm-800"
          >
            <X size={20} className="text-warm-500" />
          </button>
        </header>

        <SettingsTabBar activeTab={activeTab} onChange={setActiveTab} />

        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          {activeTab === "general" ? (
            <GeneralSettingsTab
              formState={formState}
              notificationPermissionError={notificationPermissionError}
              onBrowserNotificationToggle={(checked) =>
                void handleBrowserNotificationToggle(checked)
              }
              onChange={handleChange}
              onSiteBlocklistTextChange={setSiteBlocklistText}
              onSkillPackToggle={handleSkillPackToggle}
              siteBlocklistText={siteBlocklistText}
            />
          ) : null}

          {activeTab === "models" ? (
            <ModelsSettingsTab
              formState={formState}
              models={models}
              modelsError={modelsError}
              modelsLoading={modelsLoading}
              onChange={handleChange}
            />
          ) : null}
        </div>

        <div className="border-t border-warm-200 bg-warm-100/50 p-4 dark:border-warm-800 dark:bg-warm-900/50">
          {saveStatus ? (
            <p className="mb-2 text-xs text-red-600 dark:text-red-400">
              {saveStatus}
            </p>
          ) : null}
          <button
            onClick={() => void handleSave()}
            disabled={!isDirty || isSaving}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save size={18} />
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsTabBar({
  activeTab,
  onChange,
}: {
  activeTab: SettingsTab;
  onChange: (tab: SettingsTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Settings sections"
      className="flex border-b border-warm-200 px-4 dark:border-warm-800"
    >
      {(["general", "models"] as const).map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={activeTab === tab}
          className={`border-b-2 px-3 py-2 text-sm font-medium capitalize transition-colors ${
            activeTab === tab
              ? "border-primary-500 text-primary-600 dark:text-primary-400"
              : "border-transparent text-warm-500 hover:text-warm-700 dark:text-warm-400 dark:hover:text-warm-300"
          }`}
          onClick={() => onChange(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}
