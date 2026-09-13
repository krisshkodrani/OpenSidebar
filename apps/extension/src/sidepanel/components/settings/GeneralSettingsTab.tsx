import React from "react";
import { ChevronDown, Monitor, Moon, Sun } from "lucide-react";
import {
  DEFAULT_ENABLED_SKILL_PACK_IDS,
  type UserSettings,
} from "../../../types";
import {
  LANE_TOPOLOGY_OPTIONS,
  MAX_TURNS_PRESETS,
  PRESENCE_MODE_OPTIONS,
  SKILL_PACK_OPTIONS,
} from "./settings-options";
import type { SettingsChangeHandler } from "./types";
import { FleetTelemetrySettings } from "./FleetTelemetrySettings";

export function GeneralSettingsTab({
  formState,
  notificationPermissionError,
  onBrowserNotificationToggle,
  onChange,
  onSiteBlocklistTextChange,
  onSkillPackToggle,
  siteBlocklistText,
  surface = "all",
}: {
  formState: UserSettings;
  notificationPermissionError: string | null;
  onBrowserNotificationToggle: (checked: boolean) => void;
  onChange: SettingsChangeHandler;
  onSiteBlocklistTextChange: (text: string) => void;
  onSkillPackToggle: (packId: string, checked: boolean) => void;
  siteBlocklistText: string;
  surface?: "all" | "agent" | "browser";
}) {
  const maxTurnsId = React.useId();
  const siteAccessId = React.useId();

  return (
    <>
      {surface !== "browser" ? (
        <>
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-warm-400">
              Appearance
            </h3>
            <div
              className="grid grid-cols-3 gap-2"
              role="group"
              aria-label="Theme"
            >
              {(["light", "dark", "system"] as const).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  aria-pressed={formState.theme === theme}
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
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-warm-400">
                Agent
              </h3>
              <p className="mt-1 text-xs text-warm-500 dark:text-warm-400">
                Choose how much planning and verification the agent uses.
              </p>
            </div>
            <div
              className="grid grid-cols-3 gap-1 rounded-lg bg-warm-100 p-1 dark:bg-warm-800"
              role="group"
              aria-label="Execution mode"
            >
              {LANE_TOPOLOGY_OPTIONS.map((option) => {
                const selected =
                  (formState.laneTopologyMode ?? "full") === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onChange("laneTopologyMode", option.value)}
                    title={option.description}
                    className={`min-h-8 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                      selected
                        ? "bg-warm-50 text-primary-700 shadow-sm dark:bg-warm-900 dark:text-primary-300"
                        : "text-warm-500 hover:text-warm-700 dark:text-warm-400 dark:hover:text-warm-200"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-warm-400 dark:text-warm-500">
              {
                LANE_TOPOLOGY_OPTIONS.find(
                  (option) =>
                    option.value === (formState.laneTopologyMode ?? "full"),
                )?.description
              }
            </p>
          </section>
        </>
      ) : null}

      {surface !== "agent" ? (
        <>
          <section className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3 dark:border-amber-800 dark:bg-amber-900/10">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
              Safety
            </h3>
            <div className="space-y-1">
              <label
                htmlFor={siteAccessId}
                className="text-sm font-medium dark:text-warm-300"
              >
                Site access rules
              </label>
              <select
                id={siteAccessId}
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
                    aria-label="Blocked domains"
                    className="w-full rounded-md border border-warm-300 bg-warm-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary-500 dark:border-warm-700 dark:bg-warm-900 dark:text-warm-100"
                    placeholder={"bank.com\npayments.example.com"}
                  />
                </>
              ) : null}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-warm-400">
              Notifications
            </h3>
            <ToggleRow
              checked={Boolean(formState.enableBrowserNotifications)}
              description="Notify when a run needs attention or finishes while you are away."
              label="Browser notifications"
              onChange={onBrowserNotificationToggle}
            >
              {notificationPermissionError ? (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {notificationPermissionError}
                </p>
              ) : null}
            </ToggleRow>
          </section>
        </>
      ) : null}

      {surface !== "browser" ? (
        <details className="group overflow-hidden rounded-lg border border-warm-200 bg-warm-50/50 dark:border-warm-800 dark:bg-warm-900/30">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-medium text-warm-700 hover:bg-warm-100 dark:text-warm-200 dark:hover:bg-warm-800/60 [&::-webkit-details-marker]:hidden">
            <ChevronDown
              size={14}
              className="transition-transform group-open:rotate-180"
            />
            Advanced settings
            <span className="ml-auto text-[11px] font-normal text-warm-400">
              Tuning and diagnostics
            </span>
          </summary>

          <div className="space-y-5 border-t border-warm-200 p-3 dark:border-warm-800">
            <section className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-warm-400">
                Runtime
              </h4>
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor={maxTurnsId}
                  className="text-sm font-medium dark:text-warm-300"
                >
                  Max turns
                </label>
                <select
                  id={maxTurnsId}
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
              <ToggleRow
                checked={formState.allowNavigation}
                description="Let the agent open or switch to new pages."
                label="Allow navigation"
                onChange={(checked) => onChange("allowNavigation", checked)}
              />
            </section>

            <PresenceSettings formState={formState} onChange={onChange} />

            <section className="space-y-2">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-warm-400">
                  Skill packs
                </h4>
                <p className="mt-1 text-xs text-warm-400 dark:text-warm-500">
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
            </section>

            <section className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-warm-400">
                Diagnostics
              </h4>
              <ToggleRow
                checked={formState.showSessionMetrics}
                description="Show token usage, cost, and timing."
                label="Session metrics"
                onChange={(checked) => onChange("showSessionMetrics", checked)}
              />
              <ToggleRow
                checked={Boolean(formState.showMessageDetailsByDefault)}
                description="Show steps and tool logs automatically."
                label="Expand tool details"
                onChange={(checked) =>
                  onChange("showMessageDetailsByDefault", checked)
                }
              />
              <FleetTelemetrySettings />
            </section>
          </div>
        </details>
      ) : null}
    </>
  );
}

function PresenceSettings({
  formState,
  onChange,
}: {
  formState: UserSettings;
  onChange: SettingsChangeHandler;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-warm-400">
          Presence cursor
        </h4>
        <p className="mt-1 text-xs text-warm-400 dark:text-warm-500">
          Show a cursor on the page while the agent clicks and types.
        </p>
      </div>
      <div
        className="grid grid-cols-3 gap-1 rounded-lg bg-warm-100 p-1 dark:bg-warm-800"
        role="group"
        aria-label="Presence cursor"
      >
        {PRESENCE_MODE_OPTIONS.map((option) => {
          const selected =
            (formState.presenceMode ?? "subtle") === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange("presenceMode", option.value)}
              title={option.description}
              className={`min-h-8 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                selected
                  ? "bg-warm-50 text-primary-700 shadow-sm dark:bg-warm-900 dark:text-primary-300"
                  : "text-warm-500 hover:text-warm-700 dark:text-warm-400 dark:hover:text-warm-200"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {(formState.presenceMode ?? "subtle") !== "off" ? (
        <ToggleRow
          checked={formState.presenceHideDuringCapture !== false}
          description="Prevent the cursor from appearing in the agent's screenshots."
          label="Hide cursor during capture"
          onChange={(checked) => onChange("presenceHideDuringCapture", checked)}
        />
      ) : null}
    </section>
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
  const id = React.useId();

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium dark:text-warm-300">
          {label}
        </label>
        <p className="text-xs text-warm-400 dark:text-warm-500">
          {description}
        </p>
        {children}
      </div>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 shrink-0 rounded text-primary-600"
      />
    </div>
  );
}
