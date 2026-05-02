import { SubtaskSummary } from "../../types";
import type { PlanStatus } from "./context-types";
import type { PlanStep } from "./planner";

type PlanStatusSubtask = PlanStatus["subtasks"][number];

export function buildPlanStatusSnapshot(args: {
  existingPlan: PlanStatus | null;
  planSubtasks: SubtaskSummary[];
  planSteps: Pick<PlanStep, "verifyAfter" | "toolProfile">[];
  currentIndex: number;
}): {
  subtasks: PlanStatusSubtask[];
  repairedIndex: number | null;
} {
  const subtasks = args.planSubtasks.map((subtask, idx) => {
    const existingSubtask = args.existingPlan?.subtasks[idx];
    const planStep = args.planSteps[idx];
    const verificationGate =
      existingSubtask?.verificationGate ?? planStep?.verifyAfter;
    const toolProfile = existingSubtask?.toolProfile ?? planStep?.toolProfile;

    return {
      description: subtask.description,
      status: subtask.status,
      completedAtUrl: subtask.completedAtUrl,
      result: subtask.result,
      ...(verificationGate ? { verificationGate } : {}),
      ...(toolProfile ? { toolProfile } : {}),
    };
  });

  if (
    subtasks.some((subtask) => subtask.status === "running") ||
    args.currentIndex >= subtasks.length
  ) {
    return { subtasks, repairedIndex: null };
  }

  const repairedIndex = subtasks.findIndex(
    (subtask) => subtask.status !== "completed",
  );
  if (repairedIndex < 0) return { subtasks, repairedIndex: null };

  subtasks[repairedIndex].status = "running";
  return { subtasks, repairedIndex };
}
