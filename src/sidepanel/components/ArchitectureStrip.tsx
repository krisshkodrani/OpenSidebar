import React, { useMemo } from "react";
import { useStore } from "../store";
import { AgentStatus, ChatEntry } from "../../types";
import { clsx } from "clsx";

function findLatestAssistantMessage(messages: ChatEntry[]): ChatEntry | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") return messages[i];
  }
  return null;
}

function Lane({
  title,
  state,
  active,
  tone = "neutral",
}: {
  title: string;
  state: string;
  active: boolean;
  tone?: "neutral" | "planner" | "executor" | "verifier" | "policy";
}) {
  const toneClass =
    tone === "planner"
      ? "border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300"
      : tone === "executor"
        ? "border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
        : tone === "verifier"
          ? "border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300"
          : tone === "policy"
            ? "border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300"
            : "border-warm-200 dark:border-warm-700 text-warm-600 dark:text-warm-300";

  return (
    <div
      className={clsx(
        "rounded-md border px-2 py-1.5 min-w-0 transition-all",
        toneClass,
        active
          ? "bg-warm-50 dark:bg-warm-800/60 shadow-sm"
          : "bg-warm-50/60 dark:bg-warm-900/40 opacity-85",
      )}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className={clsx(
            "h-1.5 w-1.5 rounded-full shrink-0",
            active ? "bg-current animate-pulse" : "bg-current opacity-60",
          )}
        />
        <span className="text-[10px] uppercase tracking-wide font-semibold truncate">
          {title}
        </span>
      </div>
      <div className="mt-0.5 text-[10px] truncate">{state}</div>
    </div>
  );
}

export function ArchitectureStrip() {
  const status = useStore((s) => s.agentStatus);
  const detail = useStore((s) => s.statusDetail);
  const pendingApproval = useStore((s) => s.pendingApproval);
  const settings = useStore((s) => s.settings);
  const messages = useStore((s) => s.messages);

  const latestAssistant = useMemo(
    () => findLatestAssistantMessage(messages),
    [messages],
  );
  const latestSteps = latestAssistant?.steps ?? [];

  const verifyingFromSteps = latestSteps.some(
    (step) =>
      step.status === "running" &&
      step.type === "thinking" &&
      step.label.toLowerCase().includes("verif"),
  );

  const plannerActive =
    status === AgentStatus.THINKING && !verifyingFromSteps;
  const executorActive =
    status === AgentStatus.ACTING && pendingApproval == null;
  const verifierActive =
    verifyingFromSteps || detail.toLowerCase().includes("verif");
  const policyActive = pendingApproval != null || settings.bypassApprovals;

  const policyState = pendingApproval
    ? "Awaiting user decision"
    : settings.bypassApprovals
      ? "Bypass enabled"
      : "Guard active";

  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
      <Lane
        title="Planner"
        state={plannerActive ? "Decomposing task" : "Standby"}
        active={plannerActive}
        tone="planner"
      />
      <Lane
        title="Executor"
        state={executorActive ? "Running tools" : "Standby"}
        active={executorActive}
        tone="executor"
      />
      <Lane
        title="Verifier"
        state={verifierActive ? "Checking outcomes" : "Standby"}
        active={verifierActive}
        tone="verifier"
      />
      <Lane
        title="Policy"
        state={policyState}
        active={policyActive}
        tone="policy"
      />
    </div>
  );
}
