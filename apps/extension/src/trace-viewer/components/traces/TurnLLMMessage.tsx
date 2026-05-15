import React, { useState } from "react";
import type { TraceLLMMessage } from "../../../types/traces";
import Badge from "../Badge";
import { truncate, formatTokens } from "../../utils";
import { useStore } from "../../store";

interface LLMMessageProps {
  msg: TraceLLMMessage;
  cachedPrefixLength?: number;
  isFirstUser: boolean;
  turnNumber?: number;
}

export default function TurnLLMMessage({
  msg,
  cachedPrefixLength,
  isFirstUser,
  turnNumber,
}: LLMMessageProps) {
  const [open, setOpen] = useState(false);
  const navigateToPerception = useStore((s) => s.navigateToPerception);
  const role = msg.role || "unknown";
  const contentText = msg.content || "";

  // Render [image] placeholders as clickable links to perception tab
  const renderContent = (text: string) => {
    if (!text.includes("[image]") || turnNumber == null) return text;
    const parts = text.split("[image]");
    return parts.map((part, i) => (
      <React.Fragment key={i}>
        {part}
        {i < parts.length - 1 && (
          <button
            type="button"
            className="text-trace-accent-light hover:underline cursor-pointer"
            onClick={() => navigateToPerception(turnNumber)}
            title="View screenshot in Perception tab"
          >
            [image &rarr;]
          </button>
        )}
      </React.Fragment>
    ));
  };
  const toolCalls = msg.tool_calls;

  let tokEst = Math.ceil(contentText.length / 4);
  if (toolCalls) tokEst += Math.ceil(JSON.stringify(toolCalls).length / 4);

  // Build preview
  let preview = "";
  if (role === "system") {
    preview = "System prompt";
  } else if (role === "assistant") {
    if (toolCalls && toolCalls.length > 0) {
      preview = `${toolCalls.length} tool call${toolCalls.length > 1 ? "s" : ""}`;
      const names = toolCalls.slice(0, 3).map((tc) => tc.function?.name || "?");
      preview += `: ${names.join(", ")}`;
    } else {
      preview = truncate(contentText, 80);
    }
  } else if (role === "tool") {
    preview = `call: ${(msg.tool_call_id || "?").slice(0, 12)}`;
    if (contentText) preview += ` — ${truncate(contentText, 60)}`;
  } else {
    preview = truncate(contentText, 80);
  }

  const hasCachedSplit =
    role === "system" &&
    cachedPrefixLength &&
    cachedPrefixLength > 0 &&
    contentText.length > cachedPrefixLength;

  return (
    <div className="border border-trace-accent/[0.12] rounded mb-1 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2 py-[5px] cursor-pointer text-[11px] text-trace-subtle transition-colors hover:bg-trace-accent/[0.08] text-left"
      >
        <span
          className={`text-[9px] shrink-0 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        >
          &#9654;
        </span>
        <Badge variant={`role-${role}` as `role-${string}`}>{role}</Badge>
        {role === "user" && isFirstUser && (
          <Badge variant="original-query">Original Query</Badge>
        )}
        {role === "system" && cachedPrefixLength && cachedPrefixLength > 0 && (
          <>
            <Badge variant="cached">cached: {cachedPrefixLength}</Badge>
            <Badge variant="dynamic">
              dynamic: {Math.max(0, contentText.length - cachedPrefixLength)}
            </Badge>
          </>
        )}
        <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-trace-muted">
          {preview}
        </span>
        <span
          className="shrink-0 font-mono text-trace-subtle text-[10px]"
          title="Estimated from character count"
        >
          ~{formatTokens(tokEst)} tok
        </span>
      </button>
      <div className={`collapsible ${open ? "open" : ""}`}>
        {hasCachedSplit ? (
          <div className="p-2 text-[11px] font-mono text-trace-subtle whitespace-pre-wrap break-words leading-normal max-h-[500px] overflow-y-auto scrollbar-thin bg-trace-accent/[0.04]">
            {renderContent(contentText.slice(0, cachedPrefixLength!))}
            <div className="border-t-2 border-dashed border-state-warning/50 my-1 pt-1 text-[10px] text-state-warning font-semibold tracking-wide">
              -- Dynamic Context (changes per turn) --
            </div>
            {renderContent(contentText.slice(cachedPrefixLength!))}
          </div>
        ) : (
          <div className="p-2 text-[11px] font-mono text-trace-subtle whitespace-pre-wrap break-words leading-normal max-h-[500px] overflow-y-auto scrollbar-thin bg-trace-accent/[0.04]">
            {renderContent(contentText)}
            {toolCalls && toolCalls.length > 0 && (
              <>
                {"\n\n"}[Tool Calls]{"\n"}
                {JSON.stringify(toolCalls, null, 2)}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
