import { describe, expect, test } from "vitest";
import { emptySessionMetrics } from "../../src/background/agent/agent-telemetry";
import { OrchestratorTraceEmitter } from "../../src/background/orchestrator/trace-emitter";
import type { ProviderConfig, TokenUsage } from "../../src/background/llm/types";
import type { OrchestratorTask } from "../../src/background/orchestrator/types";

describe("planner cost tracking", () => {
  test("adds provider-reported planner charges to session metrics", () => {
    const holder: { callback?: (usage: TokenUsage, ms: number, model: string,
      provider: ProviderConfig["providerId"]) => void } = {};
    const planner = { setUsageCallback: (cb: typeof holder.callback | null) => { holder.callback = cb ?? undefined; } };
    const task = { sessionMetrics: emptySessionMetrics() } as OrchestratorTask;
    new OrchestratorTraceEmitter().attachPlannerUsage(planner, task, () => "plan_decomposition");
    expect(holder.callback).toBeDefined();
    holder.callback!({ prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, cost: 0.0003 },
      25, "openai/gpt-6-luna", "openrouter");
    expect(task.sessionMetrics.totalCost).toBe(0.0003);
    expect(task.sessionMetrics.totalCostActual).toBe(0.0003);
    expect(task.sessionMetrics.modelBreakdown["openai/gpt-6-luna"].calls).toBe(1);
  });
});
