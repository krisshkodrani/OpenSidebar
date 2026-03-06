import React from "react";
import { Bookmark, Settings } from "lucide-react";

interface Props {
  onOpenSettings: () => void;
  onOpenSavedPrompts: () => void;
  showApprovalBypassBadge?: boolean;
}

export function Header({
  onOpenSettings,
  onOpenSavedPrompts,
}: Props) {
  return (
    <header className="flex items-center justify-between px-3 py-1.5 bg-warm-50 dark:bg-warm-900 border-b border-warm-100 dark:border-warm-800 sticky top-0 z-10">
      <div className="w-8" />

      <span className="text-[11px] font-medium text-warm-400 dark:text-warm-500 tracking-wide select-none">
        OpenSidebar
      </span>

      <div className="flex items-center gap-0.5">
        <button
          onClick={onOpenSavedPrompts}
          className="p-1.5 hover:bg-warm-100 dark:hover:bg-warm-800 rounded-full transition-colors text-warm-500 hover:text-warm-700 dark:hover:text-warm-300"
          aria-label="Saved Prompts"
        >
          <Bookmark size={16} />
        </button>
        <button
          onClick={onOpenSettings}
          className="p-1.5 hover:bg-warm-100 dark:hover:bg-warm-800 rounded-full transition-colors text-warm-500 hover:text-warm-700 dark:hover:text-warm-300"
          aria-label="Settings"
        >
          <Settings size={16} />
        </button>
      </div>
    </header>
  );
}
