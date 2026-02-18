import React from "react";
import { Settings, Bookmark } from "lucide-react";

interface Props {
  onOpenSettings: () => void;
  onOpenSavedPrompts: () => void;
  showApprovalBypassBadge?: boolean;
}

export function Header({
  onOpenSettings,
  onOpenSavedPrompts,
  showApprovalBypassBadge = false,
}: Props) {
  return (
    <header className="flex items-center justify-between p-4 border-b border-warm-200 dark:border-warm-800 glass-surface sticky top-0 z-10 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        <h1 className="text-sm font-semibold text-warm-800 dark:text-warm-100 truncate">
          OpenSidebar
        </h1>
        {showApprovalBypassBadge && (
          <span className="inline-flex items-center rounded-full border border-amber-300 dark:border-amber-700 bg-amber-100/80 dark:bg-amber-900/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
            Approval bypass ON
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={onOpenSavedPrompts}
          className="p-2 hover:bg-warm-100 dark:hover:bg-warm-800 rounded-full transition-colors text-warm-500 hover:text-warm-700 dark:hover:text-warm-300"
          aria-label="Saved Prompts"
        >
          <Bookmark size={18} />
        </button>
        <button
          onClick={onOpenSettings}
          className="p-2 hover:bg-warm-100 dark:hover:bg-warm-800 rounded-full transition-colors text-warm-500 hover:text-warm-700 dark:hover:text-warm-300"
          aria-label="Settings"
        >
          <Settings size={18} />
        </button>
      </div>
    </header>
  );
}
