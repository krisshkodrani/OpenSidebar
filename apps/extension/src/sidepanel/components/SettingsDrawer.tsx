import React, { useEffect, useRef, useState } from "react";
import { X, Save, Moon, Sun, Monitor, Download } from "lucide-react";
import { useStore } from "../store";
import type {
  LaneTopologyMode,
  PerceptionRuntimeMode,
  UserSettings,
} from "../../types";
import {
  DEFAULT_ENABLED_SKILL_PACK_IDS,
  DEFAULT_MAX_IMAGE_PROMPT_TOKEN_ESTIMATE,
} from "../../types";
import { getDefaultExecutorModel } from "../../utils/executor-model-policy";
import { getProviderKeyStatus } from "../../utils/provider-keys";
import {
  loadSettings,
  normalizeMaxImagePromptTokenEstimate,
  saveSettings,
} from "../../utils/settings-storage";
import { storageLogger } from "../../utils/storage-logger";
import {
  MODEL_PLANNER,
  GROQ_MODEL_PLANNER,
  FIREWORKS_MODEL_PLANNER,
  MOONSHOT_MODEL_PLANNER,
  DEEPSEEK_MODEL_PLANNER,
  XIAOMI_MODEL_PLANNER,
} from "../../background/llm/client";
import { clearTTSCache } from "../hooks/useTextToSpeech";
import { uiRuntime } from "../runtime";
import {
  getProviderModelCatalogNote,
  getProviderModelOptions,
  useOpenRouterModels,
} from "../hooks/useOpenRouterModels";
import { ModelSelector } from "./ModelSelector";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const MAX_TURNS_PRESETS = [30, 50, 100, 200, 500];

type SettingsTab = "general" | "models" | "voice";

const LANE_TOPOLOGY_OPTIONS: {
  value: LaneTopologyMode;
  label: string;
  description: string;
}[] = [
  {
    value: "full",
    label: "Reliable",
    description: "Planner, executor, and verifier for highest correctness.",
  },
  {
    value: "standard",
    label: "Balanced",
    description: "Planner and executor without final verification.",
  },
  {
    value: "simple",
    label: "Fast",
    description: "Single executor lane for simple read-only tasks.",
  },
];

const PERCEPTION_MODE_OPTIONS: {
  value: PerceptionRuntimeMode;
  label: string;
  description: string;
}[] = [
  {
    value: "auto",
    label: "Auto-detect",
    description:
      "Use text when the page is readable; add screenshots for visual or sparse pages.",
  },
  {
    value: "unified_vl",
    label: "Prefer vision",
    description: "Always send screenshots directly to the executor.",
  },
  {
    value: "structured",
    label: "Text only",
    description: "Use DOM text and element data without executor screenshots.",
  },
];

const SKILL_PACK_OPTIONS = [
  {
    id: "communication-workflows",
    label: "Communication workflows",
    description: "Careful email reply and message composition guidance.",
  },
  {
    id: "procurement-workflows",
    label: "Procurement workflows",
    description: "Tabbed store purchasing and checklist completion guidance.",
  },
];

const OPENAI_TTS_VOICES = [
  { value: "nova", label: "Nova" },
  { value: "alloy", label: "Alloy" },
  { value: "echo", label: "Echo" },
  { value: "shimmer", label: "Shimmer" },
  { value: "onyx", label: "Onyx" },
  { value: "fable", label: "Fable" },
];

const GROQ_TTS_VOICES = [
  { value: "hannah", label: "Hannah" },
  { value: "troy", label: "Troy" },
  { value: "austin", label: "Austin" },
  { value: "diana", label: "Diana" },
  { value: "daniel", label: "Daniel" },
  { value: "autumn", label: "Autumn" },
];

const GEMINI_TTS_VOICES = [
  { value: "Kore", label: "Kore" },
  { value: "Puck", label: "Puck" },
  { value: "Zephyr", label: "Zephyr" },
  { value: "Leda", label: "Leda" },
  { value: "Enceladus", label: "Enceladus" },
  { value: "Charon", label: "Charon" },
];

const GEMINI_TTS_STYLE_PRESETS = [
  { value: "neutral", label: "Neutral" },
  { value: "friendly", label: "Friendly" },
  { value: "calm", label: "Calm" },
  { value: "excited", label: "Excited" },
  { value: "serious", label: "Serious" },
];

function getProviderOneLiner(mode: UserSettings["providerMode"] = "fireworks") {
  if (mode === "fireworks") return "Executor + Planner via Fireworks AI";
  if (mode === "fireworks-deepseek")
    return "Executor via Fireworks AI, Planner via DeepSeek";
  if (mode === "moonshot") return "Executor + Planner via Moonshot AI";
  if (mode === "xiaomi") return "Executor + Planner via Xiaomi MiMo";
  if (mode === "openrouter") return "Executor + Planner via OpenRouter";
  if (mode === "openrouter-groq")
    return "Executor via OpenRouter, Planner via Groq";
  if (mode === "openai-groq")
    return "Executor via a Fireworks-backed OpenAI-compatible endpoint, Planner via Groq";
  return "";
}

