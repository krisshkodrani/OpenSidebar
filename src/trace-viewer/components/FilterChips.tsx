import React from "react";

interface FilterChip {
  key: string;
  label: string;
}

interface FilterChipsProps {
  chips: FilterChip[];
  onRemove: (key: string) => void;
  onClearAll: () => void;
}

export default function FilterChips({
  chips,
  onRemove,
  onClearAll,
}: FilterChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div className="mt-2.5 flex gap-1.5 flex-wrap items-center">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="bg-[rgba(58,123,213,0.15)] text-[#9fc5ff] border border-[rgba(58,123,213,0.45)] rounded-full text-[11px] px-2 py-[3px] inline-flex items-center gap-1.5"
        >
          {chip.label}
          <button
            onClick={() => onRemove(chip.key)}
            className="border-none bg-transparent text-[#9fc5ff] cursor-pointer text-[11px] leading-none p-0"
          >
            &#10005;
          </button>
        </span>
      ))}
      <button
        onClick={onClearAll}
        className="ml-auto bg-transparent text-trace-muted border border-trace-border rounded px-2 py-[3px] text-[11px] cursor-pointer hover:text-trace-text hover:border-trace-accent"
      >
        Clear all
      </button>
    </div>
  );
}
