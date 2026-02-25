import React from "react";
import { useStore } from "../../store";
import SkillListItem from "./SkillListItem";
import LoadingSpinner from "../LoadingSpinner";

export default function SkillList() {
  const skills = useStore((s) => s.skills);
  const currentSkillId = useStore((s) => s.currentSkillId);
  const setCurrentSkillId = useStore((s) => s.setCurrentSkillId);
  const skillSearchQuery = useStore((s) => s.skillSearchQuery);
  const skillStatusFilter = useStore((s) => s.skillStatusFilter);
  const skillsLoading = useStore((s) => s.skillsLoading);

  if (skillsLoading) {
    return <LoadingSpinner message="Loading skills..." />;
  }

  // Apply filters
  let filtered = skills;
  const q = skillSearchQuery.toLowerCase().trim();
  if (q) {
    filtered = filtered.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.sourceQuery || "").toLowerCase().includes(q) ||
        (s.matchTokens || []).join(" ").includes(q),
    );
  }
  if (skillStatusFilter === "enabled") filtered = filtered.filter((s) => s.enabled);
  else if (skillStatusFilter === "disabled") filtered = filtered.filter((s) => !s.enabled);
  else if (skillStatusFilter === "pinned") filtered = filtered.filter((s) => s.pinned);

  if (filtered.length === 0) {
    return (
      <div className="py-10 px-4 text-center text-trace-muted text-[13px]">
        {skills.length === 0 ? (
          <>
            No skills found.
            <br /><br />
            <span className="text-[11px] text-[#5a5a7e]">
              Skills are synced from the extension via POST /api/skills/sync
            </span>
          </>
        ) : (
          "No skills match the current filters."
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      {filtered.map((skill) => (
        <SkillListItem
          key={skill.id}
          skill={skill}
          isActive={skill.id === currentSkillId}
          onClick={() => setCurrentSkillId(skill.id)}
        />
      ))}
    </div>
  );
}
