import {
  TaskCompletionMessage,
  TaskProgressMessage,
  TaskRecoveryState,
} from "../types";

export type PlanRowStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export interface PlanRow {
  id: string;
  nodeId?: string;
  description: string;
  status: PlanRowStatus;
  turnsUsed: number;
  turnBudget?: number;
  evidenceSnippet?: string;
  selectedSkillId?: string;
  workerStatus?: NonNullable<
    TaskProgressMessage["payload"]["subtasks"][number]["workerStatus"]
  >;
  workerStatusDetail?: string;
  parallelism?: TaskProgressMessage["payload"]["subtasks"][number]["parallelism"];
  resourceSummary?: string;
}

export function derivePlanRows(
  taskProgress: TaskProgressMessage["payload"] | null,
  taskCompletion: TaskCompletionMessage["payload"] | null,
): PlanRow[] {
  if (taskProgress) {
    return taskProgress.subtasks.map((subtask, index) => ({
      id: `${taskProgress.taskId}:${index}`,
      nodeId: subtask.nodeId,
      description: subtask.description,
      status: subtask.status,
      turnsUsed: subtask.turnsUsed,
      turnBudget: subtask.turnBudget,
      evidenceSnippet: subtask.result,
      selectedSkillId: subtask.selectedSkillId,
      workerStatus: subtask.workerStatus,
      workerStatusDetail: subtask.workerStatusDetail,
      parallelism: subtask.parallelism,
      resourceSummary: subtask.resourceSummary,
    }));
  }

  if (taskCompletion) {
    return taskCompletion.subtaskResults.map((result, index) => ({
      id: `${taskCompletion.taskId}:${index}`,
      description: result.description,
      status: result.status,
      turnsUsed: result.turnsUsed,
      evidenceSnippet: result.result,
    }));
  }

  return [];
}

export function buildRecoveryHint(recovery: TaskRecoveryState): string {
  return `Continue recovered task ${recovery.taskId}. Focus on remaining ${recovery.pendingSubtasks} subtasks, verify each outcome, and only finish when evidence is explicit.`;
}
