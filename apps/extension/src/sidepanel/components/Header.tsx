import React from "react";
import { ListChecks, Settings } from "lucide-react";

interface Props {
  onOpenSettings: () => void;
  onOpenWebsiteSkills: () => void;
  modeBadgeLabel?: string | null;
  recordingActive?: boolean;
}

export function Header({
  onOpenSettings,
  onOpenWebsiteSkills,
  modeBadgeLabel,
  recordingActive,
}: Props) {
  return (
    <header className="sticky top-0 z-10 grid grid-cols-[1fr_auto_1fr] items-center border-b border-warm-100 bg-warm-50 px-3 py-1.5 dark:border-warm-800 dark:bg-warm-900">
      <div className="min-w-0 justify-self-start">
        {modeBadgeLabel ? (
          <span className="inline-flex max-w-full truncate rounded-full bg-warm-100 px-2 py-0.5 text-[10px] font-medium text-warm-600 dark:bg-warm-800 dark:text-warm-300">
            {modeBadgeLabel}
          </span>
        ) : null}
      </div>

      <span className="select-none text-[11px] font-semibold tracking-[0.08em] text-warm-600 dark:text-warm-300">
        OpenSidebar
      </span>

      <div className="flex items-center gap-0.5 justify-self-end">
        <button
          type="button"
          onClick={onOpenWebsiteSkills}
          className={`rounded-full p-1.5 transition-colors hover:bg-warm-100 dark:hover:bg-warm-800 ${
            recordingActive
              ? "text-red-600 dark:text-red-400"
              : "text-warm-500 hover:text-warm-700 dark:hover:text-warm-300"
          }`}
          aria-label="Website Skills"
          title={recordingActive ? "Recording website skill" : "Website skills"}
        >
          <ListChecks size={16} />
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded-full p-1.5 text-warm-500 transition-colors hover:bg-warm-100 hover:text-warm-700 dark:hover:bg-warm-800 dark:hover:text-warm-300"
          aria-label="Settings"
          title="Settings"
        >
          <Settings size={16} />
        </button>
      </div>
    </header>
  );
}
