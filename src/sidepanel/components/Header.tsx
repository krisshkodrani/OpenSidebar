import React from "react";
import { Settings, Bookmark } from "lucide-react";
import { DemoRecordButton } from "./DemoRecordButton";

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
    <header className="flex items-center justify-between px-3 py-1.5 border-b border-warm-200 dark:border-warm-800 bg-warm-50 dark:bg-warm-900 sticky top-0 z-10 transition-colors">
      <div className="flex items-center gap-1.5 min-w-0">
        <DemoRecordButton />
      </div>

      <span className="text-xs font-semibold text-warm-400 dark:text-warm-500 tracking-wide select-none">
        OS
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
          className="relative p-1.5 hover:bg-warm-100 dark:hover:bg-warm-800 rounded-full transition-colors text-warm-500 hover:text-warm-700 dark:hover:text-warm-300"
          aria-label="Settings"
        >
          <Settings size={16} />
          {showApprovalBypassBadge && (
            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-500" />
          )}
        </button>
      </div>
    </header>
  );
}
