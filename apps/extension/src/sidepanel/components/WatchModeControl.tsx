import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Eye, Monitor, Square } from "lucide-react";
import { clsx } from "clsx";
import type { PassiveInputSource } from "../../types";
import { uiRuntime } from "../runtime";
import { useStore } from "../store";

const ACTIVE_STATUSES = new Set(["watching", "paused", "blocked", "error"]);

export function WatchModeControl({ disabled }: { disabled?: boolean }) {
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const passiveStatus = useStore((s) => s.passiveStatus);
  const passiveStatusDetail = useStore((s) => s.passiveStatusDetail);
  const passiveInstructions = useStore((s) => s.passiveInstructions);
  const passiveInputSources = useStore((s) => s.passiveInputSources);
  const setPassiveInstructions = useStore((s) => s.setPassiveInstructions);
  const setPassiveInputSources = useStore((s) => s.setPassiveInputSources);
  const setPassiveMonitorStatus = useStore((s) => s.setPassiveMonitorStatus);
  const setError = useStore((s) => s.setError);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(passiveInstructions);
  const [screenEnabled, setScreenEnabled] = useState(
    passiveInputSources.includes("screenshot"),
  );
  const [pending, setPending] = useState(false);

  const active = passiveStatus != null && ACTIVE_STATUSES.has(passiveStatus);

  useEffect(() => {
    setDraft(passiveInstructions);
  }, [passiveInstructions]);

  useEffect(() => {
    setScreenEnabled(passiveInputSources.includes("screenshot"));
  }, [passiveInputSources]);

  const inputSources = useMemo<PassiveInputSource[]>(
    () => (screenEnabled ? ["page", "screenshot"] : ["page"]),
    [screenEnabled],
  );

  const stop = useCallback(async () => {
    setPending(true);
    try {
      await uiRuntime.sendMessage({
        type: "PASSIVE_MONITOR_STOP",
        requestId: crypto.randomUUID(),
        source: uiRuntime.source,
        workspaceId: activeWorkspaceId,
        payload: { workspaceId: activeWorkspaceId },
      });
      setPassiveMonitorStatus("stopped", "Watch mode stopped.");
    } catch (error: any) {
      setError(error?.message ?? "Failed to stop Watch Mode.");
    } finally {
      setPending(false);
    }
  }, [activeWorkspaceId, setError, setPassiveMonitorStatus]);

  const start = useCallback(async () => {
    const instructions = draft.trim();
    if (!instructions) {
      setError("Add Watch Mode instructions first.");
      return;
    }
    if (disabled) return;
    setPending(true);
    try {
      const tab = await uiRuntime.getActiveTab();
      if (!tab?.id) {
        setError("No active page found for Watch Mode.");
        return;
      }
      setPassiveInstructions(instructions);
      setPassiveInputSources(inputSources);
      const response = await uiRuntime.sendMessage<{
        ok?: boolean;
        sessionId?: string;
        detail?: string;
      }>({
        type: "PASSIVE_MONITOR_START",
        requestId: crypto.randomUUID(),
        source: uiRuntime.source,
        workspaceId: activeWorkspaceId,
        payload: {
          tabId: tab.id,
          workspaceId: activeWorkspaceId,
          instructions,
          inputSources,
          minIntervalMs: 4_000,
          maxSuggestionsPerMinute: 6,
        },
      });
      if (response?.ok === false) {
        setError(response.detail || "Failed to start Watch Mode.");
        return;
      }
      setPassiveMonitorStatus(
        "watching",
        "Watching page changes.",
        null,
        response?.sessionId ?? null,
      );
      setExpanded(false);
    } catch (error: any) {
      setError(error?.message ?? "Failed to start Watch Mode.");
    } finally {
      setPending(false);
    }
  }, [
    activeWorkspaceId,
    disabled,
    draft,
    inputSources,
    setError,
    setPassiveInputSources,
    setPassiveInstructions,
    setPassiveMonitorStatus,
  ]);

  return (
    <div
      className={clsx(
        "mb-2 rounded-lg border px-2 py-1.5 text-xs transition",
        active
          ? "border-sky-200 bg-sky-50/80 text-sky-900 shadow-[0_0_18px_rgba(125,211,252,0.18)] dark:border-sky-800/60 dark:bg-sky-950/20 dark:text-sky-100"
          : "border-warm-200 bg-warm-100/60 text-warm-600 dark:border-warm-800 dark:bg-warm-800/45 dark:text-warm-300",
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 font-medium hover:bg-white/60 dark:hover:bg-warm-700/60"
          aria-expanded={expanded}
        >
          <Eye size={14} />
          <span>Watch</span>
          <ChevronDown
            size={13}
            className={clsx("transition-transform", expanded && "rotate-180")}
          />
        </button>
        <span
          className={clsx(
            "h-1.5 w-1.5 rounded-full",
            passiveStatus === "watching"
              ? "bg-sky-500"
              : passiveStatus === "paused"
                ? "bg-amber-500"
                : passiveStatus === "blocked" || passiveStatus === "error"
                  ? "bg-red-500"
                  : "bg-warm-400",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[11px]">
          {passiveStatusDetail || (active ? "Watching page changes." : "Ready")}
        </span>
        {active ? (
          <button
            type="button"
            onClick={stop}
            disabled={pending}
            title="Stop Watch Mode"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-sky-700 hover:bg-white/70 disabled:opacity-50 dark:text-sky-200 dark:hover:bg-sky-900/30"
            aria-label="Stop Watch Mode"
          >
            <Square size={13} />
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="mt-2 grid gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            className="min-h-[52px] resize-none rounded-md border border-warm-200 bg-white px-2 py-1.5 text-xs text-warm-800 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-300 dark:border-warm-700 dark:bg-warm-900 dark:text-warm-100"
            placeholder="When something changes, write the useful answer or note here."
          />
          <div className="flex items-center gap-2">
            <label className="inline-flex h-7 items-center gap-1.5 rounded-md border border-warm-200 bg-white px-2 text-[11px] text-warm-600 dark:border-warm-700 dark:bg-warm-900 dark:text-warm-300">
              <input
                type="checkbox"
                checked={screenEnabled}
                onChange={(event) => setScreenEnabled(event.target.checked)}
                className="h-3 w-3"
              />
              <Monitor size={12} />
              <span>Screen</span>
            </label>
            <button
              type="button"
              onClick={active ? stop : start}
              disabled={pending || (!active && disabled)}
              className={clsx(
                "ml-auto inline-flex h-7 items-center justify-center rounded-md px-2 text-[11px] font-medium disabled:opacity-50",
                active
                  ? "bg-warm-200 text-warm-700 hover:bg-warm-300 dark:bg-warm-700 dark:text-warm-100"
                  : "bg-sky-600 text-white hover:bg-sky-700",
              )}
            >
              {active ? "Stop" : pending ? "Starting" : "Start"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
