import React, { useEffect, useRef, useState } from "react";
import { X, Save, Moon, Sun, Monitor, Trash2, Download } from "lucide-react";
import { useStore } from "../store";
import { UserSettings } from "../../types";
import { storageLogger } from "../../utils/storage-logger";

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function SettingsDrawer({ isOpen, onClose }: Props) {
    const settings = useStore(s => s.settings);
    const updateSettings = useStore(s => s.updateSettings);
    const clearHistory = useStore(s => s.clearHistory);

    const [formState, setFormState] = useState<UserSettings>(settings);
    const [isDirty, setIsDirty] = useState(false);

    const drawerRef = useRef<HTMLDivElement>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);

    // Sync form state when settings change externally or drawer opens
    useEffect(() => {
        setFormState(settings);
        setIsDirty(false);
    }, [settings, isOpen]);

    // Focus trap + Escape key
    useEffect(() => {
        if (!isOpen) return;

        // Focus close button on open
        closeButtonRef.current?.focus();

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                onClose();
                return;
            }

            if (e.key === "Tab" && drawerRef.current) {
                const focusable = drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
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
        setFormState(prev => {
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
        updateSettings(formState);
        // Persist to sync storage
        chrome.storage.sync.set({ userSettings: formState });
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div
            className="absolute inset-0 z-50 flex justify-end"
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
        >
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/20 backdrop-blur-sm backdrop-enter"
                onClick={onClose}
            />

            {/* Drawer */}
            <div
                ref={drawerRef}
                className="relative w-full max-w-[320px] h-full bg-warm-50 dark:bg-warm-900 shadow-2xl flex flex-col border-l border-warm-200 dark:border-warm-800 drawer-enter"
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

                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                    {/* API Keys */}
                    <section className="space-y-3">
                        <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">API Configuration</h3>

                        <div className="space-y-1">
                            <label className="text-sm font-medium dark:text-warm-300">OpenRouter API Key</label>
                            <input
                                type="password"
                                value={formState.openRouterApiKey}
                                onChange={e => handleChange("openRouterApiKey", e.target.value)}
                                className="w-full px-3 py-2 text-sm border border-warm-300 dark:border-warm-700 rounded-md bg-warm-50 dark:bg-warm-900 focus:ring-2 focus:ring-primary-500 outline-none dark:text-warm-100"
                                placeholder="sk-or-..."
                            />
                        </div>
                    </section>

                    {/* Agent Behavior */}
                    <section className="space-y-3">
                        <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">Agent Behavior</h3>

                        <div className="space-y-1">
                            <div className="flex justify-between">
                                <label className="text-sm font-medium dark:text-warm-300">Max Turns</label>
                                <span className="text-xs text-warm-500 dark:text-warm-400">{formState.maxTurns}</span>
                            </div>
                            <input
                                type="range"
                                min="1"
                                max="500"
                                value={formState.maxTurns}
                                onChange={e => handleChange("maxTurns", parseInt(e.target.value))}
                                className="w-full h-2 bg-warm-200 rounded-lg appearance-none cursor-pointer dark:bg-warm-700"
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium dark:text-warm-300">Context Window</label>
                            <select
                                value={formState.contextWindowSize}
                                onChange={e => handleChange("contextWindowSize", parseInt(e.target.value))}
                                className="text-sm border border-warm-300 dark:border-warm-700 rounded px-2 py-1 bg-warm-50 dark:bg-warm-900 dark:text-warm-100 outline-none"
                            >
                                <option value={8000}>8k</option>
                                <option value={32000}>32k</option>
                                <option value={128000}>128k</option>
                            </select>
                        </div>

                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium dark:text-warm-300">Enable Memory</label>
                            <input
                                type="checkbox"
                                checked={formState.memoryEnabled}
                                onChange={e => handleChange("memoryEnabled", e.target.checked)}
                                className="w-4 h-4 text-primary-600 rounded bg-warm-100 border-warm-300 focus:ring-primary-500 dark:focus:ring-primary-600 dark:ring-offset-warm-800 focus:ring-2 dark:bg-warm-700 dark:border-warm-600"
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <label className="text-sm font-medium dark:text-warm-300">Enable Workspaces</label>
                            <input
                                type="checkbox"
                                checked={formState.workspaceEnabled}
                                onChange={e => handleChange("workspaceEnabled", e.target.checked)}
                                className="w-4 h-4 text-primary-600 rounded bg-warm-100 border-warm-300 focus:ring-primary-500 dark:focus:ring-primary-600 dark:ring-offset-warm-800 focus:ring-2 dark:bg-warm-700 dark:border-warm-600"
                            />
                        </div>

                        <div className="flex items-center justify-between">
                            <div>
                                <label className="text-sm font-medium dark:text-warm-300">Confirm Plan</label>
                                <p className="text-xs text-warm-400 dark:text-warm-500">Show action plan and wait for approval before executing</p>
                            </div>
                            <input
                                type="checkbox"
                                checked={formState.confirmPlan}
                                onChange={e => handleChange("confirmPlan", e.target.checked)}
                                className="w-4 h-4 text-primary-600 rounded bg-warm-100 border-warm-300 focus:ring-primary-500 dark:focus:ring-primary-600 dark:ring-offset-warm-800 focus:ring-2 dark:bg-warm-700 dark:border-warm-600"
                            />
                        </div>
                    </section>

                    {/* Usage & Cost */}
                    <section className="space-y-3">
                        <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">Usage & Cost</h3>

                        <div className="flex items-center justify-between">
                            <div>
                                <label className="text-sm font-medium dark:text-warm-300">Show Session Metrics</label>
                                <p className="text-xs text-warm-400 dark:text-warm-500">Token usage, cost, and timing during agent runs</p>
                            </div>
                            <input
                                type="checkbox"
                                checked={formState.showSessionMetrics}
                                onChange={e => handleChange("showSessionMetrics", e.target.checked)}
                                className="w-4 h-4 text-primary-600 rounded bg-warm-100 border-warm-300 focus:ring-primary-500 dark:focus:ring-primary-600 dark:ring-offset-warm-800 focus:ring-2 dark:bg-warm-700 dark:border-warm-600"
                            />
                        </div>
                    </section>

                    {/* Appearance */}
                    <section className="space-y-3">
                        <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">Appearance</h3>

                        <div className="grid grid-cols-3 gap-2">
                            {(["light", "dark", "system"] as const).map(theme => (
                                <button
                                    key={theme}
                                    onClick={() => handleChange("theme", theme)}
                                    className={`flex flex-col items-center gap-2 p-3 rounded-lg border text-xs font-medium transition-all
                                        ${formState.theme === theme
                                            ? "border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 ring-1 ring-primary-500"
                                            : "border-warm-200 dark:border-warm-700 hover:bg-warm-100 dark:hover:bg-warm-800 text-warm-600 dark:text-warm-400"
                                        }
                                    `}
                                >
                                    {theme === "light" && <Sun size={18} />}
                                    {theme === "dark" && <Moon size={18} />}
                                    {theme === "system" && <Monitor size={18} />}
                                    <span className="capitalize">{theme}</span>
                                </button>
                            ))}
                        </div>
                    </section>

                    {/* Visual Debugging */}
                    <section className="space-y-3">
                        <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">Visual Debugging</h3>

                        <div className="flex items-center justify-between">
                            <div>
                                <label className="text-sm font-medium dark:text-warm-300">Show Element Tags</label>
                                <p className="text-xs text-warm-400 dark:text-warm-500">Display [N] labels on interactive page elements</p>
                            </div>
                            <input
                                type="checkbox"
                                checked={formState.showElementTags}
                                onChange={e => handleChange("showElementTags", e.target.checked)}
                                className="w-4 h-4 text-primary-600 rounded bg-warm-100 border-warm-300 focus:ring-primary-500 dark:focus:ring-primary-600 dark:ring-offset-warm-800 focus:ring-2 dark:bg-warm-700 dark:border-warm-600"
                            />
                        </div>
                    </section>

                    {/* History */}
                    <section className="space-y-3 pt-4 border-t border-warm-200 dark:border-warm-800">
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
                    </section>

                    {/* Export */}
                    <section className="space-y-3">
                        <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider">Export</h3>
                        <button
                            onClick={handleExportLogs}
                            className="w-full flex items-center justify-center gap-2 p-2.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 border border-blue-200 dark:border-blue-900/30 rounded-lg transition-colors text-sm font-medium"
                        >
                            <Download size={16} />
                            Export Logs
                        </button>
                    </section>

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
