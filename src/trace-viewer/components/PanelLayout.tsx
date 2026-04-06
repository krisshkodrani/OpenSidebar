import React from "react";

interface PanelLayoutProps {
  left: React.ReactNode;
  right: React.ReactNode;
}

export default function PanelLayout({ left, right }: PanelLayoutProps) {
  return (
    <div className="flex flex-1 overflow-hidden p-4 gap-4">
      <div className="w-[360px] min-w-[300px] border border-white/8 rounded-[1.4rem] overflow-hidden flex flex-col bg-[linear-gradient(180deg,rgba(41,37,36,0.96),rgba(28,25,23,0.96))] shadow-soft-md">
        {left}
      </div>
      <div className="flex-1 min-w-0 flex flex-col rounded-[1.6rem] border border-white/8 overflow-hidden bg-[linear-gradient(180deg,rgba(35,31,29,0.96),rgba(28,25,23,0.94))] shadow-soft-md">
        {right}
      </div>
    </div>
  );
}
