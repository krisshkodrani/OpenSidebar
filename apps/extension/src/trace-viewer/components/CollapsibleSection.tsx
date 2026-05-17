import React, { useId, useState } from "react";
import { ChevronRight } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/ui/collapsible";

interface CollapsibleSectionProps {
  label: React.ReactNode;
  preview?: string;
  defaultOpen?: boolean;
  maxHeightClass?: string;
  className?: string;
  children: React.ReactNode;
}

export default function CollapsibleSection({
  label,
  preview,
  defaultOpen = false,
  maxHeightClass = "open",
  className = "",
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const reactId = useId();
  const buttonId = `collapsible-trigger-${reactId}`;
  const contentId = `collapsible-content-${reactId}`;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={className}>
      <CollapsibleTrigger asChild>
        <button
          id={buttonId}
          type="button"
          aria-controls={contentId}
          className="flex items-center gap-1.5 cursor-pointer px-2 py-1.5 rounded bg-trace-accent/[0.05] border-none text-trace-subtle text-xs w-full text-left transition-colors hover:bg-trace-accent/[0.07]"
        >
          <ChevronRight
            size={13}
            className={`shrink-0 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
          <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
            {label}
            {preview && !open && (
              <span className="text-trace-muted ml-1">{preview}</span>
            )}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent
        forceMount
        id={contentId}
        role="region"
        aria-labelledby={buttonId}
        className={`collapsible ${maxHeightClass === "sm" ? "collapsible-sm" : maxHeightClass === "xs" ? "collapsible-xs" : ""} ${open ? "open" : ""}`}
      >
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
