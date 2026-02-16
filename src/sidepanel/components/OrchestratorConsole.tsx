import React, { useMemo } from "react";
import { useStore } from "../store";
import { clsx } from "clsx";
import {
  buildDecisionFeed,
  ConsoleRole,
  getLatestAssistantSteps,
  inferConsoleRole,
  subtaskHealth,
} from "../orchestrator-view";

function roleTone(role: ConsoleRole): string {
  if (role === "planner") return "text-sky-700 dark:text-sky-300";
  if (role === "executor") return "text-emerald-700 dark:text-emerald-300";
  if (role === "verifier") return "text-violet-700 dark:text-violet-300";
  if (role === "policy") return "text-amber-700 dark:text-amber-300";
  return "text-warm-600 dark:text-warm-300";
}

export function OrchestratorConsole() {
  const taskProgress = useStore((s) => s.taskProgress);
  const taskRecovery = useStore((s) => s.taskRecovery);
  const taskCompletion = useStore((s) => s.taskCompletion);
  const turnProgress = useStore((s) => s.turnProgress);
  const pendingApproval = useStore((s) => s.pendingApproval);
  const messages = useStore((s) => s.messages);
  const agentStatus = useStore((s) => s.agentStatus);
  const statusDetail = useStore((s) => s.statusDetail);

  const activeRole = inferConsoleRole({
    agentStatus,
    statusDetail,
    pendingApproval,
    messages,
  });

  const currentSubtask =
    taskProgress &&
    taskProgress.currentIndex >= 0 &&
    taskProgress.currentIndex < taskProgress.subtasks.length
      ? taskProgress.subtasks[taskProgress.currentIndex]
      : null;

  const latestSteps = useMemo(() => getLatestAssistantSteps(messages), [messages]);
  const decisions = useMemo(() => buildDecisionFeed(latestSteps), [latestSteps]);
  const health = subtaskHealth(taskProgress?.subtasks ?? []);

  const hasAnyData =
    !!taskProgress || !!taskRecovery || !!taskCompletion || decisions.length > 0;

  if (!hasAnyData) return null;

  return (
    <section className="mx-3 mt-2 rounded-lg border border-warm-200 dark:border-warm-700 bg-warm-50/90 dark:bg-warm-800/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-warm-600 dark:text-warm-300">
          Orchestrator Console
        </h3>
        <div className="flex items-center gap-2 text-[10px]">
          <span className={clsx("font-semibold uppercase tracking-wide", roleTone(activeRole))}>
            {activeRole}
          </span>
          {turnProgress && (
            <span className="tabular-nums text-warm-500 dark:text-warm-400">
              turn {turnProgress.turn}/{turnProgress.maxTurns}
            </span>
          )}
          {turnProgress?.provider && (
            <span className="rounded bg-warm-100 dark:bg-warm-900 px-1.5 py-0.5 text-warm-500 dark:text-warm-400">
              {turnProgress.provider}
            </span>
          )}
        </div>
      </div>

      {(taskRecovery || pendingApproval) && (
        <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
          {taskRecovery && (
            <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-violet-700 dark:border-violet-800 dark:bg-violet-900/20 dark:text-violet-300">
              Recovered task {taskRecovery.taskId.slice(0, 8)}
            </span>
          )}
          {pendingApproval && (
            <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              Approval required
            </span>
          )}
        </div>
      )}

      {taskProgress && (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded border border-warm-200 dark:border-warm-700 p-2">
            <div className="text-[10px] uppercase tracking-wide text-warm-500 dark:text-warm-400">
              Current Node
            </div>
            <div className="mt-1 text-xs text-warm-800 dark:text-warm-100 line-clamp-2">
              {currentSubtask?.description || "No active subtask"}
            </div>
            {currentSubtask && (
              <div className="mt-1 text-[10px] text-warm-500 dark:text-warm-400 tabular-nums">
                turns {currentSubtask.turnsUsed}/{currentSubtask.turnBudget || 0}
              </div>
            )}
          </div>

          <div className="rounded border border-warm-200 dark:border-warm-700 p-2">
            <div className="text-[10px] uppercase tracking-wide text-warm-500 dark:text-warm-400">
              Dependency Health
            </div>
            <div className="mt-1 grid grid-cols-2 gap-1 text-[10px] tabular-nums">
              <span className="text-emerald-700 dark:text-emerald-300">
                done {health.completed}
              </span>
              <span className="text-sky-700 dark:text-sky-300">
                running {health.running}
              </span>
              <span className="text-red-700 dark:text-red-300">
                blocked {health.blocked}
              </span>
              <span className="text-warm-600 dark:text-warm-300">
                pending {health.pending}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="mt-2">
        <div className="text-[10px] uppercase tracking-wide text-warm-500 dark:text-warm-400">
          Recent Decisions
        </div>
        {decisions.length === 0 ? (
          <div className="mt-1 text-[11px] text-warm-500 dark:text-warm-400">
            No verifier/retry/policy decisions yet.
          </div>
        ) : (
          <div className="mt-1 space-y-1 max-h-24 overflow-y-auto">
            {decisions.map((decision) => (
              <div
                key={decision.id}
                className="flex items-start gap-2 text-[11px] leading-tight"
              >
                <span
                  className={clsx(
                    "mt-0.5 h-1.5 w-1.5 rounded-full shrink-0",
                    decision.status === "error"
                      ? "bg-red-500"
                      : decision.status === "running"
                        ? "bg-amber-500"
                        : "bg-emerald-500",
                  )}
                />
                <span className="text-warm-700 dark:text-warm-200 truncate">
                  {decision.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
