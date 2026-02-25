import React from "react";
import type { SkillRecord } from "../../store/types";
import { formatDuration, formatTokens, formatDate } from "../../utils";

interface SkillStatsGridProps {
  skill: SkillRecord;
}

export default function SkillStatsGrid({ skill }: SkillStatsGridProps) {
  const totalRuns = skill.successfulRuns + skill.failedRuns;
  const successRate = totalRuns > 0 ? Math.round((skill.successfulRuns / totalRuns) * 100) : 0;
  const successColor =
    successRate >= 80 ? "text-[#2ecc71]" : successRate >= 50 ? "text-[#f1c40f]" : "text-[#e74c3c]";

  const stats = [
    { label: "Uses", value: String(skill.uses) },
    {
      label: "Success Rate",
      value: totalRuns > 0 ? `${successRate}%` : "---",
      color: successColor,
    },
    { label: "Successful", value: String(skill.successfulRuns), color: "text-[#2ecc71]" },
    {
      label: "Failed",
      value: String(skill.failedRuns),
      color: skill.failedRuns > 0 ? "text-[#e74c3c]" : undefined,
    },
    { label: "Avg Duration", value: formatDuration(skill.avgDurationMs) },
    { label: "Avg Tokens", value: formatTokens(skill.avgTokens) },
    {
      label: "Consecutive Failures",
      value: String(skill.consecutiveReplayFailures),
      color: skill.consecutiveReplayFailures >= 3 ? "text-[#e74c3c]" : undefined,
    },
    { label: "Created", value: formatDate(skill.createdAt), small: true },
  ];

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2.5 mb-4">
      {stats.map((s) => (
        <div key={s.label} className="bg-[rgba(26,26,46,0.5)] rounded-[5px] p-2.5">
          <div className="text-[10px] text-trace-muted uppercase tracking-wider mb-1">
            {s.label}
          </div>
          <div
            className={`font-bold font-mono ${s.small ? "text-[11px]" : "text-base"} ${s.color || "text-trace-text"}`}
          >
            {s.value}
          </div>
        </div>
      ))}
    </div>
  );
}
