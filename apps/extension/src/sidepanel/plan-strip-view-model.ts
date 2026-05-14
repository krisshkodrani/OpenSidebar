import type {
  PendingPlanConfirmation,
  TaskProgressMessage,
} from "../types";
import { derivePlanRows, type PlanRow } from "./plan-board-view";

export type PlanStripMode = "planning" | "confirmation" | "progress";

export interface PlanStripViewModel {
  mode: PlanStripMode | null;
  rows: PlanRow[];
  currentIndex: number;
  canSkip: boolean;
  barClassName: string;
}

export function formatPlanElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m${remainingSeconds}s`;
}

export function derivePlanStripViewModel({
  isPlanning,
  pendingPlan,
  taskProgress,
}: {
  isPlanning: boolean;
  pendingPlan: PendingPlanConfirmation | null;
  taskProgress: TaskProgressMessage["payload"] | null;
}): PlanStripViewModel {
  const rows = derivePlanRows(taskProgress, null);
  const mode: PlanStripMode | null = pendingPlan
    ? "confirmation"
    : taskProgress
      ? "progress"
      : isPlanning
        ? "planning"
        : null;

  return {
    mode,
    rows,
    currentIndex: taskProgress?.currentIndex ?? 0,
    canSkip: mode === "progress" && rows.some((row) => row.status === "running"),
    barClassName:
      mode === "confirmation"
        ? "bg-primary-50/40 dark:bg-primary-900/10 border-primary-200 dark:border-primary-800"
        : "bg-warm-50/60 dark:bg-warm-900/15 border-warm-200 dark:border-warm-700",
  };
}
