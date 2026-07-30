import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Loader2, X } from "lucide-react";
import type { OpenRouterModel } from "../hooks/useOpenRouterModels";
import { formatPricingBadge } from "../hooks/useOpenRouterModels";

interface ModelSelectorProps {
  value: string;
  onChange: (value: string) => void;
  defaultModel: string;
  models: OpenRouterModel[];
  loading: boolean;
  filterVisionOnly?: boolean;
}

export function ModelSelector({
  value,
  onChange,
  defaultModel,
  models,
  loading,
  filterVisionOnly,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setFilter("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus filter input when opened
  useEffect(() => {
    if (open && filterInputRef.current) {
      filterInputRef.current.focus();
    }
  }, [open]);

  const filteredModels = models.filter((m) => {
    if (filterVisionOnly && !m.supportsVision) return false;
    if (!filter) return true;
    const q = filter.toLowerCase();
    return m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
  });

  const selectedModel = value ? models.find((m) => m.id === value) : null;

  const displayName = selectedModel
    ? selectedModel.name
    : value
      ? value
      : `Default (${defaultModel})`;

  const hasModels = models.length > 0;

  // Keep release settings on verified catalog entries. A catalog outage should
  // not silently turn the selector into an arbitrary model-id escape hatch.
  if (!hasModels && !loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-warm-200 bg-warm-100/70 px-3 py-2 dark:border-warm-700 dark:bg-warm-800/50">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-warm-700 dark:text-warm-200">
            {value || defaultModel}
          </p>
          <p className="text-[11px] text-warm-400 dark:text-warm-500">
            {value ? "Configured override" : "Tested default"}
          </p>
        </div>
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="rounded p-1.5 hover:bg-warm-200 dark:hover:bg-warm-700"
            aria-label="Reset model to tested default"
          >
            <X size={14} className="text-warm-400" />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Current selection */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="w-full flex items-center justify-between px-3 py-2 text-sm border border-warm-300 dark:border-warm-700 rounded-md bg-warm-50 dark:bg-warm-900 hover:bg-warm-100 dark:hover:bg-warm-800 outline-none dark:text-warm-100 text-left"
      >
        <span className="truncate">
          {loading ? "Loading models..." : displayName}
        </span>
        {loading ? (
          <Loader2 size={14} className="animate-spin text-warm-400 shrink-0" />
        ) : (
          <ChevronDown
            size={14}
            className={`text-warm-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {/* Pricing badge */}
      {selectedModel && (
        <p className="text-xs text-warm-400 dark:text-warm-500 mt-0.5">
          {formatPricingBadge(selectedModel)}
        </p>
      )}

      {/* Dropdown */}
      {open && !loading && (
        <div
          role="listbox"
          className="absolute z-50 mt-1 w-full bg-white dark:bg-warm-900 border border-warm-300 dark:border-warm-700 rounded-md shadow-lg max-h-[280px] flex flex-col"
        >
          {/* Filter input */}
          <div className="p-2 border-b border-warm-200 dark:border-warm-700">
            <input
              ref={filterInputRef}
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter models..."
              className="w-full px-2 py-1.5 text-sm border border-warm-300 dark:border-warm-700 rounded bg-warm-50 dark:bg-warm-900 focus:ring-1 focus:ring-primary-500 outline-none dark:text-warm-100"
            />
          </div>

          {/* Model list */}
          <div className="overflow-y-auto flex-1">
            {/* Default option */}
            <button
              type="button"
              role="option"
              aria-selected={!value}
              onClick={() => {
                onChange("");
                setOpen(false);
                setFilter("");
              }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-warm-100 dark:hover:bg-warm-800 ${
                !value
                  ? "bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300"
                  : "dark:text-warm-100"
              }`}
            >
              <div className="font-medium">Default</div>
              <div className="text-xs text-warm-400">{defaultModel}</div>
            </button>

            {filteredModels.map((m) => (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={value === m.id}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                  setFilter("");
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-warm-100 dark:hover:bg-warm-800 border-t border-warm-100 dark:border-warm-800 ${
                  value === m.id
                    ? "bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300"
                    : "dark:text-warm-100"
                }`}
              >
                <div className="font-medium truncate">{m.name}</div>
                <div className="text-xs text-warm-400 truncate">
                  {m.id} &middot; {formatPricingBadge(m)}
                </div>
              </button>
            ))}

            {filteredModels.length === 0 && (
              <div className="px-3 py-4 text-sm text-warm-400 text-center">
                No models match &ldquo;{filter}&rdquo;
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
