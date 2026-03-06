import React, { useRef, useEffect, useCallback, useState } from "react";
import { StopCircle, ArrowUp, Play, ShieldAlert, Settings, ShieldCheck, ChevronDown, Check } from "lucide-react";
import { useStore } from "../store";
import { StatusLine } from "./StatusLine";
import { ApprovalOverlay } from "./ApprovalOverlay";
import { EscalationOverlay } from "./EscalationOverlay";
import { ClarificationOverlay } from "./ClarificationOverlay";
import {
  isSlashCommand,
  getCommandCompletions,
  CommandHint,
} from "../slash-commands";
import { saveSettings } from "../../utils/settings-storage";

import { clsx } from "clsx";

export function InputArea({
  onSend,
  onSendFeedback,
  onSendAnnotation,
  onManualCommand,
  onStop,
  onOpenSettings,
}: {
  onSend: (text: string) => void;
  onSendFeedback: (text: string) => void;
  onSendAnnotation: (text: string) => void;
  onManualCommand: (text: string) => void;
  onStop: () => void;
  onOpenSettings: () => void;
}) {
  const inputText = useStore((s) => s.inputText);
  const setInputText = useStore((s) => s.setInputText);
  const isAgentRunning = useStore((s) => s.isAgentRunning);
  const demoRecording = useStore((s) => s.demoRecording);
  const pendingApproval = useStore((s) => s.pendingApproval);
  const pendingEscalation = useStore((s) => s.pendingEscalation);
  const pendingClarification = useStore((s) => s.pendingClarification);
  const manualRecording = useStore((s) => s.manualRecording);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const autonomousMode = !settings.requireApprovals;
  const [autonomyMenuOpen, setAutonomyMenuOpen] = useState(false);

  const setAutonomyMode = useCallback((autonomous: boolean) => {
    const next = {
      ...settings,
      requireApprovals: !autonomous,
      requirePlanConfirmation: !autonomous,
    };
    updateSettings(next);
    void saveSettings(next);
  }, [settings, updateSettings]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevHeightRef = useRef<number>(0);
  const [completions, setCompletions] = useState<CommandHint[]>([]);
  const [selectedCompletion, setSelectedCompletion] = useState(0);

  // Smooth auto-resize
  const MAX_HEIGHT = 120;
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;

    const prev = prevHeightRef.current;

    el.style.transition = "none";
    el.style.overflowY = "hidden";
    el.style.height = "0px";
    const scrollH = Math.min(el.scrollHeight, MAX_HEIGHT);
    el.style.height = (prev || scrollH) + "px";

    void el.offsetHeight;
    el.style.transition = "height 0.15s ease";
    el.style.height = scrollH + "px";
    el.style.overflowY = scrollH >= MAX_HEIGHT ? "auto" : "hidden";

    prevHeightRef.current = scrollH;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [inputText, resizeTextarea]);

  const hasText = inputText.trim().length > 0;

  const handleSubmit = () => {
    if (!hasText) return;
    setCompletions([]);

    // Route slash commands (only when agent is not running)
    if (isSlashCommand(inputText) && !isAgentRunning) {
      onManualCommand(inputText);
      setInputText("");
      return;
    }

    if (demoRecording && !isAgentRunning) {
      onSendAnnotation(inputText);
    } else if (isAgentRunning) {
      onSendFeedback(inputText);
    } else {
      onSend(inputText);
    }
    setInputText("");
  };

  // Update autocomplete on input change
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);
    if (val.trim().startsWith("/") && !isAgentRunning) {
      const hints = getCommandCompletions(val.trim());
      setCompletions(hints);
      setSelectedCompletion(0);
    } else {
      setCompletions([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Autocomplete: Tab to accept, Escape to dismiss, arrow keys to navigate
    if (completions.length > 0) {
      if (e.key === "Tab") {
        e.preventDefault();
        const hint = completions[selectedCompletion];
        if (hint) {
          setInputText(hint.name + " ");
          setCompletions([]);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setCompletions([]);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedCompletion((i) => Math.min(i + 1, completions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedCompletion((i) => Math.max(i - 1, 0));
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Approval overlay replaces the entire input area
  if (pendingApproval) {
    return (
      <div className="p-2 bg-warm-50 dark:bg-warm-900 border-t border-warm-200 dark:border-warm-800">
        <StatusLine />
        <ApprovalOverlay />
      </div>
    );
  }

  // Escalation overlay replaces the entire input area
  if (pendingEscalation) {
    return (
      <div className="p-2 bg-warm-50 dark:bg-warm-900 border-t border-warm-200 dark:border-warm-800">
        <StatusLine />
        <EscalationOverlay />
      </div>
    );
  }

  // Clarification overlay replaces the entire input area
  if (pendingClarification) {
    return (
      <div className="p-2 bg-warm-50 dark:bg-warm-900 border-t border-warm-200 dark:border-warm-800">
        <StatusLine />
        <ClarificationOverlay />
      </div>
    );
  }

  return (
    <div className="bg-warm-50 dark:bg-warm-900 relative border-t border-warm-200 dark:border-warm-800">
      <StatusLine />
      {/* Risk banner when autonomous mode is on */}
      {autonomousMode && (
        <div className="mx-2 mt-1 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-md border border-amber-200 dark:border-amber-800 flex items-center gap-1.5">
          <ShieldAlert size={12} className="shrink-0" />
          <span>Autonomous mode — agent acts without asking</span>
        </div>
      )}
      {manualRecording && (
        <div className="mx-2 mt-1 px-2 py-1 text-[11px] text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md border border-red-200 dark:border-red-800 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          Recording: {manualRecording.name} ({manualRecording.turnCount} turns)
        </div>
      )}
      <div className="p-2">
        <div className="relative flex items-end gap-1.5 bg-warm-100 dark:bg-warm-800 p-1.5 rounded-2xl ring-1 ring-warm-200/60 dark:ring-warm-700/60 focus-within:ring-warm-300 dark:focus-within:ring-warm-600 transition-all">
          {completions.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 mb-1 bg-warm-50 dark:bg-warm-800 border border-warm-200 dark:border-warm-700 rounded-lg shadow-lg overflow-hidden z-50">
              {completions.map((hint, i) => (
                <button
                  key={hint.name}
                  className={clsx(
                    "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2",
                    i === selectedCompletion
                      ? "bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300"
                      : "text-warm-600 dark:text-warm-300 hover:bg-warm-100 dark:hover:bg-warm-700",
                  )}
                  onClick={() => {
                    setInputText(hint.name + " ");
                    setCompletions([]);
                    textareaRef.current?.focus();
                  }}
                >
                  <span className="font-mono font-medium">{hint.name}</span>
                  <span className="text-warm-400 dark:text-warm-500 truncate">
                    {hint.description}
                  </span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={
              demoRecording && !isAgentRunning
                ? "Add annotation..."
                : isAgentRunning
                  ? "Reply to agent..."
                  : "What can I help with?"
            }
            className="w-full bg-transparent border-none outline-none resize-none max-h-[120px] min-h-[36px] py-1.5 text-sm text-warm-800 dark:text-warm-100 placeholder:text-warm-400 dark:placeholder:text-warm-500"
            rows={1}
          />
          <div className="flex items-end gap-1">
            {/* Stop button — only when agent is running */}
            {isAgentRunning && (
              <button
                onClick={onStop}
                className="p-1.5 mb-0.5 text-white rounded-lg transition-colors flex-shrink-0 bg-red-500 hover:bg-red-600"
                aria-label="Stop generation"
              >
                <StopCircle size={16} />
              </button>
            )}
            {/* Send button — appears when text is present */}
            {hasText && (
              <button
                onClick={handleSubmit}
                className={clsx(
                  "w-8 h-8 mb-0.5 rounded-full transition-colors flex-shrink-0 flex items-center justify-center",
                  demoRecording && !isAgentRunning
                    ? "bg-primary-600 hover:bg-primary-700 text-white"
                    : isAgentRunning
                      ? "bg-amber-500 hover:bg-amber-600 text-white"
                      : "bg-warm-700 hover:bg-warm-800 dark:bg-warm-300 dark:hover:bg-warm-200 text-white dark:text-warm-900",
                )}
                aria-label={
                  demoRecording && !isAgentRunning
                    ? "Send annotation"
                    : isAgentRunning
                      ? "Send feedback"
                      : "Send message"
                }
              >
                <ArrowUp size={16} />
              </button>
            )}
          </div>
        </div>
        {/* Footer row: autonomy popover */}
        <div className="flex items-center mt-1.5 px-1 relative">
          <div className="relative">
            <button
              onClick={() => setAutonomyMenuOpen((v) => !v)}
              className={clsx(
                "flex items-center gap-1.5 text-[11px] py-0.5 px-1.5 rounded-md transition-colors",
                autonomousMode
                  ? "text-amber-700 dark:text-amber-300"
                  : "text-warm-500 dark:text-warm-400 hover:text-warm-700 dark:hover:text-warm-200",
              )}
            >
              {autonomousMode ? <Play size={10} className="shrink-0" /> : <ShieldCheck size={10} className="shrink-0" />}
              <span>{autonomousMode ? "Act without asking" : "Ask before acting"}</span>
              <ChevronDown size={10} className="shrink-0" />
            </button>
            {autonomyMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setAutonomyMenuOpen(false)} />
                <div className="absolute bottom-full left-0 mb-1.5 w-64 bg-warm-50 dark:bg-warm-800 border border-warm-200 dark:border-warm-700 rounded-lg shadow-lg z-50 overflow-hidden">
                  <button
                    onClick={() => { setAutonomyMode(false); setAutonomyMenuOpen(false); }}
                    className={clsx(
                      "w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors",
                      !autonomousMode
                        ? "bg-warm-100 dark:bg-warm-700/50"
                        : "hover:bg-warm-100 dark:hover:bg-warm-700/30",
                    )}
                  >
                    <ShieldCheck size={14} className="shrink-0 mt-0.5 text-warm-500 dark:text-warm-400" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-warm-800 dark:text-warm-100">Ask before acting</div>
                      <div className="text-[10px] text-warm-500 dark:text-warm-400 mt-0.5">Agent asks for approval before taking actions</div>
                    </div>
                    {!autonomousMode && <Check size={14} className="shrink-0 mt-0.5 text-primary-500" />}
                  </button>
                  <button
                    onClick={() => { setAutonomyMode(true); setAutonomyMenuOpen(false); }}
                    className={clsx(
                      "w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors",
                      autonomousMode
                        ? "bg-warm-100 dark:bg-warm-700/50"
                        : "hover:bg-warm-100 dark:hover:bg-warm-700/30",
                    )}
                  >
                    <Play size={14} className="shrink-0 mt-0.5 text-warm-500 dark:text-warm-400" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-warm-800 dark:text-warm-100">Act without asking</div>
                      <div className="text-[10px] text-warm-500 dark:text-warm-400 mt-0.5">Agent takes actions without asking for permission</div>
                    </div>
                    {autonomousMode && <Check size={14} className="shrink-0 mt-0.5 text-primary-500" />}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <p className="text-center text-[10px] text-warm-400 dark:text-warm-500 mt-1 select-none">
          AI can make mistakes. Please double-check responses.
        </p>
      </div>
    </div>
  );
}
