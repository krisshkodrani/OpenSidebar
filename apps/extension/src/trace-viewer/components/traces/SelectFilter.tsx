import React from "react";

// Compact labeled <select> used by the Analytics facet row. Extracted from the
// former InsightsTab so the merged Analytics tab and tests share one source.
export default function SelectFilter({
  label,
  value,
  onChange,
  options,
  emptyLabel,
  emptyValue = "all",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  emptyLabel: string;
  /** The sentinel this filter uses for "no selection" ("all" or ""). The reset
   *  option always emits exactly this, so reset is idempotent regardless of the
   *  current selection. */
  emptyValue?: string;
}) {
  return (
    <label className="min-w-0">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full px-2 py-1.5 text-sm bg-trace-surface border border-trace-border rounded text-trace-text focus:outline-none focus:border-trace-accent"
      >
        <option value={emptyValue}>{emptyLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
