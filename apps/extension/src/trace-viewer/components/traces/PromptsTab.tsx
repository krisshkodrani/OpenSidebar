import React, { useState } from "react";
import type { TraceSession } from "../../../types/traces";
import Tooltip from "../Tooltip";

interface PromptsTabProps {
  session: TraceSession;
}

export default function PromptsTab(_props: PromptsTabProps) {
  return (
    <div className="space-y-4">
      <SystemPromptEvolution />
      <MessageFlow />
    </div>
  );
}

function SystemPromptEvolution() {
  // In a real implementation, we'd extract system prompts from entries
  // For now, show a placeholder
  return (
    <div className="bg-trace-panel border border-trace-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] text-trace-muted uppercase tracking-wide">
          System Prompt Evolution
        </div>
        <Tooltip content="How the system prompt changed across turns">
          <span className="text-[10px] text-trace-muted cursor-help">ⓘ</span>
        </Tooltip>
      </div>
      <div className="text-sm text-trace-muted">
        System prompt evolution tracking coming soon. This will show:
        <ul className="list-disc list-inside mt-2 space-y-1 text-[12px]">
          <li>System prompt from first turn</li>
          <li>Changes in subsequent turns (diff view)</li>
          <li>Cached vs dynamic split visualization</li>
          <li>Token count for each section</li>
        </ul>
      </div>
    </div>
  );
}

function MessageFlow() {
  const [filter, setFilter] = useState<
    "all" | "system" | "user" | "assistant" | "tool"
  >("all");
  const [searchTerm, setSearchTerm] = useState("");

  return (
    <div className="bg-trace-panel border border-trace-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] text-trace-muted uppercase tracking-wide">
          Message Flow
        </div>
        <div className="flex gap-1">
          {(["all", "system", "user", "assistant", "tool"] as const).map(
            (f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                  filter === f
                    ? "bg-trace-accent text-white border-trace-accent"
                    : "bg-transparent text-trace-muted border-trace-border hover:text-trace-text"
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ),
          )}
        </div>
      </div>

      <div className="mb-3">
        <input
          type="text"
          placeholder="Search messages..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-3 py-1.5 text-[12px] bg-trace-bg border border-trace-border rounded focus:outline-none focus:border-trace-accent"
        />
      </div>

      <div className="text-sm text-trace-muted">
        Message flow visualization coming soon. This will show:
        <ul className="list-disc list-inside mt-2 space-y-1 text-[12px]">
          <li>Collapsible thread view of all messages</li>
          <li>Filter by role (system/user/assistant/tool)</li>
          <li>Search within messages</li>
          <li>Token estimates per message</li>
        </ul>
      </div>
    </div>
  );
}
