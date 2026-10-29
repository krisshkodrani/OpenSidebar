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
      return <Clock size={12} className="text-accent-text animate-pulse" />;
    return <CheckCircle size={12} className="text-success" />;
  };

  const argsDisplay =
    typeof tool.args === "string"
      ? tool.args
      : JSON.stringify(tool.args, null, 2);

  return (
    <div className="border border-line rounded-lg bg-canvas overflow-hidden text-ui-control">
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="flex items-center gap-2 w-full p-2 hover:bg-surface-subtle text-left transition-colors"
      >
        {isOpen ? (
          <ChevronDown size={12} className="text-fg-tertiary shrink-0" />
        ) : (
          <ChevronRight size={12} className="text-fg-tertiary shrink-0" />
        )}

        <span className="font-mono font-medium text-fg-secondary">
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
        <div className="p-2.5 border-t border-line font-mono text-ui-caption bg-surface-subtle">
          <div className="mb-1 text-fg-tertiary font-semibold uppercase tracking-wider text-ui-caption">
            Input
          </div>
          <pre className="overflow-x-auto p-2 rounded bg-surface-subtle text-fg border border-line mb-2">
            {argsDisplay}
          </pre>

          {tool.result && (
            <>
              <div className="mb-1 text-fg-tertiary font-semibold uppercase tracking-wider text-ui-caption">
                Output
              </div>
              <pre className="overflow-x-auto p-2 rounded bg-canvas text-fg-secondary border border-line max-h-40">
                {tool.result}
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
