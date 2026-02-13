import React, { useId, useState, useRef, useEffect } from "react";
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
    const contentRef = useRef<HTMLDivElement>(null);
    const [contentHeight, setContentHeight] = useState(0);

    useEffect(() => {
        if (contentRef.current) {
            setContentHeight(contentRef.current.scrollHeight);
        }
    }, [isOpen, tool.result]);

    const getRiskColor = (level: string) => {
        switch (level) {
            case "high": return "bg-red-500";
            case "medium": return "bg-yellow-500";
            case "low": return "bg-green-500";
            default: return "bg-warm-400";
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
        <div className="border border-warm-200 dark:border-warm-700 rounded-lg bg-warm-50 dark:bg-warm-900 overflow-hidden text-xs shadow-soft transition-all hover:shadow-soft-md">
            <button
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
                aria-controls={panelId}
                className="flex items-center gap-2 w-full p-2.5 hover:bg-warm-100 dark:hover:bg-warm-800 text-left transition-colors"
            >
                {isOpen ? <ChevronDown size={14} className="text-warm-400" /> : <ChevronRight size={14} className="text-warm-400" />}

                <div className="flex items-center justify-center w-6 h-6 rounded bg-warm-100 dark:bg-warm-800 text-warm-600 dark:text-warm-300">
                    <Terminal size={14} />
                </div>

                <span className="font-mono font-medium text-warm-700 dark:text-warm-200">{tool.toolName}</span>

                <div className="ml-auto flex items-center gap-3">
                    <StatusIcon />
                    <div
                        className={clsx("w-2 h-2 rounded-full", getRiskColor(tool.riskLevel))}
                        title={`Risk Level: ${tool.riskLevel}`}
                    />
                    <span className="sr-only">Risk level: {tool.riskLevel}</span>
                </div>
            </button>

            <div
                id={panelId}
                role="region"
                aria-label={`${tool.toolName} details`}
                ref={contentRef}
                className="overflow-hidden transition-[height,opacity] duration-200 ease-out"
                style={{
                    height: isOpen ? contentHeight : 0,
                    opacity: isOpen ? 1 : 0,
                }}
            >
                <div className="p-3 border-t border-warm-200 dark:border-warm-700 font-mono text-[11px] bg-warm-100/50 dark:bg-warm-950/50">
                    <div className="mb-1 text-warm-500 font-semibold uppercase tracking-wider text-[10px]">Input</div>
                    <pre className="overflow-x-auto p-2 rounded bg-warm-100 dark:bg-warm-900 text-warm-800 dark:text-warm-300 border border-warm-200 dark:border-warm-800 mb-3">
                        {argsDisplay}
                    </pre>

                    {tool.result && (
                        <>
                            <div className="mb-1 text-warm-500 font-semibold uppercase tracking-wider text-[10px]">Output</div>
                            <pre className="overflow-x-auto p-2 rounded bg-warm-50 dark:bg-warm-900 text-warm-600 dark:text-warm-400 border border-warm-200 dark:border-warm-800 max-h-40">
                                {tool.result}
                            </pre>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
