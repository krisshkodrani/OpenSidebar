import React from "react";

export default function ViewerHeader() {
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
        <div className="ml-auto hidden md:block text-[11px] text-trace-muted">
          Trace Operations
        </div>
      </div>
    </header>
  );
}
