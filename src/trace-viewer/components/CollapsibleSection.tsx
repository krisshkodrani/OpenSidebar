import React, { useState } from "react";

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

  return (
    <div className={className}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 cursor-pointer px-2 py-1.5 rounded bg-[rgba(26,26,46,0.5)] border-none text-trace-subtle text-xs w-full text-left transition-colors hover:bg-[rgba(26,26,46,0.8)]"
      >
        <span
          className={`text-[10px] shrink-0 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        >
          &#9654;
        </span>
        <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          {label}
          {preview && !open && (
            <span className="text-[#8a8ab0] ml-1">{preview}</span>
          )}
        </span>
      </button>
      <div className={`collapsible ${maxHeightClass === "sm" ? "collapsible-sm" : maxHeightClass === "xs" ? "collapsible-xs" : ""} ${open ? "open" : ""}`}>
        {children}
      </div>
    </div>
  );
}
