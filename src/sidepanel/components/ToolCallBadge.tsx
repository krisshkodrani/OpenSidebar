import React, { useId, useState, useRef, useEffect } from "react";
import { ToolCallSummary } from "../../types";
import { ChevronDown, ChevronRight, CheckCircle, Clock } from "lucide-react";

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

  const StatusIcon = () => {
    if (!tool.result)
      return <Clock size={12} className="text-primary-500 animate-pulse" />;
    return <CheckCircle size={12} className="text-green-500" />;
  };

  const argsDisplay =
    typeof tool.args === "string"
      ? tool.args
      : JSON.stringify(tool.args, null, 2);

  return (
    <div className="border border-warm-200 dark:border-warm-700 rounded-lg bg-warm-50 dark:bg-warm-900 overflow-hidden text-xs">
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="flex items-center gap-2 w-full p-2 hover:bg-warm-100 dark:hover:bg-warm-800 text-left transition-colors"
      >
        {isOpen ? (
          <ChevronDown size={12} className="text-warm-400 shrink-0" />
        ) : (
          <ChevronRight size={12} className="text-warm-400 shrink-0" />
        )}

        <span className="font-mono font-medium text-warm-700 dark:text-warm-200">
          {tool.toolName}
        </span>

        <div className="ml-auto">
          <StatusIcon />
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
        <div className="p-2.5 border-t border-warm-200 dark:border-warm-700 font-mono text-[11px] bg-warm-100/50 dark:bg-warm-950/50">
          <div className="mb-1 text-warm-500 font-semibold uppercase tracking-wider text-[10px]">
            Input
          </div>
          <pre className="overflow-x-auto p-2 rounded bg-warm-100 dark:bg-warm-900 text-warm-800 dark:text-warm-300 border border-warm-200 dark:border-warm-800 mb-2">
            {argsDisplay}
          </pre>

          {tool.result && (
            <>
              <div className="mb-1 text-warm-500 font-semibold uppercase tracking-wider text-[10px]">
                Output
              </div>
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
