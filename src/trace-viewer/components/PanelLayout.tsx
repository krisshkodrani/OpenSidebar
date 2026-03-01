import React from "react";

interface PanelLayoutProps {
  left: React.ReactNode;
  right: React.ReactNode;
}

export default function PanelLayout({ left, right }: PanelLayoutProps) {
  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-[340px] min-w-[280px] border-r border-trace-border flex flex-col bg-trace-panel">
        {left}
      </div>
      <div className="flex-1 flex flex-col min-w-0 bg-trace-bg">{right}</div>
    </div>
  );
}
