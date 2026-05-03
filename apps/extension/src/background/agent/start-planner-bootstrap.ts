import type { AgentStep, SubtaskSummary } from "../../types";
import type { logger } from "../../utils";
import type { ContextManager } from "./context";
import {
  buildInitialPlanSubtasks,
  buildPlanStatusEntries,
} from "./agent-plan-progress";
import {
  type PlanDecomposition,
  type PlanStep,
  type TaskPlanner,
} from "./planner";
import type { TraceRecorder } from "./trace";
import {
  type Difficulty,
  type RuntimeLimits,
  resolveRuntimeLimits,
} from "./constants";

type PlannerBootstrapLogger = Pick<typeof logger, "info" | "warn">;

export type RuntimePlanBootstrapState = {
  difficulty: Difficulty;
  limits: RuntimeLimits;
  taskId: string | null;
  taskStartTime: number;
  planSubtasks: SubtaskSummary[];
  planSteps: PlanStep[];
  planRequiresTabManagement: boolean;
};

export type RuntimePlanBootstrapDeps = {
  initialUserText: string;
  disableInternalPlanning: boolean;
  turnCount: number;
  workspaceId: string | null;
  workerId: string | null;
  context: Pick<
    ContextManager,
    "addMessage" | "getSnapshot" | "setPlanStatus"
  >;
  planner: TaskPlanner;
  abortSignal: AbortSignal;
  perceptionInterpretation?: string;
  log: PlannerBootstrapLogger;
  traceRecorder: TraceRecorder | null;
  stepHandler: (step: AgentStep, update: boolean) => void;
  broadcastTaskProgress: (currentIndex: number, totalTurnsUsed: number) => void;
  currentState: RuntimePlanBootstrapState;
  createId?: () => string;
  now?: () => number;
};

const TAB_STEP_KEYWORDS =
  /(new tab|open.*tab|switch.*tab|close.*tab|separate tab|another tab|each tab|multiple tab|across tab)/i;

export function getPlannerDecompositionOutcome(
  decomposition: PlanDecomposition,
):
  | "structured_steps"
  | "legacy_subtasks"
  | "simple_task"
  | "insufficient_subtasks" {
  return (
    decomposition.instrumentation?.outcome ??
    (decomposition.steps
      ? "structured_steps"
      : decomposition.subtasks.length >= 2
        ? "legacy_subtasks"
        : "simple_task")
  );
}

function buildPlannerInstructionMessage(subtasks: string[]): string {
  return (
    `[Task Planner]: This is a multi-step task (${subtasks.length} steps). Your plan:\n` +
    subtasks.map((s, i) => `${i + 1}. ${s}`).join("\n") +
    `\n\nExecute step 1 now. Complete each step in order and verify progress before continuing. ` +
    `If the plan fails, revise your approach and continue from the best next step. ` +
    `Call done() when all ${subtasks.length} steps are complete.`
  );
}

