import React from "react";
import { ListChecks, Settings } from "lucide-react";

interface Props {
  onOpenSettings: () => void;
  onOpenWebsiteSkills: () => void;
  modeBadgeLabel?: string | null;
  recordingActive?: boolean;
  connectionLabel?: string;
}

export function Header({
  onOpenSettings,
  onOpenWebsiteSkills,
  modeBadgeLabel,
  recordingActive,
  connectionLabel,
}: Props) {
  return (
    <header className="sticky top-0 z-10 grid grid-cols-[1fr_auto_1fr] items-center border-b border-line bg-canvas px-3 py-1.5">
      <div className="min-w-0 justify-self-start">
        {modeBadgeLabel ? (
          <span className="inline-flex max-w-full truncate rounded-full bg-surface-subtle px-2 py-0.5 text-ui-caption font-medium text-fg-secondary">
            {modeBadgeLabel}
          </span>
        ) : null}
      </div>

      <span className="select-none text-ui-caption font-semibold tracking-[0.08em] text-fg-secondary">
        OpenSidebar
      </span>

      <div className="flex items-center gap-0.5 justify-self-end">
        {connectionLabel ? (
          <button
            type="button"
            onClick={onOpenSettings}
            className="mr-1 inline-flex max-w-40 items-center gap-1.5 truncate rounded-full bg-surface-subtle px-2.5 py-1 text-ui-caption font-medium text-fg-secondary hover:bg-surface-hover hover:text-fg"
            title={connectionLabel}
            aria-label={`Account status: ${connectionLabel}`}
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
            <span className="truncate">{connectionLabel}</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={onOpenWebsiteSkills}
          className={`rounded-full p-1.5 transition-colors hover:bg-surface-subtle ${
            recordingActive
              ? "text-danger"
              : "text-fg-tertiary hover:text-fg-secondary"
          }`}
          aria-label="Website Skills"
          title={recordingActive ? "Recording website skill" : "Website skills"}
        >
          <ListChecks size={16} />
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded-full p-1.5 text-fg-tertiary transition-colors hover:bg-surface-subtle hover:text-fg-secondary"
          aria-label="Settings"
          title="Settings"
        >
          <Settings size={16} />
        </button>
      </div>
    </header>
  );
}
