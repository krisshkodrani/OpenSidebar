import React from "react";
import type {
  TraceLLMMessage,
  TraceContextMetrics,
} from "../../../types/traces";
import CollapsibleSection from "../CollapsibleSection";
import TurnLLMMessage from "./TurnLLMMessage";
import { formatTokens } from "../../utils";

interface TurnLLMInputSectionProps {
  messages: TraceLLMMessage[];
  contextMetrics?: TraceContextMetrics;
}

export default function TurnLLMInputSection({
  messages,
  contextMetrics: cm,
}: TurnLLMInputSectionProps) {
  if (!messages || messages.length === 0) return null;

  const utilPct = cm ? Math.round((cm.utilization || 0) * 100) : 0;
  const utilColor =
    utilPct < 60
      ? "bg-[#2ecc71]"
      : utilPct < 85
        ? "bg-[#f1c40f]"
        : "bg-[#e74c3c]";

  const label = (
    <>
      LLM Input ({messages.length} messages
      {cm && <> &middot; {utilPct}% context</>})
    </>
  );

  let firstUserSeen = false;

  return (
    <CollapsibleSection label={label} className="mb-2.5">
      {cm && (
        <div className="flex flex-wrap gap-2 items-center p-2 mt-1.5 bg-[rgba(41,37,36,0.6)] rounded text-[11px] font-mono text-trace-subtle">
          <span>
            <span className="text-trace-muted">System:</span>{" "}
            {formatTokens(cm.systemTokens)}
          </span>
          <span>
            <span className="text-trace-muted">History:</span>{" "}
            {formatTokens(cm.historyTokens)}
          </span>
          <span>
            <span className="text-trace-muted">Total:</span>{" "}
            {formatTokens(cm.totalTokens)}/{formatTokens(cm.maxTokens)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-20 h-1.5 bg-[rgba(68,64,60,0.6)] rounded-[3px] overflow-hidden">
              <span
                className={`block h-full rounded-[3px] transition-all ${utilColor}`}
                style={{ width: `${Math.min(utilPct, 100)}%` }}
              />
            </span>
            {utilPct}%
          </span>
          {(cm.droppedMessageCount || 0) > 0 && (
            <span className="text-[#e67e22]">
              Dropped: {cm.droppedMessageCount}
            </span>
          )}
          {cm.compressionLevel && cm.compressionLevel !== "none" && (
            <span>
              <span className="text-trace-muted">Compress:</span>{" "}
              {cm.compressionLevel}
            </span>
          )}
        </div>
      )}
      <div className="mt-1.5">
        {messages.map((msg, i) => {
          const isFirstUser = msg.role === "user" && !firstUserSeen;
          if (isFirstUser) firstUserSeen = true;
          return (
            <TurnLLMMessage
              key={i}
              msg={msg}
              cachedPrefixLength={cm?.cachedPrefixLength}
              isFirstUser={isFirstUser}
            />
          );
        })}
      </div>
    </CollapsibleSection>
  );
}
