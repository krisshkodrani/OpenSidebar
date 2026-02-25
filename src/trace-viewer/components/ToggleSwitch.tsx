import React from "react";

interface ToggleSwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export default function ToggleSwitch({ label, checked, onChange }: ToggleSwitchProps) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className="text-xs text-[#c0c0d8] min-w-[70px]">{label}</span>
      <label className="relative w-9 h-5 shrink-0 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="opacity-0 w-0 h-0 peer"
        />
        <span className="absolute cursor-pointer inset-0 bg-trace-border rounded-[20px] transition-colors peer-checked:bg-trace-accent" />
        <span className="absolute w-4 h-4 left-0.5 bottom-0.5 bg-[#c0c0d8] rounded-full transition-transform peer-checked:translate-x-4" />
      </label>
    </div>
  );
}
