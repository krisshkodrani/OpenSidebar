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
      <div className="flex items-center gap-2 rounded-md border border-line bg-surface-subtle px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-ui-body text-fg-secondary">
            {value || defaultModel}
          </p>
          <p className="text-ui-caption text-fg-tertiary">
            {value ? "Configured override" : "Tested default"}
          </p>
        </div>
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="rounded p-1.5 hover:bg-surface-hover"
            aria-label="Reset model to tested default"
          >
            <X size={14} className="text-fg-tertiary" />
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
        className="w-full flex items-center justify-between px-3 py-2 text-ui-body border border-line-strong rounded-md bg-canvas hover:bg-surface-subtle outline-none text-left"
      >
        <span className="truncate">
          {loading ? "Loading models..." : displayName}
        </span>
        {loading ? (
          <Loader2 size={14} className="animate-spin text-fg-tertiary shrink-0" />
        ) : (
          <ChevronDown
            size={14}
            className={`text-fg-tertiary shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {/* Pricing badge */}
      {selectedModel && (
        <p className="text-ui-control text-fg-tertiary mt-0.5">
          {formatPricingBadge(selectedModel)}
        </p>
      )}

      {/* Dropdown */}
      {open && !loading && (
        <div
          role="listbox"
          className="absolute z-50 mt-1 w-full bg-surface border border-line-strong rounded-md shadow-sm max-h-[280px] flex flex-col"
        >
          {/* Filter input */}
          <div className="p-2 border-b border-line">
            <input
              ref={filterInputRef}
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter models..."
              className="w-full px-2 py-1.5 text-ui-body border border-line-strong rounded bg-canvas focus:ring-1 focus:ring-accent outline-none"
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
              className={`w-full text-left px-3 py-2 text-ui-body hover:bg-surface-subtle ${
                !value
                  ? "bg-accent-subtle text-accent-text"
                  : ""
              }`}
            >
              <div className="font-medium">Default</div>
              <div className="text-ui-control text-fg-tertiary">{defaultModel}</div>
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
                className={`w-full text-left px-3 py-2 text-ui-body hover:bg-surface-subtle border-t border-line ${
                  value === m.id
                    ? "bg-accent-subtle text-accent-text"
                    : ""
                }`}
              >
                <div className="font-medium truncate">{m.name}</div>
                <div className="text-ui-control text-fg-tertiary truncate">
                  {m.id} &middot; {formatPricingBadge(m)}
                </div>
              </button>
            ))}

            {filteredModels.length === 0 && (
              <div className="px-3 py-4 text-ui-body text-fg-tertiary text-center">
                No models match &ldquo;{filter}&rdquo;
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
