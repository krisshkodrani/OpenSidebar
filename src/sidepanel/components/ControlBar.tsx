import React from "react";
import { useStore } from "../store";
import { AgentStatus } from "../../types";
import { Loader2 } from "lucide-react";

export function ControlBar() {
    const status = useStore(s => s.agentStatus);
    const detail = useStore(s => s.statusDetail);

    if (status === AgentStatus.IDLE) return null;

    const isError = status === AgentStatus.ERROR;

    return (
        <div className="px-4 py-1.5 bg-primary-50 dark:bg-primary-900/20 border-t border-primary-100 dark:border-primary-900/50 flex items-center gap-2 text-xs">
            {isError ? (
                <div className="w-2 h-2 bg-red-500 rounded-full shrink-0" />
            ) : (
                <Loader2 size={12} className="text-primary-600 animate-spin shrink-0" />
            )}
            <span className="text-primary-700 dark:text-primary-300 truncate">
                {detail}
            </span>
        </div>
    );
}
