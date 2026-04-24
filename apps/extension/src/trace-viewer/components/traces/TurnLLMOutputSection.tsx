import React, { useState } from "react";
import CollapsibleSection from "../CollapsibleSection";
import Badge from "../Badge";
import { truncate } from "../../utils";

/** Renders content with <think>...</think> blocks styled distinctly */
function StyledContent({ text }: { text: string }) {
  const parts: { type: "text" | "think"; content: string }[] = [];
  const re = /<think>([\s\S]*?)<\/think>/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ type: "text", content: text.slice(lastIndex, m.index) });
    }
    parts.push({ type: "think", content: m[1] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", content: text.slice(lastIndex) });
  }
  // If no think blocks found, render as plain text
  if (parts.length === 1 && parts[0].type === "text") {
    return <>{text}</>;
  }
  return (
    <>
      {parts.map((p, i) =>
        p.type === "think" ? (
          <div
            key={i}
            className="border-l-2 border-brand-live/60 bg-brand-live/10 pl-2.5 py-1.5 my-1 rounded-r"
          >
            <span className="text-[10px] font-semibold text-brand-live uppercase tracking-wider">
              Thinking
            </span>
            <div className="mt-0.5 text-brand-live/80 italic">{p.content}</div>
          </div>
        ) : (
          <span key={i}>{p.content}</span>
        ),
      )}
    </>
  );
}

interface ToolCall {
  function?: { name?: string; arguments?: string };
}

interface TurnLLMOutputSectionProps {
  content: string | null;
  toolCalls: ToolCall[];
}

export default function TurnLLMOutputSection({
  content,
  toolCalls,
}: TurnLLMOutputSectionProps) {
  if (!content && toolCalls.length === 0) return null;

  const hasContent = !!content;
  const hasCalls = toolCalls.length > 0;
  const isLong = (content?.length ?? 0) > 300 || toolCalls.length > 2;

  const body = (
    <div className="mt-1.5">
      {hasContent && (
        <div className="p-2.5 bg-trace-accent/[0.06] rounded text-xs leading-relaxed text-trace-subtle whitespace-pre-wrap break-words font-mono max-h-[400px] overflow-y-auto scrollbar-thin">
          <StyledContent text={content!} />
        </div>
      )}
      {hasCalls && (
        <div className={hasContent ? "mt-2" : ""}>
          {toolCalls.map((tc, i) => (
            <ToolCallRequest key={i} tc={tc} />
          ))}
        </div>
      )}
    </div>
  );

  if (isLong) {
    const preview = content
      ? truncate(content, 80)
      : `${toolCalls.length} tool call${toolCalls.length > 1 ? "s" : ""}`;

    return (
      <CollapsibleSection
        label={`LLM Output${hasCalls ? ` (${toolCalls.length} call${toolCalls.length > 1 ? "s" : ""})` : ""}`}
        preview={preview}
        className="mb-2.5"
        maxHeightClass="sm"
      >
        {body}
      </CollapsibleSection>
    );
  }

  return (
    <div className="mb-2.5">
      <div className="text-[11px] font-semibold text-trace-muted uppercase tracking-wider mb-1.5">
        LLM Output
      </div>
      {body}
    </div>
  );
}

function ToolCallRequest({ tc }: { tc: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const name = tc.function?.name || "unknown";
  let argsStr = "";
  try {
    argsStr = JSON.stringify(
      JSON.parse(tc.function?.arguments || "{}"),
      null,
      2,
    );
  } catch {
    argsStr = tc.function?.arguments || "";
  }
  const hasArgs = argsStr && argsStr !== "{}";

  return (
    <div className="bg-trace-accent/[0.04] border border-trace-accent/[0.12] rounded p-2 mb-1.5">
      <div className="flex items-center gap-2">
        <Badge variant="tool">{name}</Badge>
        {hasArgs && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-trace-muted hover:text-trace-subtle cursor-pointer bg-transparent border-none p-0"
          >
            {expanded ? "hide args" : "show args"}
          </button>
        )}
      </div>
      {hasArgs && expanded && (
        <div className="text-[11px] font-mono text-trace-subtle bg-trace-accent/[0.05] p-1.5 rounded mt-1.5 whitespace-pre-wrap break-all leading-normal max-h-[200px] overflow-y-auto scrollbar-thin">
          {argsStr}
        </div>
      )}
    </div>
  );
}
