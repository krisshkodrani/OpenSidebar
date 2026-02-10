import React, { useId, useState } from "react";
import { ToolCallSummary } from "../../types";
import { ChevronDown, ChevronRight, Terminal, CheckCircle, Clock } from "lucide-react";
import { clsx } from "clsx";

interface Props {
    tool: ToolCallSummary;
    defaultOpen?: boolean;
}

export function ToolCallBadge({ tool, defaultOpen = false }: Props) {
    const [isOpen, setIsOpen] = useState(defaultOpen);
    const panelId = useId();

    const getRiskColor = (level: string) => {
        switch (level) {
            case "high": return "bg-red-500";
            case "medium": return "bg-yellow-500";
            case "low": return "bg-green-500";
            default: return "bg-gray-400";
        }
    };

    const StatusIcon = () => {
        if (!tool.result) return <Clock size={12} className="text-blue-500 animate-pulse" />;
        return <CheckCircle size={12} className="text-green-500" />;
    };

    // Format args for display
    const argsDisplay = typeof tool.args === 'string'
        ? tool.args
        : JSON.stringify(tool.args, null, 2);

    return (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 overflow-hidden text-xs shadow-sm transition-all hover:shadow-md">
            <button
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
                aria-controls={panelId}
                className="flex items-center gap-2 w-full p-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 text-left transition-colors"
            >
                {isOpen ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}

                <div className="flex items-center justify-center w-6 h-6 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                    <Terminal size={14} />
                </div>

                <span className="font-mono font-medium text-gray-700 dark:text-gray-200">{tool.toolName}</span>

                <div className="ml-auto flex items-center gap-3">
                    <StatusIcon />
                    <div
                        className={clsx("w-2 h-2 rounded-full", getRiskColor(tool.riskLevel))}
                        title={`Risk Level: ${tool.riskLevel}`}
                    />
                    <span className="sr-only">Risk level: {tool.riskLevel}</span>
                </div>
            </button>

            {isOpen && (
                <div
                    id={panelId}
                    role="region"
                    aria-label={`${tool.toolName} details`}
                    className="p-3 border-t border-gray-200 dark:border-gray-700 font-mono text-[11px] bg-gray-50 dark:bg-gray-950/50"
                >
                    <div className="mb-1 text-gray-500 font-semibold uppercase tracking-wider text-[10px]">Input</div>
                    <pre className="overflow-x-auto p-2 rounded bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-300 border border-gray-200 dark:border-gray-800 mb-3">
                        {argsDisplay}
                    </pre>

                    {tool.result && (
                        <>
                            <div className="mb-1 text-gray-500 font-semibold uppercase tracking-wider text-[10px]">Output</div>
                            <pre className="overflow-x-auto p-2 rounded bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-800 max-h-40">
                                {tool.result}
                            </pre>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
