import React, { useState, useCallback, useRef, useEffect } from "react";
import { X } from "lucide-react";

export interface DemoSaveData {
  name: string;
  description?: string;
  goal?: string;
  preconditions?: string[];
  outcomeSignal?: string;
  golden: boolean;
}

interface DemoSaveModalProps {
  actionCount: number;
  onSave: (data: DemoSaveData) => void;
  onCancel: () => void;
}

export function DemoSaveModal({
  actionCount,
  onSave,
  onCancel,
}: DemoSaveModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [goal, setGoal] = useState("");
  const [preconditions, setPreconditions] = useState<string[]>([]);
  const [preconditionInput, setPreconditionInput] = useState("");
  const [outcomeSignal, setOutcomeSignal] = useState("");
  const [golden, setGolden] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const handleSave = useCallback(() => {
    const trimmedName = name.trim() || `Demo ${new Date().toLocaleString()}`;
    onSave({
      name: trimmedName,
      description: description.trim() || undefined,
      goal: goal.trim() || undefined,
      preconditions: preconditions.length > 0 ? preconditions : undefined,
      outcomeSignal: outcomeSignal.trim() || undefined,
      golden,
    });
  }, [name, description, goal, preconditions, outcomeSignal, golden, onSave]);

  const addPrecondition = useCallback(() => {
    const val = preconditionInput.trim();
    if (val && !preconditions.includes(val)) {
      setPreconditions((p) => [...p, val]);
      setPreconditionInput("");
    }
  }, [preconditionInput, preconditions]);

  const removePrecondition = useCallback((index: number) => {
    setPreconditions((p) => p.filter((_, i) => i !== index));
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onCancel();
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSave();
      }
    },
    [onCancel, handleSave],
  );

  const inputClass =
    "w-full px-2 py-1.5 text-xs rounded bg-warm-50 dark:bg-warm-800 border border-warm-300 dark:border-warm-600 text-warm-800 dark:text-warm-100 placeholder:text-warm-400 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/30";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onKeyDown={handleKeyDown}
    >
      <div className="w-[320px] max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-warm-900 border border-warm-200 dark:border-warm-700 shadow-xl">
        <div className="px-4 pt-4 pb-3">
          <h3 className="text-sm font-semibold text-warm-800 dark:text-warm-100">
            Save Demonstration
          </h3>
        </div>

        <div className="px-4 pb-4 space-y-3">
          {/* Name (required) */}
          <div>
            <label className="block text-[11px] font-medium text-warm-600 dark:text-warm-400 mb-1">
              Name
            </label>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                  e.stopPropagation();
                }
              }}
              placeholder="e.g. Login flow"
              className={inputClass}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-[11px] font-medium text-warm-600 dark:text-warm-400 mb-1">
              Description{" "}
              <span className="text-warm-400 font-normal">optional</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this demo do?"
              rows={2}
              className={inputClass + " resize-none"}
            />
          </div>

          {/* Goal */}
          <div>
            <label className="block text-[11px] font-medium text-warm-600 dark:text-warm-400 mb-1">
              Goal{" "}
              <span className="text-warm-400 font-normal">optional</span>
            </label>
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Log into the account"
              className={inputClass}
            />
          </div>

          {/* Preconditions */}
          <div>
            <label className="block text-[11px] font-medium text-warm-600 dark:text-warm-400 mb-1">
              Preconditions{" "}
              <span className="text-warm-400 font-normal">optional</span>
            </label>
            {preconditions.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1.5">
                {preconditions.map((p, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded bg-warm-100 dark:bg-warm-800 text-warm-700 dark:text-warm-300 border border-warm-200 dark:border-warm-600"
                  >
                    {p}
                    <button
                      onClick={() => removePrecondition(i)}
                      className="text-warm-400 hover:text-warm-600 dark:hover:text-warm-300 ml-0.5"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-1">
              <input
                type="text"
                value={preconditionInput}
                onChange={(e) => setPreconditionInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                    addPrecondition();
                  }
                }}
                placeholder="e.g. Must be logged out"
                className={inputClass + " flex-1"}
              />
              <button
                onClick={addPrecondition}
                disabled={!preconditionInput.trim()}
                className="px-2 py-1 text-[10px] rounded bg-warm-100 dark:bg-warm-800 text-warm-600 dark:text-warm-300 hover:bg-warm-200 dark:hover:bg-warm-700 disabled:opacity-40 border border-warm-300 dark:border-warm-600"
              >
                Add
              </button>
            </div>
          </div>

          {/* Outcome signal */}
          <div>
            <label className="block text-[11px] font-medium text-warm-600 dark:text-warm-400 mb-1">
              Outcome signal{" "}
              <span className="text-warm-400 font-normal">optional</span>
            </label>
            <input
              type="text"
              value={outcomeSignal}
              onChange={(e) => setOutcomeSignal(e.target.value)}
              placeholder='e.g. URL contains /dashboard'
              className={inputClass}
            />
          </div>

          {/* Golden checkbox */}
          <label className="flex items-center gap-2 py-1 cursor-pointer">
            <input
              type="checkbox"
              checked={golden}
              onChange={(e) => setGolden(e.target.checked)}
              className="rounded border-warm-300 dark:border-warm-600 text-amber-500 focus:ring-amber-500/30"
            />
            <span className="text-xs text-warm-700 dark:text-warm-300">
              Add to eval dataset
            </span>
          </label>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-warm-200 dark:border-warm-700 flex items-center justify-between">
          <span className="text-[10px] text-warm-400">
            {actionCount} action{actionCount !== 1 ? "s" : ""} recorded
          </span>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-xs rounded-lg text-warm-600 dark:text-warm-400 hover:bg-warm-100 dark:hover:bg-warm-800"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-3 py-1.5 text-xs rounded-lg bg-primary-600 text-white hover:bg-primary-700 font-medium"
            >
              Save Demo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
