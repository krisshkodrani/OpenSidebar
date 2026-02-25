import React from "react";
import Badge from "../Badge";
import type { SkillRecord } from "../../store/types";
import { formatTime, truncate } from "../../utils";

interface SkillListItemProps {
  skill: SkillRecord;
  isActive: boolean;
  onClick: () => void;
}

export default function SkillListItem({ skill, isActive, onClick }: SkillListItemProps) {
  const totalRuns = skill.successfulRuns + skill.failedRuns;
  const successRate =
    totalRuns > 0 ? `${Math.round((skill.successfulRuns / totalRuns) * 100)}%` : "---";

  return (
    <div
      onClick={onClick}
      className={`px-4 py-3 border-b border-[rgba(15,52,96,0.4)] cursor-pointer transition-colors ${
        isActive ? "bg-trace-border" : "hover:bg-[rgba(15,52,96,0.5)]"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[11px] text-trace-muted shrink-0">
          {formatTime(skill.updatedAt)}
        </span>
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          {skill.pinned && <Badge variant="pinned">pinned</Badge>}
          <Badge variant={skill.enabled ? "enabled" : "disabled"}>
            {skill.enabled ? "enabled" : "disabled"}
          </Badge>
        </div>
      </div>
      <div className="text-[13px] text-[#c0c0d8] leading-snug overflow-hidden text-ellipsis whitespace-nowrap">
        {truncate(skill.name, 50)}
      </div>
      <div className="text-[11px] text-trace-muted mt-0.5">
        {skill.steps?.length || 0} steps &middot; {skill.uses} uses &middot; {successRate} success
      </div>
    </div>
  );
}
