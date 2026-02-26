import React, { useEffect, useRef, useState } from "react";
import { X, Save, Moon, Sun, Monitor, Trash2, Download } from "lucide-react";
import { useStore } from "../store";
import { UserSettings } from "../../types";
import { storageLogger } from "../../utils/storage-logger";
import { LearnedSkillsPanel } from "./LearnedSkillsPanel";
import { DemoLibrary } from "./DemoLibrary";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

type SettingsTab = "basic" | "advanced";

export function SettingsDrawer({ isOpen, onClose }: Props) {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const clearHistory = useStore((s) => s.clearHistory);

  const [formState, setFormState] = useState<UserSettings>(settings);
  const [isDirty, setIsDirty] = useState(false);
  const [tab, setTab] = useState<SettingsTab>("basic");
  const [siteBlocklistText, setSiteBlocklistText] = useState("");
  const [dataControlStatus, setDataControlStatus] = useState<string | null>(
    null,
  );

  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setFormState(settings);
    setIsDirty(false);
    setTab("basic");
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
    chrome.storage.sync.set({ userSettings: nextState });
    onClose();
  };

  const handleDataControl = async (
    action:
      | "clear_memory"
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

        <div className="px-4 pt-3">
          <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-warm-100 dark:bg-warm-800/70">
            <button
              onClick={() => setTab("basic")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                tab === "basic"
                  ? "bg-primary-600 text-white"
                  : "text-warm-600 dark:text-warm-300 hover:bg-warm-200 dark:hover:bg-warm-700"
              }`}
            >
              Basic
            </button>
            <button
              onClick={() => setTab("advanced")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                tab === "advanced"
                  ? "bg-primary-600 text-white"
                  : "text-warm-600 dark:text-warm-300 hover:bg-warm-200 dark:hover:bg-warm-700"
              }`}
            >
              Advanced
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {tab === "basic" && (
            <>
              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">
                  API Configuration
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

                <div className="space-y-1">
                  <label className="text-sm font-medium dark:text-warm-300">
                    Groq API Key
                  </label>
                  <input
                    type="password"
                    value={formState.groqApiKey}
                    onChange={(e) => handleChange("groqApiKey", e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-warm-300 dark:border-warm-700 rounded-md bg-warm-50 dark:bg-warm-900 focus:ring-2 focus:ring-primary-500 outline-none dark:text-warm-100"
                    placeholder="gsk_..."
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium dark:text-warm-300">
                    Cerebras API Key
                  </label>
                  <input
                    type="password"
                    value={formState.cerebrasApiKey}
                    onChange={(e) => handleChange("cerebrasApiKey", e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-warm-300 dark:border-warm-700 rounded-md bg-warm-50 dark:bg-warm-900 focus:ring-2 focus:ring-primary-500 outline-none dark:text-warm-100"
                    placeholder="csk-..."
                  />
                </div>
              </section>

              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">
                  Agent Defaults
                </h3>

                <div className="space-y-1">
                  <div className="flex justify-between">
                    <label className="text-sm font-medium dark:text-warm-300">
                      Max Turns
                    </label>
                    <span className="text-xs text-warm-500 dark:text-warm-400">
                      {formState.maxTurns}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="500"
                    value={formState.maxTurns}
                    onChange={(e) =>
                      handleChange("maxTurns", parseInt(e.target.value, 10))
                    }
                    className="w-full h-2 bg-warm-200 rounded-lg appearance-none cursor-pointer dark:bg-warm-700"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium dark:text-warm-300">
                    Context Window
                  </label>
                  <select
                    value={formState.contextWindowSize}
                    onChange={(e) =>
                      handleChange("contextWindowSize", parseInt(e.target.value, 10))
                    }
                    className="text-sm border border-warm-300 dark:border-warm-700 rounded px-2 py-1 bg-warm-50 dark:bg-warm-900 dark:text-warm-100 outline-none"
                  >
                    <option value={8000}>8k</option>
                    <option value={32000}>32k</option>
                    <option value={128000}>128k</option>
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium dark:text-warm-300">
                    Enable Memory
                  </label>
                  <input
                    type="checkbox"
                    checked={formState.memoryEnabled}
                    onChange={(e) => handleChange("memoryEnabled", e.target.checked)}
                    className="w-4 h-4 text-primary-600 rounded"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium dark:text-warm-300">
                    Enable Workspaces
                  </label>
                  <input
                    type="checkbox"
                    checked={formState.workspaceEnabled}
                    onChange={(e) => handleChange("workspaceEnabled", e.target.checked)}
                    className="w-4 h-4 text-primary-600 rounded"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium dark:text-warm-300">
                      Show Session Metrics
                    </label>
                    <p className="text-xs text-warm-400 dark:text-warm-500">
                      Show token usage, cost, and timing
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={formState.showSessionMetrics}
                    onChange={(e) => handleChange("showSessionMetrics", e.target.checked)}
                    className="w-4 h-4 text-primary-600 rounded"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium dark:text-warm-300">
                      Show Message Details by Default
                    </label>
                    <p className="text-xs text-warm-400 dark:text-warm-500">
                      Expand steps and tool logs automatically
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(formState.showMessageDetailsByDefault)}
                    onChange={(e) =>
                      handleChange("showMessageDetailsByDefault", e.target.checked)
                    }
                    className="w-4 h-4 text-primary-600 rounded"
                  />
                </div>
              </section>

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
            </>
          )}

          {tab === "advanced" && (
            <>
              <section className="space-y-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-900/10 p-3">
                <h3 className="text-xs font-semibold uppercase text-amber-700 dark:text-amber-300 tracking-wider">
                  Safety
                </h3>

                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium dark:text-warm-300">
                      Require approvals for high-risk actions
                    </label>
                    <p className="text-xs text-warm-500 dark:text-warm-500">
                      Recommended for payments, navigation changes, and external actions
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={!formState.bypassApprovals}
                    onChange={(e) => handleChange("bypassApprovals", !e.target.checked)}
                    className="w-4 h-4 text-primary-600 rounded"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium dark:text-warm-300">
                      Disable Screenshot Tool
                    </label>
                    <p className="text-xs text-warm-400 dark:text-warm-500">
                      Saves cost and latency, but lowers visual reliability
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={formState.disableScreenshot}
                    onChange={(e) => handleChange("disableScreenshot", e.target.checked)}
                    className="w-4 h-4 text-primary-600 rounded"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium dark:text-warm-300">
                      Disable Navigation Tool
                    </label>
                    <p className="text-xs text-warm-400 dark:text-warm-500">
                      Prevents agent from opening or switching to new pages
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={formState.disableNavigation}
                    onChange={(e) => handleChange("disableNavigation", e.target.checked)}
                    className="w-4 h-4 text-primary-600 rounded"
                  />
                </div>

                <div className="space-y-1 pt-2 border-t border-amber-200/70 dark:border-amber-800/70">
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
                      Block listed domains (recommended for risky sites)
                    </option>
                  </select>
                  {formState.siteAccessMode === "blocklist" && (
                    <>
                      <p className="text-xs text-warm-500 dark:text-warm-500">
                        One domain per line. Example: `bank.com`
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

              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">
                  Orchestrator & Skills
                </h3>

                <div className="space-y-1">
                  <label className="text-sm font-medium dark:text-warm-300">
                    Orchestrator Token Budget
                  </label>
                  <input
                    type="number"
                    min={50000}
                    step={50000}
                    value={formState.orchestratorMaxTotalTokens ?? 1000000}
                    onChange={(e) => {
                      const parsed = Number.parseInt(e.target.value, 10);
                      handleChange(
                        "orchestratorMaxTotalTokens",
                        Number.isFinite(parsed) && parsed > 0 ? parsed : 1000000,
                      );
                    }}
                    className="w-full px-3 py-2 text-sm border border-warm-300 dark:border-warm-700 rounded-md bg-warm-50 dark:bg-warm-900 focus:ring-2 focus:ring-primary-500 outline-none dark:text-warm-100"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium dark:text-warm-300">
                    Teach Mode
                  </label>
                  <input
                    type="checkbox"
                    checked={Boolean(formState.teachModeEnabled)}
                    onChange={(e) => handleChange("teachModeEnabled", e.target.checked)}
                    className="w-4 h-4 text-primary-600 rounded"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium dark:text-warm-300">
                    Auto Skill Replay
                  </label>
                  <input
                    type="checkbox"
                    checked={Boolean(formState.autoSkillReplayEnabled)}
                    onChange={(e) =>
                      handleChange("autoSkillReplayEnabled", e.target.checked)
                    }
                    className="w-4 h-4 text-primary-600 rounded"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium dark:text-warm-300">
                    Skill Replay Dry-Run
                  </label>
                  <input
                    type="checkbox"
                    checked={Boolean(formState.skillReplayDryRun)}
                    onChange={(e) => handleChange("skillReplayDryRun", e.target.checked)}
                    className="w-4 h-4 text-primary-600 rounded"
                  />
                </div>
              </section>

              <LearnedSkillsPanel
                replayPinnedOnly={Boolean(formState.skillReplayPinnedOnly)}
                onReplayPinnedOnlyChange={(value) =>
                  handleChange("skillReplayPinnedOnly", value)
                }
              />

              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">
                  Demonstrations
                </h3>

                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium dark:text-warm-300">
                    Auto-inject Demos
                  </label>
                  <input
                    type="checkbox"
                    checked={formState.demosAutoInject !== false}
                    onChange={(e) =>
                      handleChange("demosAutoInject", e.target.checked)
                    }
                    className="w-4 h-4 text-primary-600 rounded"
                  />
                </div>

                <DemoLibrary />
              </section>

              <section className="space-y-3">
                <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">
                  Debugging & Data
                </h3>

                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium dark:text-warm-300">
                      Show Element Tags
                    </label>
                    <p className="text-xs text-warm-400 dark:text-warm-500">
                      Display [N] labels on interactive page elements
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={formState.showElementTags}
                    onChange={(e) => handleChange("showElementTags", e.target.checked)}
                    className="w-4 h-4 text-primary-600 rounded"
                  />
                </div>

                <button
                  onClick={() => {
                    if (confirm("Are you sure you want to clear all chat history?")) {
                      clearHistory();
                    }
                  }}
                  className="w-full flex items-center justify-center gap-2 p-2.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-900/30 rounded-lg transition-colors text-sm font-medium"
                >
                  <Trash2 size={16} />
                  Clear History
                </button>

                <div className="grid grid-cols-1 gap-2">
                  <button
                    onClick={() => void handleDataControl("clear_chat_history")}
                    className="w-full flex items-center justify-center gap-2 p-2.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-900/30 rounded-lg transition-colors text-sm font-medium"
                  >
                    Clear Chat History (All)
                  </button>
                  <button
                    onClick={() => void handleDataControl("clear_memory")}
                    className="w-full flex items-center justify-center gap-2 p-2.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-900/30 rounded-lg transition-colors text-sm font-medium"
                  >
                    Clear Long-Term Memory
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
                    Clear All Local Extension Data
                  </button>
                </div>

                {dataControlStatus && (
                  <p className="text-xs text-warm-500 dark:text-warm-400">
                    {dataControlStatus}
                  </p>
                )}

                <button
                  onClick={handleExportLogs}
                  className="w-full flex items-center justify-center gap-2 p-2.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-blue-200 dark:border-blue-900/30 rounded-lg transition-colors text-sm font-medium"
                >
                  <Download size={16} />
                  Export Logs
                </button>
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