/** Which provider modes use which key */
function getKeyUsage(
  key:
    | "openRouter"
    | "fireworks"
    | "deepseek"
    | "moonshot"
    | "xiaomi"
    | "openai"
    | "groq"
    | "gemini",
  mode: string,
): string {
  const uses: string[] = [];
  if (key === "openRouter") {
    if (mode === "openrouter" || mode === "openrouter-groq") uses.push("agent");
  }
  if (key === "fireworks") {
    if (mode === "fireworks" || mode === "fireworks-deepseek")
      uses.push("agent");
  }
  if (key === "deepseek") {
    if (mode === "fireworks-deepseek") uses.push("agent");
  }
  if (key === "moonshot") {
    if (mode === "moonshot") uses.push("agent");
  }
  if (key === "xiaomi") {
    if (mode === "xiaomi") uses.push("agent");
  }
  if (key === "openai") {
    if (mode === "openai-groq") uses.push("agent");
    uses.push("voice (TTS)");
  }
  if (key === "groq") {
    if (mode === "openrouter-groq" || mode === "openai-groq")
      uses.push("agent");
    uses.push("voice (STT/TTS)");
  }
  if (key === "gemini") {
    uses.push("voice (STT/TTS expressive)");
  }
  return uses.length
    ? `Used by: ${uses.join(", ")}`
    : "Not used by current mode";
}

