import React from "react";
import { Settings, Bookmark } from "lucide-react";
import { StatusBar } from "./StatusBar";

interface Props {
  onOpenSettings: () => void;
  onOpenSavedPrompts: () => void;
}

export function Header({ onOpenSettings, onOpenSavedPrompts }: Props) {
  return (
    <header className="flex items-center justify-between p-4 border-b border-warm-200 dark:border-warm-800 glass-surface sticky top-0 z-10 transition-colors">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          {/* Logo removed as per user request */}
        </div>
        <StatusBar />
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
