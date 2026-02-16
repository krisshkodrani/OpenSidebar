import { PlanGuardian } from "../agent/guardian";
import { TaskNode } from "./types";
import { logger } from "../../utils";

export class OrchestratorPlanner {
  private guardian: PlanGuardian;

  constructor(openRouterApiKey: string, cerebrasApiKey?: string) {
    this.guardian = new PlanGuardian(openRouterApiKey, cerebrasApiKey);
  }

  async buildNodes(
    query: string,
    pageTitle: string,
    pageUrl: string,
    signal?: AbortSignal,
  ): Promise<TaskNode[]> {
    const decomposition = await this.guardian.decompose(
      query,
      pageTitle,
      pageUrl,
      signal,
    );

    const subtasks = decomposition?.subtasks?.length
      ? decomposition.subtasks
      : [query];

    logger.info("orchestrator", "Planner generated nodes", {
      count: subtasks.length,
    });

    return subtasks.map((description) => ({
      id: crypto.randomUUID(),
      description,
      status: "pending" as const,
      retries: 0,
    }));
  }
}
