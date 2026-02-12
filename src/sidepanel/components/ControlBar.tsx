import React, { useCallback } from "react";
import { useStore } from "../store";
import { AgentStatus, MessageSource } from "../../types";
import { Loader2, Pause, Play } from "lucide-react";
import { logger } from "../../utils";

export function ControlBar() {
  const status = useStore((s) => s.agentStatus);
  const detail = useStore((s) => s.statusDetail);
  const turnProgress = useStore((s) => s.turnProgress);

  const handlePause = useCallback(async () => {
    try {
      await chrome.runtime.sendMessage({
        type: "PAUSE_AGENT",
        requestId: crypto.randomUUID(),
        source: MessageSource.SIDEPANEL,
        payload: {},
      });
    } catch (e) {
      logger.error("ui", "Failed to pause agent", { error: e });
    }
  }, []);

  const handleResume = useCallback(async () => {
    try {
      await chrome.runtime.sendMessage({
        type: "RESUME_AGENT",
        requestId: crypto.randomUUID(),
        source: MessageSource.SIDEPANEL,
        payload: {},
      });
    } catch (e) {
      logger.error("ui", "Failed to resume agent", { error: e });
    }
  }, []);

  if (status === AgentStatus.IDLE) return null;

  const isError = status === AgentStatus.ERROR;
  const isPaused = status === AgentStatus.PAUSED;
  const isActive = !isError && !isPaused;

  return (
    <div className="px-4 py-1.5 bg-primary-50 dark:bg-primary-900/20 border-t border-primary-100 dark:border-primary-900/50 flex items-center gap-2 text-xs">
      {isError ? (
        <div className="w-2 h-2 bg-red-500 rounded-full shrink-0" />
      ) : isPaused ? (
        <div className="w-2 h-2 bg-yellow-500 rounded-full shrink-0" />
      ) : (
        <Loader2
          size={12}
          className="text-primary-600 animate-spin shrink-0"
        />
      )}
      <span className="text-primary-700 dark:text-primary-300 truncate flex-1">
        {isPaused ? "Paused" : detail}
      </span>

      {turnProgress && (
        <span className="text-gray-400 dark:text-gray-500 tabular-nums shrink-0">
          {turnProgress.turn}/{turnProgress.maxTurns}
        </span>
      )}

      {isActive && (
        <button
          onClick={handlePause}
          className="p-0.5 rounded hover:bg-primary-100 dark:hover:bg-primary-800 text-primary-600 dark:text-primary-400"
          aria-label="Pause agent"
        >
          <Pause size={12} />
        </button>
      )}
      {isPaused && (
        <button
          onClick={handleResume}
          className="p-0.5 rounded hover:bg-primary-100 dark:hover:bg-primary-800 text-primary-600 dark:text-primary-400"
          aria-label="Resume agent"
        >
          <Play size={12} />
        </button>
      )}
    </div>
  );
}
