import React from "react";
import { useStore } from "../store";

const TABS = [
  { key: "traces" as const, label: "Traces" },
];

export default function TabBar() {
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);

  return (
    <div className="flex bg-[#12122a] border-b border-trace-border shrink-0 px-3 gap-0.5">
      <span className="flex items-center px-3 pl-1 text-sm font-bold text-trace-text tracking-wide mr-auto">
        OpenSidebar Trace Viewer
      </span>
      {TABS.map((t) => (
        <button
          key={t.key}
          onClick={() => setActiveTab(t.key)}
          className={`px-5 py-2.5 text-[13px] font-semibold border-b-2 cursor-pointer transition-colors tracking-wide ${
            activeTab === t.key
              ? "text-trace-accent-light border-trace-accent"
              : "text-trace-muted border-transparent hover:text-[#b0b0d0]"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
