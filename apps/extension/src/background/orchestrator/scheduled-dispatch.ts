import { orchestrator } from "./index";

export async function startScheduledOrchestratorTask(input: Parameters<typeof orchestrator.startTask>[0]): Promise<void> {
  await orchestrator.startTask(input);
}

export async function waitForScheduledTaskCompletion(
  workspaceId: string,
  timeoutMs?: number,
) {
  return orchestrator.waitForTaskCompletion(workspaceId, timeoutMs);
}
