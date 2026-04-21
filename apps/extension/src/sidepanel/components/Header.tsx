import React from "react";
import { Bookmark, Settings } from "lucide-react";

interface Props {
  onOpenSettings: () => void;
  onOpenSavedPrompts: () => void;
  modeBadgeLabel?: string | null;
}

export function Header({
  onOpenSettings,
  onOpenSavedPrompts,
  modeBadgeLabel,
}: Props) {
  return (
    <header className="flex items-center justify-between px-3 py-1.5 bg-warm-50 dark:bg-warm-900 border-b border-warm-100 dark:border-warm-800 sticky top-0 z-10">
      <div className="w-16">
        {modeBadgeLabel ? (
          <span className="inline-flex rounded-full bg-warm-100 dark:bg-warm-800 px-2 py-0.5 text-[10px] font-medium text-warm-600 dark:text-warm-300">
            {modeBadgeLabel}
          </span>
        ) : null}
      </div>

      <span className="text-[11px] font-semibold text-warm-600 dark:text-warm-300 tracking-[0.08em] select-none">
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
