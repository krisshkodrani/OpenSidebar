import React from "react";
import { useStore } from "../../store";

interface SavedViewsBarProps {
  onFiltersChanged: () => void;
}

export default function SavedViewsBar({ onFiltersChanged }: SavedViewsBarProps) {
  const savedViews = useStore((s) => s.savedViews);
  const saveCurrentView = useStore((s) => s.saveCurrentView);
  const applySavedView = useStore((s) => s.applySavedView);
  const deleteSavedView = useStore((s) => s.deleteSavedView);
  const filters = useStore((s) => s.filters);

  const hasMeaningfulFilters =
    filters.outcome !== "all" ||
    filters.domain !== "" ||
    filters.mode !== "all" ||
    filters.model !== "all" ||
    filters.tier !== "all" ||
    filters.runId !== "";

  return (
    <div className="flex items-center gap-2 px-5 py-2 border-b border-trace-border bg-trace-panel/50 shrink-0 flex-wrap">
      <span className="text-[10px] uppercase tracking-[0.22em] text-trace-muted">
        Views
      </span>
      <button
        onClick={() => {
          saveCurrentView();
        }}
        disabled={!hasMeaningfulFilters}
        className="text-[11px] rounded border px-2 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-trace-border text-trace-muted hover:text-trace-text"
      >
        Save Current View
      </button>
      {savedViews.length === 0 ? (
        <span className="text-[11px] text-trace-dim">No saved views yet</span>
      ) : (
        savedViews.map((view) => (
          <div
            key={view.id}
            className="inline-flex items-center rounded border border-trace-border bg-trace-panel overflow-hidden"
          >
            <button
              onClick={() => {
                applySavedView(view.id);
                onFiltersChanged();
              }}
              className="px-2.5 py-1 text-[11px] text-trace-subtle hover:text-trace-text transition-colors"
            >
              {view.name}
            </button>
            <button
              onClick={() => deleteSavedView(view.id)}
              className="px-2 py-1 text-[10px] text-trace-dim hover:text-red-300 border-l border-trace-border transition-colors"
              title="Delete saved view"
            >
              x
            </button>
          </div>
        ))
      )}
    </div>
  );
}
