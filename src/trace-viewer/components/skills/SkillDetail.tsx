import React, { useState } from "react";
import { useStore } from "../../store";
import * as apiModule from "../../api";
import ToggleSwitch from "../ToggleSwitch";
import Badge from "../Badge";
import SkillStatsGrid from "./SkillStatsGrid";
import SkillStepItem from "./SkillStepItem";
import EmptyState from "../EmptyState";

export default function SkillDetail() {
  const skills = useStore((s) => s.skills);
  const currentSkillId = useStore((s) => s.currentSkillId);
  const updateSkillLocal = useStore((s) => s.updateSkillLocal);
  const removeSkillLocal = useStore((s) => s.removeSkillLocal);

  const skill = skills.find((s) => s.id === currentSkillId);

  const [editName, setEditName] = useState("");
  const [initialized, setInitialized] = useState<string | null>(null);

  // Sync local edit name when skill changes
  if (skill && initialized !== skill.id) {
    setEditName(skill.name);
    setInitialized(skill.id);
  }

  if (!skill) {
    return (
      <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
        <EmptyState icon="&#9881;" message="Select a skill to view details" />
      </div>
    );
  }

  const handleSave = async () => {
    try {
      const updated = await apiModule.updateSkill(skill.id, {
        name: editName.trim(),
        enabled: skill.enabled,
        pinned: skill.pinned,
      });
      updateSkillLocal(skill.id, updated);
    } catch (err) {
      alert(`Failed to save: ${err}`);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this skill? This cannot be undone.")) return;
    try {
      await apiModule.deleteSkill(skill.id);
      removeSkillLocal(skill.id);
    } catch (err) {
      alert(`Failed to delete: ${err}`);
    }
  };

  const handleToggle = async (field: "enabled" | "pinned", value: boolean) => {
    try {
      const updated = await apiModule.updateSkill(skill.id, { [field]: value });
      updateSkillLocal(skill.id, updated);
    } catch {
      // Revert on error — just refetch
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
      <div className="bg-trace-panel border border-[rgba(15,52,96,0.6)] rounded-lg p-4 mb-4">
        {/* Editable name */}
        <div className="mb-2.5">
          <label className="block text-[11px] font-semibold text-trace-muted uppercase tracking-wider mb-1">
            Skill Name
          </label>
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            className="bg-[rgba(26,26,46,0.5)] border border-trace-border rounded text-trace-text text-sm font-medium px-2.5 py-1.5 w-full outline-none transition-colors focus:border-trace-accent"
          />
        </div>

        {/* Source query */}
        <div className="mb-2">
          <label className="block text-[11px] font-semibold text-trace-muted uppercase tracking-wider mb-1">
            Source Query
          </label>
          <div className="text-xs text-[#8a8ab0] py-1">{skill.sourceQuery}</div>
        </div>

        {/* Toggles */}
        <ToggleSwitch
          label="Enabled"
          checked={skill.enabled}
          onChange={(v) => handleToggle("enabled", v)}
        />
        <ToggleSwitch
          label="Pinned"
          checked={skill.pinned}
          onChange={(v) => handleToggle("pinned", v)}
        />

        {/* Stats */}
        <SkillStatsGrid skill={skill} />

        {/* Match tokens */}
        {skill.matchTokens?.length > 0 && (
          <div className="mt-3">
            <label className="block text-[11px] font-semibold text-trace-muted uppercase tracking-wider mb-1">
              Match Tokens
            </label>
            <div className="flex gap-1 flex-wrap mt-1">
              {skill.matchTokens.map((t, i) => (
                <Badge key={i} variant="model">
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Steps */}
        {skill.steps?.length > 0 && (
          <div className="mt-3">
            <div className="text-[11px] font-semibold text-trace-muted uppercase tracking-wider mb-1.5">
              Steps ({skill.steps.length})
            </div>
            {skill.steps.map((step, i) => (
              <SkillStepItem key={i} step={step} index={i} />
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-3 flex-wrap">
          <button
            onClick={handleSave}
            className="px-3.5 py-1.5 rounded-[5px] text-xs font-semibold cursor-pointer border bg-trace-accent text-white border-trace-accent hover:bg-[#2b6cc4]"
          >
            Save Changes
          </button>
          <button
            onClick={handleDelete}
            className="px-3.5 py-1.5 rounded-[5px] text-xs font-semibold cursor-pointer border bg-red-500/15 text-[#e74c3c] border-red-500/30 hover:bg-red-500/25"
          >
            Delete Skill
          </button>
        </div>
      </div>

      <div className="text-[10px] text-trace-dim mt-2 font-mono">ID: {skill.id}</div>
    </div>
  );
}
