/**
 * plan_monitor phase (RFC LP-16 Phase 3, extending the LP-15 Phase 11 turn machine).
 *
 * Every second turn while a plan is active and the page has been interpreted,
 * ask the plan monitor whether the agent is still aligned with its plan: on a
 * "deviated" verdict (within the replan budget) hand off to the deviation
 * handler; on a "blocked" verdict inject the blocker as a user message; aligned
 * / progressing needs no action. Extracted verbatim from loop() — every member
 * is a real AgentLoop field/method, so loop() passes `this`; only the turn-local
 * `tabId` is threaded in. Returns void (this phase never ends the task).
 */

import type { ContextManager } from "../context";
import type { RuntimeLimits } from "../constants";
import type { PlanStep, PlanMonitorResult } from "../planner";
import type { PerceptionScreenshotState } from "../../perception/perception-screenshot-state";

export interface PlanMonitorPhaseHost {
  turnsSinceLastMonitor: number;
  readonly taskId: string | null;
  readonly planSteps: PlanStep[];
  readonly perception: PerceptionScreenshotState;
  readonly abortController: AbortController | null;
  readonly replanCount: number;
  readonly limits: RuntimeLimits;
  readonly context: ContextManager;
  runPlanMonitor(signal?: AbortSignal): Promise<PlanMonitorResult | null>;
  handlePlanDeviation(
    monitorResult: PlanMonitorResult,
    tabId: number,
    signal?: AbortSignal,
  ): Promise<void>;
}

export async function runPlanMonitorPhase(
  host: PlanMonitorPhaseHost,
  tabId: number,
): Promise<void> {
  // Plan monitor: check alignment every 2 turns when plan is active
  host.turnsSinceLastMonitor++;
  if (
    host.taskId &&
    host.planSteps.length > 0 &&
    host.turnsSinceLastMonitor >= 2 &&
    host.perception.getInterpretation() &&
    !host.abortController?.signal.aborted
  ) {
    host.turnsSinceLastMonitor = 0;
    const monitorResult = await host.runPlanMonitor(
      host.abortController?.signal,
    );
    if (monitorResult) {
      if (
        monitorResult.alignment === "deviated" &&
        host.replanCount < host.limits.maxReplans
      ) {
        await host.handlePlanDeviation(
          monitorResult,
          tabId,
          host.abortController?.signal,
        );
      } else if (
        monitorResult.alignment === "blocked" &&
        monitorResult.blocker
      ) {
        host.context.addMessage({
          role: "user",
          content: `[Plan Monitor]: Blocker detected — ${monitorResult.blocker}. Address this before continuing with the current step.`,
        });
      }
      // aligned/progressing → no action needed
    }
  }
}
