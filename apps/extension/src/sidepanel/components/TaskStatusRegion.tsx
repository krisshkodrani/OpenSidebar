import React from "react";
import { useTaskUiState } from "../task-ui-state";
import { PlanStrip } from "./PlanStrip";
import { PrimaryTaskRail } from "./PrimaryTaskRail";
import { StalledRecoveryCard } from "./StalledRecoveryCard";
import { SkillRecordingPanel } from "./WebsiteSkillsDrawer";

interface TaskStatusRegionProps {
  isPlanExpanded: boolean;
  onTogglePlan: () => void;
  onSkillRecordingHelp: () => void;
}

export function TaskStatusRegion({
  isPlanExpanded,
  onTogglePlan,
  onSkillRecordingHelp,
}: TaskStatusRegionProps) {
  const taskUi = useTaskUiState();

  return (
    <section
      className="shrink-0"
      data-task-phase={taskUi.phase}
      aria-label="Task status"
    >
      {taskUi.showPlanStrip ? (
        <PlanStrip isExpanded={isPlanExpanded} onToggle={onTogglePlan} />
      ) : null}
      {taskUi.showPrimaryRail ? <PrimaryTaskRail /> : null}
      {taskUi.showStalledRecovery ? <StalledRecoveryCard /> : null}
      <SkillRecordingPanel onHelp={onSkillRecordingHelp} />
    </section>
  );
}
