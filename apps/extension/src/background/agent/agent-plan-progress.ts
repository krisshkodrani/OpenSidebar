import { SubtaskSummary } from "../../types";
import type { PlanStatus } from "./context-types";
import type { PlanStep } from "./planner";

type PlanStatusSubtask = PlanStatus["subtasks"][number];
type MutablePlanSubtask = Pick<
  SubtaskSummary,
  "status" | "result" | "completedAtUrl"
>;

export function buildPlanStatusEntries(args: {
  existingPlan?: PlanStatus | null;
  planSubtasks: SubtaskSummary[];
  planSteps: Pick<PlanStep, "verifyAfter" | "toolProfile">[];
}): PlanStatusSubtask[] {
  return args.planSubtasks.map((subtask, idx) => {
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
}

export function buildPlanStatusSnapshot(args: {
  existingPlan: PlanStatus | null;
  planSubtasks: SubtaskSummary[];
  planSteps: Pick<PlanStep, "verifyAfter" | "toolProfile">[];
  currentIndex: number;
}): {
  subtasks: PlanStatusSubtask[];
  repairedIndex: number | null;
} {
  const subtasks = buildPlanStatusEntries({
    existingPlan: args.existingPlan,
    planSubtasks: args.planSubtasks,
    planSteps: args.planSteps,
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

export function replacePlanFromIndex(args: {
  subtasks: SubtaskSummary[];
  steps: PlanStep[];
  fromIndex: number;
  replacementSteps: PlanStep[];
}): { subtasks: SubtaskSummary[]; steps: PlanStep[] } {
  const keptSubtasks = args.subtasks.slice(0, args.fromIndex);
  const replacementSubtasks: SubtaskSummary[] = args.replacementSteps.map(
    (step, i) => ({
      description: step.objective,
      status: i === 0 ? "running" : "pending",
      turnsUsed: 0,
      turnBudget: 0,
    }),
  );

  return {
    subtasks: [...keptSubtasks, ...replacementSubtasks],
    steps: [...args.steps.slice(0, args.fromIndex), ...args.replacementSteps],
  };
}

export function advanceCompletedPlanSubtasks(args: {
  subtasks: MutablePlanSubtask[];
  captureResult: () => string;
  completedAtUrl?: string;
  lastPlanIndex: number;
}): { currentIndex: number; planIndexChanged: boolean } {
  let advancedTo = 0;
  for (let i = 0; i < args.subtasks.length; i++) {
    const subtask = args.subtasks[i];
    if (subtask.status === "completed") {
      advancedTo = i + 1;
      continue;
    }
    if (subtask.status === "running") {
      subtask.status = "completed";
      subtask.result = subtask.result || args.captureResult();
      subtask.completedAtUrl = args.completedAtUrl;
      advancedTo = i + 1;
      continue;
    }
    break;
  }

  if (advancedTo < args.subtasks.length) {
    args.subtasks[advancedTo].status = "running";
  }

  return {
    currentIndex: advancedTo,
    planIndexChanged: advancedTo !== args.lastPlanIndex,
  };
}

export function completeSinglePlanSubtask(args: {
  subtasks: MutablePlanSubtask[];
  currentIndex: number;
  captureResult: () => string;
  completedAtUrl?: string;
  lastPlanIndex: number;
}): { currentIndex: number; planIndexChanged: boolean } {
  if (args.currentIndex < 0 || args.currentIndex >= args.subtasks.length) {
    return {
      currentIndex: args.currentIndex,
      planIndexChanged: false,
    };
  }

  const target = args.subtasks[args.currentIndex];
  if (target.status !== "completed") {
    target.status = "completed";
    target.result = target.result || args.captureResult();
    target.completedAtUrl = args.completedAtUrl;
  }

  for (let i = args.currentIndex + 1; i < args.subtasks.length; i++) {
    if (args.subtasks[i].status !== "completed") {
      args.subtasks[i].status = "pending";
    }
  }

  const nextIndex = args.subtasks.findIndex(
    (subtask, idx) =>
      idx > args.currentIndex && subtask.status !== "completed",
  );
  if (nextIndex >= 0) {
    args.subtasks[nextIndex].status = "running";
  }

  const resolvedIndex =
    nextIndex >= 0 ? nextIndex : args.subtasks.length;

  return {
    currentIndex: resolvedIndex,
    planIndexChanged: resolvedIndex !== args.lastPlanIndex,
  };
}

export function completeRemainingPlanSubtasks(args: {
  subtasks: MutablePlanSubtask[];
  currentIndex: number;
  result: string;
  completedAtUrl?: string;
  lastPlanIndex: number;
}): { currentIndex: number; planIndexChanged: boolean } {
  if (args.currentIndex < 0 || args.currentIndex >= args.subtasks.length) {
    return {
      currentIndex: args.currentIndex,
      planIndexChanged: false,
    };
  }

  for (let i = args.currentIndex; i < args.subtasks.length; i++) {
    const subtask = args.subtasks[i];
    subtask.status = "completed";
    subtask.result = subtask.result || args.result;
    subtask.completedAtUrl = args.completedAtUrl;
  }

  const resolvedIndex = args.subtasks.length;

  return {
    currentIndex: resolvedIndex,
    planIndexChanged: resolvedIndex !== args.lastPlanIndex,
  };
}