export async function bootstrapRuntimePlan(
  deps: RuntimePlanBootstrapDeps,
): Promise<RuntimePlanBootstrapState> {
  const createId = deps.createId ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => Date.now());
  let state = deps.currentState;

  if (deps.disableInternalPlanning) {
    deps.log.info("agent", "Internal planning disabled for this executor run", {
      workspaceId: deps.workspaceId,
      workerId: deps.workerId,
      originalQueryPreview: deps.initialUserText.slice(0, 200),
    });
    deps.traceRecorder?.recordEvent("internal_planning_disabled", {
      workspaceId: deps.workspaceId,
      workerId: deps.workerId,
    });
    return state;
  }

  try {
    deps.stepHandler(
      {
        id: createId(),
        type: "thinking",
        label: "Analyzing task scope...",
        status: "running",
        timestamp: now(),
      },
      false,
    );

    const snapshot = deps.context.getSnapshot();
    const decomposition = await deps.planner.decompose(
      deps.initialUserText,
      snapshot?.title || "",
      snapshot?.url || "",
      deps.abortSignal,
      deps.perceptionInterpretation,
    );

    if (!decomposition) {
      deps.log.warn("agent", "Planner decomposition returned null", {
        turn: deps.turnCount,
      });
      deps.traceRecorder?.recordEvent("planner_decomposition_outcome", {
        turn: deps.turnCount,
        outcome: "null",
      });
      return state;
    }

    const outcome = getPlannerDecompositionOutcome(decomposition);
    const decompositionEvent = {
      turn: deps.turnCount,
      outcome,
      requestedMultiStep:
        decomposition.instrumentation?.requestedMultiStep ?? null,
      parsedStepCount:
        decomposition.instrumentation?.parsedStepCount ??
        decomposition.steps?.length ??
        0,
      parsedSubtaskCount:
        decomposition.instrumentation?.parsedSubtaskCount ??
        decomposition.subtasks.length,
      runtimeSubtaskCount: decomposition.subtasks.length,
    };
    deps.log.info("agent", "Planner decomposition outcome", decompositionEvent);
    deps.traceRecorder?.recordEvent(
      "planner_decomposition_outcome",
      decompositionEvent,
    );

    const limits = resolveRuntimeLimits(
      decomposition.difficulty,
      decomposition.limitOverrides,
    );
    state = {
      ...state,
      difficulty: decomposition.difficulty,
      limits,
    };

    deps.log.info("agent", "Difficulty assessment applied", {
      difficulty: state.difficulty,
      limits: state.limits,
      overrides: decomposition.limitOverrides ?? null,
    });
    deps.traceRecorder?.setDifficultyInfo({
      difficulty: state.difficulty,
      resolvedLimits: { ...state.limits },
      plannerOverrides: decomposition.limitOverrides
        ? { ...(decomposition.limitOverrides as Record<string, number>) }
        : null,
    });
    deps.traceRecorder?.setPlanDecomposition({
      subtasks: decomposition.subtasks,
      steps: (decomposition.steps ?? []).map((s) => ({
        objective: s.objective,
        successCriteria: s.successCriteria,
        dependencies: s.dependencies,
        assumptions: s.assumptions,
        ...(s.verifyAfter ? { verifyAfter: s.verifyAfter } : {}),
        ...(s.toolProfile ? { toolProfile: s.toolProfile } : {}),
        ...(s.expectedState ? { expectedState: s.expectedState } : {}),
      })),
    });

    if (decomposition.subtasks.length < 2) {
      deps.log.info(
        "agent",
        "Planner decomposition did not initialize runtime plan",
        {
          turn: deps.turnCount,
          runtimeSubtaskCount: decomposition.subtasks.length,
          outcome,
        },
      );
      deps.traceRecorder?.recordEvent("runtime_plan_status_skipped", {
        turn: deps.turnCount,
        runtimeSubtaskCount: decomposition.subtasks.length,
        outcome,
      });
      return state;
    }

    const taskId = createId();
    const taskStartTime = now();
    const planSubtasks = buildInitialPlanSubtasks(decomposition.subtasks);
    const planSteps = decomposition.steps || [];
    const planRequiresTabManagement =
      decomposition.requiresTabManagement ??
      planSteps.some((s) => TAB_STEP_KEYWORDS.test(s.objective || ""));
    state = {
      ...state,
      taskId,
      taskStartTime,
      planSubtasks,
      planSteps,
      planRequiresTabManagement,
    };

    deps.context.setPlanStatus(
      buildPlanStatusEntries({
        planSubtasks,
        planSteps,
      }),
      0,
    );
    deps.log.info("agent", "Runtime plan status initialized", {
      turn: deps.turnCount,
      subtaskCount: decomposition.subtasks.length,
      currentIndex: 0,
      toolProfiles: (decomposition.steps ?? []).map(
        (step) => step.toolProfile ?? null,
      ),
    });
    deps.traceRecorder?.recordEvent("runtime_plan_status_initialized", {
      turn: deps.turnCount,
      subtaskCount: decomposition.subtasks.length,
      currentIndex: 0,
      toolProfiles: (decomposition.steps ?? []).map(
        (step) => step.toolProfile ?? null,
      ),
    });

    deps.context.addMessage({
      role: "user",
      content: buildPlannerInstructionMessage(decomposition.subtasks),
    });

    deps.broadcastTaskProgress(0, 0);
    deps.stepHandler(
      {
        id: createId(),
        type: "info",
        label: `Plan: ${decomposition.subtasks.length} steps (${state.difficulty})`,
        status: "done",
        timestamp: now(),
      },
      false,
    );

    return state;
  } catch (err: unknown) {
    deps.log.warn("agent", "Planner decompose error (non-fatal)", {
      error: err instanceof Error ? err.message : undefined,
    });
    return state;
  }
}
