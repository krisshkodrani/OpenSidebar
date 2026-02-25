import React from "react";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onEscape?: () => void;
}

export default function SearchInput({
  value,
  onChange,
  placeholder = "Search...",
  className = "",
  onEscape,
}: SearchInputProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && onEscape) onEscape();
      }}
      placeholder={placeholder}
      className={`w-full bg-trace-panel text-trace-text border border-trace-border rounded-[5px] px-3 py-2 text-[13px] outline-none transition-colors focus:border-trace-accent placeholder:text-trace-dim ${className}`}
    />
  );
}
