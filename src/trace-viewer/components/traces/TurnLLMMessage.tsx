import React, { useState } from "react";
import Badge from "../Badge";
import { truncate, formatTokens } from "../../utils";

interface LLMMessageProps {
  msg: Record<string, unknown>;
  cachedPrefixLength?: number;
  isFirstUser: boolean;
}

export default function TurnLLMMessage({
  msg,
  cachedPrefixLength,
  isFirstUser,
}: LLMMessageProps) {
  const [open, setOpen] = useState(false);
  const role = (msg.role as string) || "unknown";
  const contentText = (msg.content as string) || "";
  const toolCalls = msg.tool_calls as
    | Array<{ function?: { name?: string } }>
    | undefined;

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
    preview = `call: ${((msg.tool_call_id as string) || "?").slice(0, 12)}`;
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
    <div className="border border-[rgba(15,52,96,0.3)] rounded mb-1 overflow-hidden">
      <div
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-2 py-[5px] cursor-pointer text-[11px] text-trace-subtle transition-colors hover:bg-[rgba(15,52,96,0.3)]"
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
        <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[#8a8ab0]">
          {preview}
        </span>
        <span className="shrink-0 font-mono text-[#5a5a7e] text-[10px]">
          ~{formatTokens(tokEst)}
        </span>
      </div>
      <div className={`collapsible ${open ? "open" : ""}`}>
        {hasCachedSplit ? (
          <div className="p-2 text-[11px] font-mono text-[#b0b0d0] whitespace-pre-wrap break-words leading-normal max-h-[500px] overflow-y-auto scrollbar-thin bg-[rgba(26,26,46,0.4)]">
            {contentText.slice(0, cachedPrefixLength!)}
            <div className="border-t-2 border-dashed border-[rgba(230,126,34,0.5)] my-1 pt-1 text-[10px] text-[#e67e22] font-semibold tracking-wide">
              -- Dynamic Context (changes per turn) --
            </div>
            {contentText.slice(cachedPrefixLength!)}
          </div>
        ) : (
          <div className="p-2 text-[11px] font-mono text-[#b0b0d0] whitespace-pre-wrap break-words leading-normal max-h-[500px] overflow-y-auto scrollbar-thin bg-[rgba(26,26,46,0.4)]">
            {contentText}
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
