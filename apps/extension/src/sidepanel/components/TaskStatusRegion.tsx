import React from "react";
import { useTaskUiState } from "../task-ui-state";
import { PlanStrip } from "./PlanStrip";
import { PrimaryTaskRail } from "./PrimaryTaskRail";
import { RunCard } from "./RunCard";
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

  // Status rail and the plan/step timeline share one card: status + controls on
  // top, the step timeline below, separated by a hairline. The stalled-recovery
  // alert stays a sibling — it is an intervention, not part of the run chrome.
  const showRunCard = taskUi.showPrimaryRail || taskUi.showPlanStrip;

  return (
    <section
      className="shrink-0"
      data-task-phase={taskUi.phase}
      aria-label="Task status"
    >
      {showRunCard ? (
        <RunCard running={taskUi.showAmbientActivity} tone={taskUi.rail.tone}>
          {taskUi.showPrimaryRail ? <PrimaryTaskRail embedded /> : null}
          {taskUi.showPlanStrip ? (
            <PlanStrip
              embedded
              isExpanded={isPlanExpanded}
              onToggle={onTogglePlan}
            />
          ) : null}
        </RunCard>
      ) : null}
      {taskUi.showStalledRecovery ? <StalledRecoveryCard /> : null}
      <SkillRecordingPanel onHelp={onSkillRecordingHelp} />
    </section>
  );
}
