import React, { useEffect, useRef, useState } from "react";
import { X, Save, Moon, Sun, Monitor, Download } from "lucide-react";
import { useStore } from "../store";
import { UserSettings } from "../../types";
import { saveSettings } from "../../utils/settings-storage";
import { storageLogger } from "../../utils/storage-logger";
import { MODEL_EXECUTOR, MODEL_PLANNER } from "../../background/llm/client";
import { useOpenRouterModels } from "../hooks/useOpenRouterModels";
import { ModelSelector } from "./ModelSelector";

const PERCEPTION_MODEL_DEFAULT = "google/gemini-2.5-flash";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const MAX_TURNS_PRESETS = [30, 50, 100, 200, 500];

type SettingsTab = "general" | "models";

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
  }, [settings, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    closeButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
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
  }, [isOpen, onClose]);

  const handleChange = (key: keyof UserSettings, value: any) => {
    setFormState((prev) => {
      const next = { ...prev, [key]: value };
      setIsDirty(JSON.stringify(next) !== JSON.stringify(settings));
      return next;
    });
  };

  const handleExportLogs = async () => {
    const blobUrl = await storageLogger.exportAsJsonl();
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = "opensidebar-logs.jsonl";
    a.click();
    URL.revokeObjectURL(blobUrl);
  };

  const handleSave = () => {
    const blocklist = siteBlocklistText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const nextState: UserSettings = {
      ...formState,
      siteAccessBlocklist: blocklist,
    };

    updateSettings(nextState);
    void saveSettings(nextState);
    onClose();
  };

  const handleDataControl = async (
    action:
      | "clear_logs"
      | "clear_chat_history"
      | "clear_local_data",
  ) => {
    setDataControlStatus("Applying...");
    try {
      const res = (await chrome.runtime.sendMessage({
        type: "DATA_CONTROL_REQUEST",
        requestId: crypto.randomUUID(),
        source: "sidepanel",
        payload: { action },
      })) as { ok?: boolean; detail?: string } | undefined;

      const ok = Boolean(res?.ok);
      const detail = res?.detail || (ok ? "Done." : "Action failed.");
      setDataControlStatus(detail);

      if (action === "clear_chat_history" && ok) {
        clearHistory();
      }
    } catch (error: any) {
      setDataControlStatus(`Failed: ${error?.message ?? String(error)}`);
    }
  };

  if (!isOpen) return null;

  const tabClass = (tab: SettingsTab) =>
    `px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
      activeTab === tab
        ? "border-primary-500 text-primary-600 dark:text-primary-400"
        : "border-transparent text-warm-500 dark:text-warm-400 hover:text-warm-700 dark:hover:text-warm-300"
    }`;

  return (
    <div
      className="absolute inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-sm backdrop-enter"
        onClick={onClose}
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
            className="p-2 hover:bg-warm-100 dark:hover:bg-warm-800 rounded-full"
          >
            <X size={20} className="text-warm-500" />
          </button>
        </header>

        {/* Tab bar */}
        <div className="flex border-b border-warm-200 dark:border-warm-800 px-4">
          <button className={tabClass("general")} onClick={() => setActiveTab("general")}>
            General
          </button>
          <button className={tabClass("models")} onClick={() => setActiveTab("models")}>
            Models
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
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
                    <option value="blocklist">
                      Block listed domains
                    </option>
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
              </section>

              {/* DATA */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">
                  Data
                </h3>

                <div className="grid grid-cols-1 gap-2">
                  <button
                    onClick={() => void handleDataControl("clear_chat_history")}
                    className="w-full flex items-center justify-center gap-2 p-2.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-900/30 rounded-lg transition-colors text-sm font-medium"
                  >
                    Clear Chat History
                  </button>
                  <button
                    onClick={() => void handleDataControl("clear_logs")}
                    className="w-full flex items-center justify-center gap-2 p-2.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-900/30 rounded-lg transition-colors text-sm font-medium"
                  >
                    Clear Local Logs
                  </button>
                  <button
                    onClick={() => void handleDataControl("clear_local_data")}
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

          {activeTab === "models" && (
            <>
              {/* API KEY */}
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">
                  API Key
                </h3>
                <div className="space-y-1">
                  <label className="text-sm font-medium dark:text-warm-300">
                    OpenRouter API Key
                    <span className="text-xs text-warm-400 ml-2">(required)</span>
                  </label>
                  <input
                    type="password"
                    value={formState.openRouterApiKey}
                    onChange={(e) =>
                      handleChange("openRouterApiKey", e.target.value)
                    }
                    className="w-full px-3 py-2 text-sm border border-warm-300 dark:border-warm-700 rounded-md bg-warm-50 dark:bg-warm-900 focus:ring-2 focus:ring-primary-500 outline-none dark:text-warm-100"
                    placeholder="sk-or-..."
                  />
                </div>
              </section>

              {/* EXECUTOR MODEL */}
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">
                  Executor Model
                </h3>
                <p className="text-xs text-warm-400 dark:text-warm-500">
                  Fast model for tool execution and page interaction
                </p>
                <ModelSelector
                  value={formState.executorModel || ""}
                  onChange={(v) => handleChange("executorModel", v || undefined)}
                  defaultModel={MODEL_EXECUTOR}
                  models={models}
                  loading={modelsLoading}
                />
              </section>

              {/* PLANNER MODEL */}
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">
                  Planner Model
                </h3>
                <p className="text-xs text-warm-400 dark:text-warm-500">
                  Reasoning model for task decomposition and escalation
                </p>
                <ModelSelector
                  value={formState.plannerModel || ""}
                  onChange={(v) => handleChange("plannerModel", v || undefined)}
                  defaultModel={MODEL_PLANNER}
                  models={models}
                  loading={modelsLoading}
                />
              </section>

              {/* PERCEPTION MODEL */}
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">
                  Perception Model
                </h3>
                <p className="text-xs text-warm-400 dark:text-warm-500">
                  Vision model for interpreting page screenshots
                </p>
                <ModelSelector
                  value={formState.perceptionModel || ""}
                  onChange={(v) => handleChange("perceptionModel", v || undefined)}
                  defaultModel={PERCEPTION_MODEL_DEFAULT}
                  models={models}
                  loading={modelsLoading}
                  filterVisionOnly
                />
              </section>
            </>
          )}
        </div>

        <div className="p-4 border-t border-warm-200 dark:border-warm-800 bg-warm-100/50 dark:bg-warm-900/50">
          <button
            onClick={handleSave}
            disabled={!isDirty}
            className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 px-4 rounded-lg font-medium transition-colors shadow-sm"
          >
            <Save size={18} />
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
