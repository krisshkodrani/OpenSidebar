import React from "react";
import { Download, Monitor, Moon, Sun } from "lucide-react";
import {
  DEFAULT_ENABLED_SKILL_PACK_IDS,
  type UserSettings,
} from "../../../types";
import {
  LANE_TOPOLOGY_OPTIONS,
  MAX_TURNS_PRESETS,
  SKILL_PACK_OPTIONS,
} from "./settings-options";
import type { DataControlAction, SettingsChangeHandler } from "./types";

export function GeneralSettingsTab({
  dataControlStatus,
  formState,
  notificationPermissionError,
  onBrowserNotificationToggle,
  onChange,
  onDataControl,
  onExportLogs,
  onSiteBlocklistTextChange,
  onSkillPackToggle,
  siteBlocklistText,
}: {
  dataControlStatus: string | null;
  formState: UserSettings;
  notificationPermissionError: string | null;
  onBrowserNotificationToggle: (checked: boolean) => void;
  onChange: SettingsChangeHandler;
  onDataControl: (action: DataControlAction) => void;
  onExportLogs: () => void;
  onSiteBlocklistTextChange: (text: string) => void;
  onSkillPackToggle: (packId: string, checked: boolean) => void;
  siteBlocklistText: string;
}) {
  return (
    <>
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-warm-400">
          Appearance
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {(["light", "dark", "system"] as const).map((theme) => (
            <button
              key={theme}
              onClick={() => onChange("theme", theme)}
              className={`flex flex-col items-center gap-2 rounded-lg border p-3 text-xs font-medium transition-all ${
                formState.theme === theme
                  ? "border-primary-500 bg-primary-50 text-primary-700 ring-1 ring-primary-500 dark:bg-primary-900/20 dark:text-primary-300"
                  : "border-warm-200 text-warm-600 hover:bg-warm-100 dark:border-warm-700 dark:text-warm-400 dark:hover:bg-warm-800"
              }`}
            >
              {theme === "light" ? <Sun size={18} /> : null}
              {theme === "dark" ? <Moon size={18} /> : null}
              {theme === "system" ? <Monitor size={18} /> : null}
              <span className="capitalize">{theme}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-warm-400">
          Agent
        </h3>

        <div className="flex items-center justify-between">
          <label className="text-sm font-medium dark:text-warm-300">
            Max Turns
          </label>
          <select
            value={formState.maxTurns}
            onChange={(event) =>
              onChange("maxTurns", parseInt(event.target.value, 10))
            }
            className="rounded border border-warm-300 bg-warm-50 px-2 py-1 text-sm outline-none dark:border-warm-700 dark:bg-warm-900 dark:text-warm-100"
          >
            {MAX_TURNS_PRESETS.map((value) => (
              <option key={value} value={value}>
                {value}
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
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-warm-100 p-1 dark:bg-warm-800">
            {LANE_TOPOLOGY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onChange("laneTopologyMode", option.value)}
                title={option.description}
                className={`min-h-8 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                  (formState.laneTopologyMode ?? "full") === option.value
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
                  option.value === (formState.laneTopologyMode ?? "full"),
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
                formState.enabledSkillPackIds ?? DEFAULT_ENABLED_SKILL_PACK_IDS;
              const checked = enabledIds.includes(pack.id);
              return (
                <label
                  key={pack.id}
                  className="flex items-start gap-3 rounded-md border border-warm-200 px-3 py-2 dark:border-warm-800"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) =>
                      onSkillPackToggle(pack.id, event.target.checked)
                    }
                    className="mt-0.5 h-4 w-4 rounded text-primary-600"
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
            onChange={(event) =>
              onChange("allowNavigation", event.target.checked)
            }
            className="h-4 w-4 rounded text-primary-600"
          />
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-warm-400">
          Integrations
        </h3>

        <ToggleRow
          checked={Boolean(formState.jobAgentMcpEnabled)}
          description="Use the local JobAgent MCP HTTP server for job application packages and form answers."
          label="JobAgent MCP"
          onChange={(checked) => onChange("jobAgentMcpEnabled", checked)}
        />

        {formState.jobAgentMcpEnabled ? (
          <div className="space-y-3 rounded-md border border-warm-200 p-3 dark:border-warm-800">
            <div className="space-y-1">
              <label className="text-sm font-medium dark:text-warm-300">
                MCP URL
              </label>
              <input
                type="url"
                value={formState.jobAgentMcpUrl ?? ""}
                onChange={(event) =>
                  onChange("jobAgentMcpUrl", event.target.value)
                }
                className="w-full rounded-md border border-warm-300 bg-warm-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:border-warm-700 dark:bg-warm-900 dark:text-warm-100"
                placeholder="http://127.0.0.1:3727/mcp"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium dark:text-warm-300">
                Bearer token
              </label>
              <input
                type="password"
                value={formState.jobAgentMcpToken ?? ""}
                onChange={(event) =>
                  onChange("jobAgentMcpToken", event.target.value)
                }
                className="w-full rounded-md border border-warm-300 bg-warm-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:border-warm-700 dark:bg-warm-900 dark:text-warm-100"
                placeholder="local-dev-token"
              />
            </div>
          </div>
        ) : null}
      </section>

      <section className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3 dark:border-amber-800 dark:bg-amber-900/10">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
          Safety
        </h3>

        <div className="space-y-1">
          <label className="text-sm font-medium dark:text-warm-300">
            Site Access Rules
          </label>
          <select
            value={formState.siteAccessMode ?? "allow_all"}
            onChange={(event) =>
              onChange(
                "siteAccessMode",
                event.target.value as UserSettings["siteAccessMode"],
              )
            }
            className="w-full rounded border border-warm-300 bg-warm-50 px-2 py-1.5 text-sm outline-none dark:border-warm-700 dark:bg-warm-900 dark:text-warm-100"
          >
            <option value="allow_all">Allow all sites</option>
            <option value="blocklist">Block listed domains</option>
          </select>
          {formState.siteAccessMode === "blocklist" ? (
            <>
              <p className="text-xs text-warm-500 dark:text-warm-500">
                One domain per line. Example: bank.com
              </p>
              <textarea
                value={siteBlocklistText}
                onChange={(event) =>
                  onSiteBlocklistTextChange(event.target.value)
                }
                rows={4}
                className="w-full rounded-md border border-warm-300 bg-warm-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:border-warm-700 dark:bg-warm-900 dark:text-warm-100"
                placeholder={"bank.com\npayments.example.com"}
              />
            </>
          ) : null}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-warm-400">
          Display
        </h3>

        <ToggleRow
          checked={formState.showSessionMetrics}
          description="Token usage, cost, and timing"
          label="Show session metrics"
          onChange={(checked) => onChange("showSessionMetrics", checked)}
        />
        <ToggleRow
          checked={Boolean(formState.showMessageDetailsByDefault)}
          description="Show steps and tool logs automatically"
          label="Expand tool details by default"
          onChange={(checked) =>
            onChange("showMessageDetailsByDefault", checked)
          }
        />
        <ToggleRow
          checked={Boolean(formState.enableBrowserNotifications)}
          description="Notify when an agent needs attention or finishes while you are away from the workspace."
          label="Browser notifications"
          onChange={onBrowserNotificationToggle}
        >
          {notificationPermissionError ? (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              {notificationPermissionError}
            </p>
          ) : null}
        </ToggleRow>
        <ToggleRow
          checked={Boolean(formState.showDebugScreenshots)}
          description="Developer-only screenshot toast when debug captures are emitted"
          label="Show debug screenshots"
          onChange={(checked) => onChange("showDebugScreenshots", checked)}
        />
      </section>

      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-warm-400">
          Data
        </h3>

        <div className="grid grid-cols-1 gap-2">
          <DangerButton
            label="Clear Chat History"
            onClick={() => {
              if (window.confirm("Clear all chat history? This cannot be undone.")) {
                onDataControl("clear_chat_history");
              }
            }}
          />
          <DangerButton
            label="Clear Local Logs"
            onClick={() => {
              if (window.confirm("Clear all local logs? This cannot be undone.")) {
                onDataControl("clear_logs");
              }
            }}
          />
          <button
            onClick={() => {
              if (
                window.confirm(
                  "Clear ALL local data? This includes chat history, logs, settings, and saved prompts. This cannot be undone.",
                )
              ) {
                onDataControl("clear_local_data");
              }
            }}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-300 p-2.5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100 dark:border-red-900/40 dark:hover:bg-red-900/30"
          >
            Clear All Local Data
          </button>
        </div>

        {dataControlStatus ? (
          <p className="text-xs text-warm-500 dark:text-warm-400">
            {dataControlStatus}
          </p>
        ) : null}

        <button
          onClick={onExportLogs}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-warm-200 p-2.5 text-sm font-medium text-warm-600 transition-colors hover:bg-warm-100 dark:border-warm-700 dark:text-warm-300 dark:hover:bg-warm-800"
        >
          <Download size={16} />
          Export Logs
        </button>
      </section>
    </>
  );
}

function ToggleRow({
  checked,
  children,
  description,
  label,
  onChange,
}: {
  checked: boolean;
  children?: React.ReactNode;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <label className="text-sm font-medium dark:text-warm-300">{label}</label>
        <p className="text-xs text-warm-400 dark:text-warm-500">
          {description}
        </p>
        {children}
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded text-primary-600"
      />
    </div>
  );
}

function DangerButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 p-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900/30 dark:hover:bg-red-900/20"
    >
      {label}
    </button>
  );
}
