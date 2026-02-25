import React from "react";
import Badge from "../Badge";
import type { MemoryRecord } from "../../store/types";
import { formatTime, truncate } from "../../utils";

interface MemoryListItemProps {
  entry: MemoryRecord;
  isActive: boolean;
  onClick: () => void;
}

export default function MemoryListItem({ entry, isActive, onClick }: MemoryListItemProps) {
  return (
    <div
      onClick={onClick}
      className={`px-4 py-3 border-b border-[rgba(15,52,96,0.4)] cursor-pointer transition-colors ${
        isActive ? "bg-trace-border" : "hover:bg-[rgba(15,52,96,0.5)]"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[11px] text-trace-muted shrink-0">
          {formatTime(entry.createdAt)}
        </span>
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          {entry.type && <Badge variant="type">{entry.type}</Badge>}
          {entry.category && <Badge variant="category">{entry.category}</Badge>}
        </div>
      </div>
      <div className="text-[13px] text-[#c0c0d8] leading-snug overflow-hidden text-ellipsis whitespace-nowrap">
        {truncate(entry.content, 60)}
      </div>
      {entry.sourceUrl && (
        <div className="text-[11px] text-trace-muted overflow-hidden text-ellipsis whitespace-nowrap mt-0.5">
          {truncate(entry.sourceUrl, 50)}
        </div>
      )}
    </div>
  );
}
