import React from "react";
import { useStore } from "../store";

interface ViewerHeaderProps {
  /** Whether the backend (memory + scheduling) panel is currently shown. */
  backendActive?: boolean;
  /** Toggle the backend panel on/off. When omitted, the toggle is hidden. */
  onToggleBackend?: () => void;
}

export default function ViewerHeader({
  backendActive = false,
  onToggleBackend,
}: ViewerHeaderProps) {
  const viewerTheme = useStore((s) => s.viewerTheme);
  const setViewerTheme = useStore((s) => s.setViewerTheme);

  const cycleTheme = () => {
    const next =
      viewerTheme === "light"
        ? "dark"
        : viewerTheme === "dark"
          ? "system"
          : "light";
    setViewerTheme(next);
  };

  const icon =
    viewerTheme === "light" ? "☀" : viewerTheme === "dark" ? "☾" : "◐";

  return (
    <header className="viewer-header shrink-0 px-5 py-2">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="viewer-brand-mark">OS</div>
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.28em] text-trace-accent-light/80">
              Observability Workspace
            </div>
            <h1 className="text-lg leading-tight font-semibold text-trace-text">
              OpenSidebar Viewer
            </h1>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {onToggleBackend && (
            <button
              onClick={onToggleBackend}
              aria-pressed={backendActive}
              className={`text-[11px] border rounded px-2 py-0.5 transition-colors ${
                backendActive
                  ? "border-trace-accent/40 bg-trace-accent/15 text-trace-accent-light"
                  : "border-trace-border text-trace-muted hover:text-trace-text"
              }`}
              title="Backend memory & scheduling panel"
            >
              {backendActive ? "← Traces" : "Backend"}
            </button>
          )}
          <button
            onClick={cycleTheme}
            className="text-[11px] text-trace-muted hover:text-trace-text border border-trace-border rounded px-2 py-0.5 transition-colors"
            title={`Theme: ${viewerTheme}`}
            aria-label={`Current theme: ${viewerTheme}. Click to cycle.`}
          >
            {icon} {viewerTheme}
          </button>
          <div className="hidden md:block text-[11px] text-trace-muted">
            Trace Operations
          </div>
        </div>
      </div>
    </header>
  );
}