export function SettingsDrawer({ isOpen, onClose }: Props) {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const clearHistory = useStore((s) => s.clearHistory);

  const [formState, setFormState] = useState<UserSettings>(settings);
  const [isDirty, setIsDirty] = useState(false);
  const [siteBlocklistText, setSiteBlocklistText] = useState("");
  const [dataControlStatus, setDataControlStatus] = useState<string | null>(
    null,
  );
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [notificationPermissionError, setNotificationPermissionError] =
    useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const { models, loading: modelsLoading } = useOpenRouterModels(
    activeTab === "models" ? formState.openRouterApiKey : "",
  );

  useEffect(() => {
    setFormState(settings);
    setIsDirty(false);
    setSiteBlocklistText((settings.siteAccessBlocklist ?? []).join("\n"));
    setDataControlStatus(null);
    setSaveStatus(null);
    setIsSaving(false);
    setNotificationPermissionError(null);
  }, [settings, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    closeButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSaving) {
        onClose();
        return;
      }

      if (e.key === "Tab" && drawerRef.current) {
        const focusable =
          drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isSaving, onClose]);

  const handleChange = (key: keyof UserSettings, value: any) => {
    setFormState((prev) => {
      const next = { ...prev, [key]: value };
      setIsDirty(JSON.stringify(next) !== JSON.stringify(settings));
      return next;
    });
  };

  const handleSkillPackToggle = (packId: string, checked: boolean) => {
    setFormState((prev) => {
      const current = prev.enabledSkillPackIds ?? DEFAULT_ENABLED_SKILL_PACK_IDS;
      const nextPackIds = checked
        ? current.includes(packId)
          ? current
          : [...current, packId]
        : current.filter((id) => id !== packId);
      const next = { ...prev, enabledSkillPackIds: nextPackIds };
      setIsDirty(JSON.stringify(next) !== JSON.stringify(settings));
      return next;
    });
  };

  const handleExportLogs = async () => {
    const blobUrl = await storageLogger.exportAsJsonl(uiRuntime.storage.local);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = "opensidebar-logs.jsonl";
    a.click();
    URL.revokeObjectURL(blobUrl);
  };

  const requestBrowserNotificationPermission = async (): Promise<boolean> => {
    return uiRuntime.requestPermissions(["notifications"]);
  };

  const handleBrowserNotificationToggle = async (checked: boolean) => {
    setNotificationPermissionError(null);
    if (!checked) {
      handleChange("enableBrowserNotifications", false);
      return;
    }

    const granted = await requestBrowserNotificationPermission();
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
      providerMode: formState.providerMode ?? "fireworks",
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

      // Clear the "add API key" error if the active provider key is now present.
      const savedState = persisted ?? nextState;
      const providerKeyStatus = getProviderKeyStatus(savedState);
      if (providerKeyStatus.hasRequiredKeys) {
        const { error, setError } = useStore.getState();
        if (error?.includes("API key")) setError(null);
      }

      onClose();
    } catch (error: any) {
      setSaveStatus(
        `Failed to save settings: ${error?.message ?? String(error)}`,
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDataControl = async (
    action: "clear_logs" | "clear_chat_history" | "clear_local_data",
  ) => {
    setDataControlStatus("Applying...");
    try {
      const res = await uiRuntime.sendMessage<{
        ok?: boolean;
        detail?: string;
      }>({
        type: "DATA_CONTROL_REQUEST",
        requestId: crypto.randomUUID(),
        source: "sidepanel",
        payload: { action },
      });

      const ok = Boolean(res?.ok);
      const detail = res?.detail || (ok ? "Done." : "Action failed.");
      setDataControlStatus(detail);

      if (action === "clear_chat_history" && ok) {
        clearHistory(); // also clears TTS cache via chat-slice
      }
      if (action === "clear_local_data" && ok) {
        clearTTSCache();
      }
    } catch (error: any) {
      setDataControlStatus(`Failed: ${error?.message ?? String(error)}`);
    }
  };

  if (!isOpen) return null;

  const providerMode = formState.providerMode || "fireworks";
  const hasOpenRouterKey = Boolean(formState.openRouterApiKey);
  const executorModels = getProviderModelOptions({
    providerMode,
    role: "executor",
    openRouterModels: models,
  });
  const plannerModels = getProviderModelOptions({
    providerMode,
    role: "planner",
    openRouterModels: models,
  });
  const openRouterCatalogActive =
    providerMode === "openrouter" || providerMode === "openrouter-groq";
  const hasAnyTTSKey = Boolean(
    formState.groqApiKey || formState.openaiApiKey || formState.geminiApiKey,
  );
  const inferredTTSProvider = formState.groqApiKey
    ? "groq"
    : formState.openaiApiKey
      ? "openai"
      : formState.geminiApiKey
        ? "gemini"
        : "auto";
  const selectedTTSProvider = formState.ttsProvider || "auto";
  const effectiveTTSProvider =
    selectedTTSProvider === "auto" ? inferredTTSProvider : selectedTTSProvider;
  const ttsVoiceOptions =
    effectiveTTSProvider === "openai"
      ? OPENAI_TTS_VOICES
      : effectiveTTSProvider === "gemini"
        ? GEMINI_TTS_VOICES
        : GROQ_TTS_VOICES;
  const defaultTTSVoice =
    effectiveTTSProvider === "openai"
      ? "nova"
      : effectiveTTSProvider === "gemini"
        ? "Kore"
        : "hannah";

  const tabClass = (tab: SettingsTab) =>
    `px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
      activeTab === tab
        ? "border-primary-500 text-primary-600 dark:text-primary-400"
        : "border-transparent text-warm-500 dark:text-warm-400 hover:text-warm-700 dark:hover:text-warm-300"
    }`;

  // Shared input class for API key fields
  const inputCls =
    "w-full px-3 py-2 text-sm border border-warm-300 dark:border-warm-700 rounded-md bg-warm-50 dark:bg-warm-900 focus:ring-2 focus:ring-primary-500 outline-none dark:text-warm-100";
  const hintCls = "text-[11px] text-warm-400 dark:text-warm-500 mt-0.5";

  return (
    <div
      className="absolute inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-sm backdrop-enter"
        onClick={() => {
          if (!isSaving) onClose();
        }}
      />

      <div
        ref={drawerRef}
        className="relative w-full max-w-[360px] h-full bg-warm-50 dark:bg-warm-900 shadow-2xl flex flex-col border-l border-warm-200 dark:border-warm-800 drawer-enter"
      >
        <header className="flex items-center justify-between p-4 border-b border-warm-200 dark:border-warm-800">
          <h2 className="font-semibold text-lg dark:text-warm-100">Settings</h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            disabled={isSaving}
            className="p-2 hover:bg-warm-100 dark:hover:bg-warm-800 rounded-full disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X size={20} className="text-warm-500" />
          </button>
        </header>

        {/* Tab bar */}
        <div className="flex border-b border-warm-200 dark:border-warm-800 px-4">
          <button
            className={tabClass("general")}
            onClick={() => setActiveTab("general")}
          >
            General
          </button>
          <button
            className={tabClass("models")}
            onClick={() => setActiveTab("models")}
          >
            Models
          </button>
          <button
            className={tabClass("voice")}
            onClick={() => setActiveTab("voice")}
          >
            Voice
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* ═══════════════ GENERAL TAB ═══════════════ */}
          {activeTab === "general" && (
            <>
              {/* APPEARANCE */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">
                  Appearance
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {(["light", "dark", "system"] as const).map((theme) => (
                    <button
                      key={theme}
                      onClick={() => handleChange("theme", theme)}
                      className={`flex flex-col items-center gap-2 p-3 rounded-lg border text-xs font-medium transition-all ${
                        formState.theme === theme
                          ? "border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 ring-1 ring-primary-500"
                          : "border-warm-200 dark:border-warm-700 hover:bg-warm-100 dark:hover:bg-warm-800 text-warm-600 dark:text-warm-400"
                      }`}
                    >
                      {theme === "light" && <Sun size={18} />}
                      {theme === "dark" && <Moon size={18} />}
                      {theme === "system" && <Monitor size={18} />}
                      <span className="capitalize">{theme}</span>
                    </button>
                  ))}
                </div>
              </section>

              {/* AGENT */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">
                  Agent
                </h3>

                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium dark:text-warm-300">
                    Max Turns
                  </label>
                  <select
                    value={formState.maxTurns}
                    onChange={(e) =>
                      handleChange("maxTurns", parseInt(e.target.value, 10))
                    }
                    className="text-sm border border-warm-300 dark:border-warm-700 rounded px-2 py-1 bg-warm-50 dark:bg-warm-900 dark:text-warm-100 outline-none"
                  >
                    {MAX_TURNS_PRESETS.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <div>
                    <label className="text-sm font-medium dark:text-warm-300">
                      Execution mode
                    </label>
                    <p className="text-xs text-warm-400 dark:text-warm-500">
                      Choose how much planning and verification the agent uses.
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-1 rounded-lg bg-warm-100 dark:bg-warm-800 p-1">
                    {LANE_TOPOLOGY_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() =>
                          handleChange("laneTopologyMode", option.value)
                        }
                        title={option.description}
                        className={`min-h-8 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                          (formState.laneTopologyMode ?? "full") ===
                          option.value
                            ? "bg-warm-50 text-primary-700 shadow-sm dark:bg-warm-900 dark:text-primary-300"
                            : "text-warm-500 hover:text-warm-700 dark:text-warm-400 dark:hover:text-warm-200"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-warm-400 dark:text-warm-500">
                    {
                      LANE_TOPOLOGY_OPTIONS.find(
                        (option) =>
                          option.value ===
                          (formState.laneTopologyMode ?? "full"),
                      )?.description
                    }
                  </p>
                </div>

                <div className="space-y-2">
                  <div>
                    <label className="text-sm font-medium dark:text-warm-300">
                      Skill packs
                    </label>
                    <p className="text-xs text-warm-400 dark:text-warm-500">
                      Optional workflow guidance used by the planner.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {SKILL_PACK_OPTIONS.map((pack) => {
                      const enabledIds =
                        formState.enabledSkillPackIds ??
                        DEFAULT_ENABLED_SKILL_PACK_IDS;
                      const checked = enabledIds.includes(pack.id);
                      return (
                        <label
                          key={pack.id}
                          className="flex items-start gap-3 rounded-md border border-warm-200 dark:border-warm-800 px-3 py-2"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              handleSkillPackToggle(pack.id, e.target.checked)
                            }
                            className="mt-0.5 w-4 h-4 text-primary-600 rounded"
                          />
                          <span>
                            <span className="block text-sm font-medium dark:text-warm-300">
                              {pack.label}
                            </span>
                            <span className="block text-xs text-warm-400 dark:text-warm-500">
                              {pack.description}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium dark:text-warm-300">
                      Allow navigation
                    </label>
                    <p className="text-xs text-warm-400 dark:text-warm-500">
                      Let agent open or switch to new pages
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={formState.allowNavigation}
                    onChange={(e) =>
                      handleChange("allowNavigation", e.target.checked)
                    }
                    className="w-4 h-4 text-primary-600 rounded"
                  />
                </div>
              </section>

              {/* SAFETY */}
              <section className="space-y-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-900/10 p-3">
                <h3 className="text-xs font-semibold uppercase text-amber-700 dark:text-amber-300 tracking-wider">
                  Safety
                </h3>

                <div className="space-y-1">
                  <label className="text-sm font-medium dark:text-warm-300">
                    Site Access Rules
                  </label>
                  <select
                    value={formState.siteAccessMode ?? "allow_all"}
                    onChange={(e) =>
                      handleChange(
                        "siteAccessMode",
                        e.target.value as "allow_all" | "blocklist",
                      )
                    }
                    className="w-full text-sm border border-warm-300 dark:border-warm-700 rounded px-2 py-1.5 bg-warm-50 dark:bg-warm-900 dark:text-warm-100 outline-none"
                  >
                    <option value="allow_all">Allow all sites</option>
                    <option value="blocklist">Block listed domains</option>
                  </select>
                  {formState.siteAccessMode === "blocklist" && (
                    <>
                      <p className="text-xs text-warm-500 dark:text-warm-500">
                        One domain per line. Example: bank.com
                      </p>
                      <textarea
                        value={siteBlocklistText}
                        onChange={(e) => setSiteBlocklistText(e.target.value)}
                        rows={4}
                        className="w-full px-3 py-2 text-sm border border-warm-300 dark:border-warm-700 rounded-md bg-warm-50 dark:bg-warm-900 focus:ring-2 focus:ring-primary-500 outline-none dark:text-warm-100"
                        placeholder={"bank.com\npayments.example.com"}
                      />
                    </>
                  )}
                </div>
              </section>

              {/* DISPLAY */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">
                  Display
                </h3>

                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium dark:text-warm-300">
                      Show session metrics
                    </label>
                    <p className="text-xs text-warm-400 dark:text-warm-500">
                      Token usage, cost, and timing
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={formState.showSessionMetrics}
                    onChange={(e) =>
                      handleChange("showSessionMetrics", e.target.checked)
                    }
                    className="w-4 h-4 text-primary-600 rounded"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium dark:text-warm-300">
                      Expand tool details by default
                    </label>
                    <p className="text-xs text-warm-400 dark:text-warm-500">
                      Show steps and tool logs automatically
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(formState.showMessageDetailsByDefault)}
                    onChange={(e) =>
                      handleChange(
                        "showMessageDetailsByDefault",
                        e.target.checked,
                      )
                    }
                    className="w-4 h-4 text-primary-600 rounded"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium dark:text-warm-300">
                      Browser notifications
                    </label>
                    <p className="text-xs text-warm-400 dark:text-warm-500">
                      Notify when an agent needs attention or finishes while you
                      are away from the workspace.
                    </p>
                    {notificationPermissionError && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                        {notificationPermissionError}
                      </p>
                    )}
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(formState.enableBrowserNotifications)}
                    onChange={(e) =>
                      void handleBrowserNotificationToggle(e.target.checked)
                    }
                    className="w-4 h-4 text-primary-600 rounded"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium dark:text-warm-300">
                      Show debug screenshots
                    </label>
                    <p className="text-xs text-warm-400 dark:text-warm-500">
                      Developer-only screenshot toast when debug captures are
                      emitted
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(formState.showDebugScreenshots)}
                    onChange={(e) =>
                      handleChange("showDebugScreenshots", e.target.checked)
                    }
                    className="w-4 h-4 text-primary-600 rounded"
                  />
                </div>
              </section>

              {/* DATA */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">
                  Data
                </h3>

                <div className="grid grid-cols-1 gap-2">
                  <button
                    onClick={() => {
                      if (
                        window.confirm(
                          "Clear all chat history? This cannot be undone.",
                        )
                      )
                        void handleDataControl("clear_chat_history");
                    }}
                    className="w-full flex items-center justify-center gap-2 p-2.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-900/30 rounded-lg transition-colors text-sm font-medium"
                  >
                    Clear Chat History
                  </button>
                  <button
                    onClick={() => {
                      if (
                        window.confirm(
                          "Clear all local logs? This cannot be undone.",
                        )
                      )
                        void handleDataControl("clear_logs");
                    }}
                    className="w-full flex items-center justify-center gap-2 p-2.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-900/30 rounded-lg transition-colors text-sm font-medium"
                  >
                    Clear Local Logs
                  </button>
                  <button
                    onClick={() => {
                      if (
                        window.confirm(
                          "Clear ALL local data? This includes chat history, logs, settings, and saved prompts. This cannot be undone.",
                        )
                      )
                        void handleDataControl("clear_local_data");
                    }}
                    className="w-full flex items-center justify-center gap-2 p-2.5 text-red-700 hover:bg-red-100 dark:hover:bg-red-900/30 border border-red-300 dark:border-red-900/40 rounded-lg transition-colors text-sm font-semibold"
                  >
                    Clear All Local Data
                  </button>
                </div>

                {dataControlStatus && (
                  <p className="text-xs text-warm-500 dark:text-warm-400">
                    {dataControlStatus}
                  </p>
                )}

                <button
                  onClick={handleExportLogs}
                  className="w-full flex items-center justify-center gap-2 p-2.5 text-warm-600 dark:text-warm-300 hover:bg-warm-100 dark:hover:bg-warm-800 border border-warm-200 dark:border-warm-700 rounded-lg transition-colors text-sm font-medium"
                >
                  <Download size={16} />
                  Export Logs
                </button>
              </section>
            </>
          )}

          {/* ═══════════════ MODELS TAB ═══════════════ */}
          {activeTab === "models" && (
            <>
              {/* API KEYS — always visible, all providers */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">
                  API Keys
                </h3>

                <div className="space-y-1">
                  <label className="text-sm font-medium dark:text-warm-300">
                    OpenRouter
                  </label>
                  <input
                    type="password"
                    value={formState.openRouterApiKey}
                    onChange={(e) =>
                      handleChange("openRouterApiKey", e.target.value)
                    }
                    className={inputCls}
                    placeholder="sk-or-..."
                  />
                  <p className={hintCls}>
                    {getKeyUsage("openRouter", providerMode)}
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium dark:text-warm-300">
                    Fireworks AI
                  </label>
                  <input
                    type="password"
                    value={formState.fireworksApiKey || ""}
                    onChange={(e) =>
                      handleChange("fireworksApiKey", e.target.value)
                    }
                    className={inputCls}
                    placeholder="fw_..."
                  />
                  <p className={hintCls}>
                    {getKeyUsage("fireworks", providerMode)}
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium dark:text-warm-300">
                    DeepSeek
                  </label>
                  <input
                    type="password"
                    value={formState.deepseekApiKey || ""}
                    onChange={(e) =>
                      handleChange("deepseekApiKey", e.target.value)
                    }
                    className={inputCls}
                    placeholder="sk-..."
                  />
                  <p className={hintCls}>
                    {getKeyUsage("deepseek", providerMode)}
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium dark:text-warm-300">
                    Moonshot AI
                  </label>
                  <input
                    type="password"
                    value={formState.kimiApiKey || ""}
                    onChange={(e) => handleChange("kimiApiKey", e.target.value)}
                    className={inputCls}
                    placeholder="sk-kimi-..."
                  />
                  <p className={hintCls}>
                    {getKeyUsage("moonshot", providerMode)}
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium dark:text-warm-300">
                    Xiaomi MiMo
                  </label>
                  <input
                    type="password"
                    value={formState.xiaomiApiKey || ""}
                    onChange={(e) =>
                      handleChange("xiaomiApiKey", e.target.value)
                    }
                    className={inputCls}
                    placeholder="sk-..."
                  />
                  <p className={hintCls}>
                    {getKeyUsage("xiaomi", providerMode)}
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium dark:text-warm-300">
                    OpenAI
                  </label>
                  <input
                    type="password"
                    value={formState.openaiApiKey || ""}
                    onChange={(e) =>
                      handleChange("openaiApiKey", e.target.value)
                    }
                    className={inputCls}
                    placeholder="sk-..."
                  />
                  <p className={hintCls}>
                    {getKeyUsage("openai", providerMode)}
                  </p>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium dark:text-warm-300">
                    Groq
                  </label>
                  <input
                    type="password"
                    value={formState.groqApiKey || ""}
                    onChange={(e) => handleChange("groqApiKey", e.target.value)}
                    className={inputCls}
                    placeholder="gsk_..."
                  />
                  <p className={hintCls}>{getKeyUsage("groq", providerMode)}</p>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium dark:text-warm-300">
                    Gemini
                  </label>
                  <input
                    type="password"
                    value={formState.geminiApiKey || ""}
                    onChange={(e) =>
                      handleChange("geminiApiKey", e.target.value)
                    }
                    className={inputCls}
                    placeholder="AIza..."
                  />
                  <p className={hintCls}>
                    {getKeyUsage("gemini", providerMode)}
                  </p>
                </div>
              </section>

              {/* PROVIDER STACK */}
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">
                  Provider Stack
                </h3>
                <select
                  value={providerMode}
                  onChange={(e) =>
                    handleChange(
                      "providerMode",
                      e.target.value as
                        | "fireworks"
                        | "fireworks-deepseek"
                        | "moonshot"
                        | "xiaomi"
                        | "openrouter"
                        | "openrouter-groq"
                        | "openai-groq",
                    )
                  }
                  className={inputCls}
                >
                  <option value="fireworks">Fireworks AI (Kimi K2.5)</option>
                  <option value="fireworks-deepseek">
                    Fireworks + DeepSeek
                  </option>
                  <option value="moonshot">Moonshot AI (Kimi 2.6)</option>
                  <option value="xiaomi">Xiaomi MiMo</option>
                  <option value="openrouter">OpenRouter (GPT-5.4-mini)</option>
                  <option value="openrouter-groq">OpenRouter + Groq</option>
                  <option value="openai-groq">OpenAI-Compatible + Groq</option>
                </select>
                <p className="text-xs text-warm-400 dark:text-warm-500">
                  {getProviderOneLiner(providerMode)}
                </p>
              </section>

              {/* MODEL OVERRIDES */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">
                  Model Overrides
                </h3>

                <div className="space-y-1">
                  <label className="text-sm font-medium dark:text-warm-300">
                    Executor
                  </label>
                  <p className="text-xs text-warm-400 dark:text-warm-500">
                    Multimodal model for screenshots, tool execution, and page
                    interaction
                  </p>
                  <p className="text-xs text-warm-500 dark:text-warm-400">
                    {getProviderModelCatalogNote({
                      providerMode,
                      role: "executor",
                      hasOpenRouterKey,
                    })}
                  </p>
                  <ModelSelector
                    value={formState.executorModel || ""}
                    onChange={(v) =>
                      handleChange("executorModel", v || undefined)
                    }
                    defaultModel={getDefaultExecutorModel(providerMode)}
                    models={executorModels}
                    loading={openRouterCatalogActive ? modelsLoading : false}
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium dark:text-warm-300">
                    Planner
                  </label>
                  <p className="text-xs text-warm-400 dark:text-warm-500">
                    Reasoning model for task decomposition and escalation
                  </p>
                  <p className="text-xs text-warm-500 dark:text-warm-400">
                    {getProviderModelCatalogNote({
                      providerMode,
                      role: "planner",
                      hasOpenRouterKey,
                    })}
                  </p>
                  <ModelSelector
                    value={formState.plannerModel || ""}
                    onChange={(v) =>
                      handleChange("plannerModel", v || undefined)
                    }
                    defaultModel={
                      providerMode === "moonshot"
                        ? MOONSHOT_MODEL_PLANNER
                        : providerMode === "xiaomi"
                          ? XIAOMI_MODEL_PLANNER
                          : providerMode === "fireworks-deepseek"
                            ? DEEPSEEK_MODEL_PLANNER
                            : providerMode === "fireworks"
                              ? FIREWORKS_MODEL_PLANNER
                              : providerMode !== "openrouter"
                                ? GROQ_MODEL_PLANNER
                                : MODEL_PLANNER
                    }
                    models={plannerModels}
                    loading={
                      providerMode === "openrouter" ? modelsLoading : false
                    }
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium dark:text-warm-300">
                    Observation
                  </label>
                  <select
                    value={formState.perceptionMode ?? "auto"}
                    onChange={(e) =>
                      handleChange(
                        "perceptionMode",
                        e.target.value as PerceptionRuntimeMode,
                      )
                    }
                    className={inputCls}
                  >
                    {PERCEPTION_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-warm-400 dark:text-warm-500">
                    {
                      PERCEPTION_MODE_OPTIONS.find(
                        (option) =>
                          option.value === (formState.perceptionMode ?? "auto"),
                      )?.description
                    }
                  </p>
                  <p className="text-xs text-warm-500 dark:text-warm-400">
                    Vision-only interaction is not exposed yet; visual tasks
                    still keep DOM references for safer tool use.
                  </p>
                  <div className="flex items-center justify-between gap-3 pt-2">
                    <div>
                      <label className="text-sm font-medium dark:text-warm-300">
                        Image budget
                      </label>
                      <p className="text-xs text-warm-400 dark:text-warm-500">
                        Estimated image tokens per session
                      </p>
                    </div>
                    <input
                      type="number"
                      min={0}
                      step={1000}
                      value={
                        formState.maxImagePromptTokenEstimate ??
                        DEFAULT_MAX_IMAGE_PROMPT_TOKEN_ESTIMATE
                      }
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        const next = Number(raw);
                        handleChange(
                          "maxImagePromptTokenEstimate",
                          raw && Number.isFinite(next) && next >= 0
                            ? next
                            : undefined,
                        );
                      }}
                      className={`${inputCls} w-28 text-right`}
                    />
                  </div>
                </div>

                {/* Nitro toggle — OpenRouter modes only */}
                {(providerMode === "openrouter" ||
                  providerMode === "openrouter-groq") && (
                  <div className="flex items-center justify-between py-1">
                    <div>
                      <span className="text-sm font-medium dark:text-warm-300">
                        Nitro
                      </span>
                      <p className="text-xs text-warm-400 dark:text-warm-500 mt-0.5">
                        Route through faster :nitro endpoints
                      </p>
                    </div>
                    <button
                      role="switch"
                      aria-checked={Boolean(formState.useNitro)}
                      onClick={() =>
                        handleChange("useNitro", !formState.useNitro)
                      }
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${formState.useNitro ? "bg-primary-600" : "bg-warm-300 dark:bg-warm-600"}`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${formState.useNitro ? "translate-x-4" : "translate-x-0"}`}
                      />
                    </button>
                  </div>
                )}
              </section>
            </>
          )}

          {/* ═══════════════ VOICE TAB ═══════════════ */}
          {activeTab === "voice" && (
            <>
              {/* STT */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">
                  Speech to Text
                </h3>
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium dark:text-warm-300">
                      Voice input
                    </label>
                    <p className="text-xs text-warm-400 dark:text-warm-500">
                      Record via mic, transcribe with Whisper (Alt+V)
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(formState.enableVoiceInput)}
                    onChange={(e) =>
                      handleChange("enableVoiceInput", e.target.checked)
                    }
                    className="w-4 h-4 text-primary-600 rounded"
                  />
                </div>
                {formState.enableVoiceInput &&
                  !formState.groqApiKey &&
                  !formState.openaiApiKey &&
                  !formState.geminiApiKey && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-md px-3 py-2">
                      Needs a Groq, OpenAI, or Gemini key. Add one in the Models
                      tab.
                    </p>
                  )}
              </section>

              {/* TTS */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">
                  Text to Speech
                </h3>
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium dark:text-warm-300">
                      Voice output
                    </label>
                    <p className="text-xs text-warm-400 dark:text-warm-500">
                      {hasAnyTTSKey
                        ? "Read assistant messages aloud"
                        : "Requires a Groq, OpenAI, or Gemini key"}
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(formState.enableVoiceOutput)}
                    onChange={(e) =>
                      handleChange("enableVoiceOutput", e.target.checked)
                    }
                    disabled={!hasAnyTTSKey}
                    className="w-4 h-4 text-primary-600 rounded disabled:opacity-40"
                  />
                </div>

                {formState.enableVoiceOutput && (
                  <>
                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-sm font-medium dark:text-warm-300">
                          Auto-speak responses
                        </label>
                        <p className="text-xs text-warm-400 dark:text-warm-500">
                          Speak the final answer automatically
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={Boolean(formState.autoVoiceResponse)}
                        onChange={(e) =>
                          handleChange("autoVoiceResponse", e.target.checked)
                        }
                        className="w-4 h-4 text-primary-600 rounded"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs text-warm-400 dark:text-warm-500">
                        Provider
                      </label>
                      <select
                        value={selectedTTSProvider}
                        onChange={(e) => {
                          const nextProvider = e.target.value as
                            | "auto"
                            | "groq"
                            | "openai"
                            | "gemini";
                          handleChange("ttsProvider", nextProvider);
                          handleChange(
                            "ttsVoice",
                            nextProvider === "openai"
                              ? "nova"
                              : nextProvider === "gemini"
                                ? "Kore"
                                : "hannah",
                          );
                        }}
                        className={inputCls}
                      >
                        <option value="auto">Auto (prefer Groq)</option>
                        <option value="groq" disabled={!formState.groqApiKey}>
                          Groq
                        </option>
                        <option
                          value="openai"
                          disabled={!formState.openaiApiKey}
                        >
                          OpenAI
                        </option>
                        <option
                          value="gemini"
                          disabled={!formState.geminiApiKey}
                        >
                          Gemini (Preview)
                        </option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs text-warm-400 dark:text-warm-500">
                        Voice
                      </label>
                      <select
                        value={formState.ttsVoice || defaultTTSVoice}
                        onChange={(e) =>
                          handleChange("ttsVoice", e.target.value)
                        }
                        className={inputCls}
                      >
                        {ttsVoiceOptions.map((voice) => (
                          <option key={voice.value} value={voice.value}>
                            {voice.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {effectiveTTSProvider === "gemini" && (
                      <div className="space-y-1">
                        <label className="text-xs text-warm-400 dark:text-warm-500">
                          Gemini delivery
                        </label>
                        <select
                          value={formState.ttsStylePreset || "neutral"}
                          onChange={(e) =>
                            handleChange("ttsStylePreset", e.target.value)
                          }
                          className={inputCls}
                        >
                          {GEMINI_TTS_STYLE_PRESETS.map((preset) => (
                            <option key={preset.value} value={preset.value}>
                              {preset.label}
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-warm-400 dark:text-warm-500">
                          Gemini-only expressive preset. If tagged delivery
                          fails, OpenSidebar retries with plain speech.
                        </p>
                      </div>
                    )}
                  </>
                )}

                {!hasAnyTTSKey && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-md px-3 py-2">
                    Add a Groq, OpenAI, or Gemini key in the Models tab to
                    enable voice.
                  </p>
                )}
                <p className="text-xs text-warm-400 dark:text-warm-500">
                  Groq TTS requires accepting model terms at console.groq.com.
                  Gemini expressive TTS is preview-only; Gemini speech-to-text
                  uses audio understanding and is not real-time transcription.
                </p>
              </section>
            </>
          )}
        </div>

        <div className="p-4 border-t border-warm-200 dark:border-warm-800 bg-warm-100/50 dark:bg-warm-900/50">
          {saveStatus && (
            <p className="mb-2 text-xs text-red-600 dark:text-red-400">
              {saveStatus}
            </p>
          )}
          <button
            onClick={() => void handleSave()}
            disabled={!isDirty || isSaving}
            className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 px-4 rounded-lg font-medium transition-colors shadow-sm"
          >
            <Save size={18} />
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
