import React from "react";
import { AgentStatus } from "../../types";
import { useStore } from "../store";
import { clsx } from "clsx";

export function StatusBar() {
  const status = useStore((s) => s.agentStatus);
  const detail = useStore((s) => s.statusDetail);

  const getStatusColor = (status: AgentStatus) => {
    switch (status) {
      case AgentStatus.THINKING:
        return "bg-blue-500 shadow-blue-500/50";
      case AgentStatus.ACTING:
        return "bg-green-500 shadow-green-500/50";
      case AgentStatus.ERROR:
        return "bg-red-500 shadow-red-500/50";
      default:
        return "bg-warm-400";
    }
  };

  const isActive =
    status === AgentStatus.THINKING || status === AgentStatus.ACTING;

  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="relative flex items-center justify-center w-2 h-2">
        <span
          className={clsx(
            "w-2 h-2 rounded-full transition-colors duration-300",
            getStatusColor(status),
            isActive && "animate-pulse",
          )}
        />
        {isActive && (
          <span
            className={clsx(
              "absolute w-full h-full rounded-full animate-ping opacity-75",
              getStatusColor(status),
            )}
          />
        )}
      </div>

      <div className="flex flex-col leading-tight">
        <span
          className={clsx(
            "font-medium transition-colors duration-300 uppercase tracking-wider text-[10px]",
            status === AgentStatus.ERROR
              ? "text-red-500"
              : "text-warm-500 dark:text-warm-400",
          )}
        >
          {status}
        </span>
        {detail && status !== AgentStatus.IDLE && (
          <span
            className="text-[10px] text-warm-400 dark:text-warm-500 max-w-[120px] truncate transition-colors duration-300"
            title={detail}
          >
            {detail}
          </span>
        )}
      </div>
    </div>
  );
}
