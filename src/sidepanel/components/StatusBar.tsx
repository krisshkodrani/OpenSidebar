import React from "react";
import { AgentStatus } from "../../types";
import { useStore } from "../store";
import { clsx } from "clsx";

export function StatusBar() {
    const status = useStore(s => s.agentStatus);
    const detail = useStore(s => s.statusDetail);

    const getStatusColor = (status: AgentStatus) => {
        switch (status) {
            case AgentStatus.THINKING: return "bg-blue-500 shadow-blue-500/50";
            case AgentStatus.ACTING: return "bg-green-500 shadow-green-500/50";
            case AgentStatus.ERROR: return "bg-red-500 shadow-red-500/50";
            default: return "bg-gray-400";
        }
    };

    const isActive = status === AgentStatus.THINKING || status === AgentStatus.ACTING;

    return (
        <div className="flex items-center gap-2 text-xs">
            <div className="relative flex items-center justify-center w-2 h-2">
                <span className={clsx("w-2 h-2 rounded-full", getStatusColor(status), isActive && "animate-pulse")} />
                {isActive && (
                    <span className={clsx("absolute w-full h-full rounded-full animate-ping opacity-75", getStatusColor(status))} />
                )}
            </div>

            <div className="flex flex-col leading-tight">
                <span className={clsx("font-medium transition-colors uppercase tracking-wider text-[10px]",
                    status === AgentStatus.ERROR ? "text-red-500" : "text-gray-500 dark:text-gray-400"
                )}>
                    {status}
                </span>
                {detail && status !== AgentStatus.IDLE && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 max-w-[120px] truncate" title={detail}>
                        {detail}
                    </span>
                )}
            </div>
        </div>
    );
}
