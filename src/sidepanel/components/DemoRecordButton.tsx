import React, { useState, useCallback } from "react";
import { Circle, Square } from "lucide-react";
import { useStore } from "../store";
import { MessageSource } from "../../types";
import { clsx } from "clsx";
import { DemoSaveModal, DemoSaveData } from "./DemoSaveModal";

export function DemoRecordButton() {
  const demoRecording = useStore((s) => s.demoRecording);
  const demoActionCount = useStore((s) => s.demoActionCount);
  const isAgentRunning = useStore((s) => s.isAgentRunning);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [savedActionCount, setSavedActionCount] = useState(0);

  const startRecording = useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) return;
      chrome.runtime.sendMessage({
        type: "DEMO_RECORD_START",
        requestId: crypto.randomUUID(),
        source: MessageSource.SIDEPANEL,
        payload: { tabId: tab.id },
      });
    } catch {
      // ignore
    }
  }, []);

  const stopRecording = useCallback(() => {
    setSavedActionCount(demoActionCount);
    setShowSaveModal(true);
  }, [demoActionCount]);

  const handleSave = useCallback(async (data: DemoSaveData) => {
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) return;
      chrome.runtime.sendMessage({
        type: "DEMO_RECORD_STOP",
        requestId: crypto.randomUUID(),
        source: MessageSource.SIDEPANEL,
        payload: {
          tabId: tab.id,
          name: data.name,
          description: data.description,
          goal: data.goal,
          outcomeSignal: data.outcomeSignal,
          golden: true,
        },
      });
    } catch {
      // ignore
    }
    setShowSaveModal(false);
  }, []);

  const handleCancel = useCallback(() => {
    setShowSaveModal(false);
  }, []);

  // Don't show when agent is running
  if (isAgentRunning) return null;

  return (
    <>
      <button
        onClick={demoRecording ? stopRecording : startRecording}
        className={clsx(
          "p-1.5 mb-0.5 rounded-lg transition-colors flex-shrink-0",
          demoRecording
            ? "bg-red-500 text-white demo-recording"
            : "text-warm-400 hover:text-warm-600 dark:hover:text-warm-300",
        )}
        aria-label={demoRecording ? "Stop recording demo" : "Record demo"}
        title={
          demoRecording
            ? `Recording... ${demoActionCount} actions`
            : "Record a demonstration"
        }
      >
        {demoRecording ? (
          <span className="flex items-center gap-1">
            <Square size={14} />
            <span className="text-xs font-mono">{demoActionCount}</span>
          </span>
        ) : (
          <Circle size={16} />
        )}
      </button>
      {showSaveModal && (
        <DemoSaveModal
          actionCount={savedActionCount}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      )}
    </>
  );
}
