import React from "react";
import type {
  TraceLLMMessage,
  TraceContextMetrics,
  TracePromptSectionMetrics,
} from "../../../types/traces";
import CollapsibleSection from "../CollapsibleSection";
import Tooltip from "../Tooltip";
import TurnLLMMessage from "./TurnLLMMessage";
import { formatTokens } from "../../utils";

// ── Context Section Bar ────────────────────────────────────────────────────

const SECTION_DEFS: Array<{
  key: keyof TracePromptSectionMetrics;
  label: string;
  color: string;
}> = [
  { key: "pageContextChars", label: "Page", color: "bg-blue-400/70" },
  { key: "toolOutputChars", label: "Tools", color: "bg-amber-400/70" },
  { key: "workingNotesChars", label: "Notes", color: "bg-green-400/70" },
  { key: "planStatusChars", label: "Plan", color: "bg-purple-400/70" },
  { key: "distillationSummaryChars", label: "Distil.", color: "bg-cyan-400/70" },
  { key: "pageInterpretationChars", label: "Percept.", color: "bg-rose-400/70" },
  { key: "staticRulesChars", label: "Rules", color: "bg-trace-muted/40" },
];

function ContextSectionBar({ sections }: { sections: TracePromptSectionMetrics }) {
  const total = sections.systemTotalChars + sections.historyChars;
  if (!total) return null;

  const items = SECTION_DEFS
    .map((def) => ({ ...def, chars: (sections[def.key] as number) || 0 }))
    .filter((item) => item.chars > 0)
    .sort((a, b) => b.chars - a.chars);

  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.18em] text-trace-muted mb-1">
        Section breakdown
      </div>
      {/* Proportional bar */}
      <div className="flex h-2 rounded overflow-hidden w-full bg-trace-border/30">
        {items.map((item) => (
          <Tooltip
            key={item.key}
            content={`${item.label}: ${item.chars.toLocaleString()} chars (${Math.round((item.chars / total) * 100)}%)`}
          >
            <span
              className={`h-full cursor-help transition-all ${item.color}`}
              style={{ width: `${(item.chars / total) * 100}%` }}
            />
          </Tooltip>
        ))}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
        {items.slice(0, 5).map((item) => (
          <span key={item.key} className="flex items-center gap-1 text-[9px] text-trace-dim">
            <span className={`inline-block w-2 h-2 rounded-sm ${item.color}`} />
            {item.label} {Math.round((item.chars / total) * 100)}%
          </span>
        ))}
      </div>
    </div>
  );
}

interface TurnLLMInputSectionProps {
  messages: TraceLLMMessage[];
  contextMetrics?: TraceContextMetrics;
  turnNumber?: number;
}

export default function TurnLLMInputSection({
  messages,
  contextMetrics: cm,
  turnNumber,
}: TurnLLMInputSectionProps) {
  if (!messages || messages.length === 0) return null;

  const utilPct = cm ? Math.round((cm.utilization || 0) * 100) : 0;
  const utilColor =
    utilPct < 60
      ? "bg-state-success"
      : utilPct < 85
        ? "bg-state-warning"
        : "bg-state-error";

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
        <div className="p-2 mt-1.5 bg-trace-accent/[0.06] rounded text-[11px] font-mono text-trace-subtle space-y-2">
          {/* Token summary row */}
          <div className="flex flex-wrap gap-2 items-center">
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
              <span className="w-20 h-1.5 bg-trace-border rounded-[3px] overflow-hidden">
                <span
                  className={`block h-full rounded-[3px] transition-all ${utilColor}`}
                  style={{ width: `${Math.min(utilPct, 100)}%` }}
                />
              </span>
              {utilPct}%
            </span>
            {(cm.droppedMessageCount || 0) > 0 && (
              <span className="text-state-warning">
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

          {/* Prompt section breakdown bar */}
          {cm.promptSections && (
            <ContextSectionBar sections={cm.promptSections} />
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
              turnNumber={turnNumber}
            />
          );
        })}
      </div>
    </CollapsibleSection>
  );
}
