import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useStore } from "../../store";
import FilterChips from "../FilterChips";
import { useDebounce } from "../../hooks/useDebounce";
import { isoDayOffset, shortModel } from "../../utils";

interface TraceFilterPanelProps {
  onFiltersChanged: () => void;
}

export default function TraceFilterPanel({
  onFiltersChanged,
}: TraceFilterPanelProps) {
  const filters = useStore((s) => s.filters);
  const setFilter = useStore((s) => s.setFilter);
  const resetFilters = useStore((s) => s.resetFilters);
  const availableDays = useStore((s) => s.availableDays);
  const availableModels = useStore((s) => s.availableModels);

  const sessions = useStore((s) => s.sessions);

  // Derive available modes from session data (only show if modes exist)
  const availableModes = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of sessions) {
      const models = Array.isArray(s.models) ? (s.models as string[]) : [];
      const hasRecording = models.includes("recording");
      const hasManual = models.includes("manual");
      if (hasRecording) counts["recording"] = (counts["recording"] || 0) + 1;
      if (hasManual) counts["manual"] = (counts["manual"] || 0) + 1;
      if (!hasRecording && !hasManual)
        counts["agent"] = (counts["agent"] || 0) + 1;
    }
    const labels: Record<string, string> = {
      agent: "Agent",
      recording: "Recording",
      manual: "Manual",
    };
    return Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([value, count]) => ({
        value,
        label: labels[value] || value,
        count,
      }));
  }, [sessions]);

  // Derive available outcomes from session data
  const availableOutcomes = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of sessions) {
      const outcome = (s.outcome as string) || "unknown";
      counts[outcome] = (counts[outcome] || 0) + 1;
    }
    const labels: Record<string, string> = {
      completed: "Completed",
      stopped: "Stopped",
      max_turns: "Max Turns",
      error: "Error",
    };
    return Object.entries(counts)
      .map(([value, count]) => ({
        value,
        label: labels[value] || value,
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [sessions]);

  const [localDomain, setLocalDomain] = useState(filters.domain);
  const debouncedDomain = useDebounce(localDomain, 250);

  useEffect(() => {
    if (debouncedDomain !== filters.domain) {
      setFilter("domain", debouncedDomain);
      onFiltersChanged();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedDomain]);

  const handleSelectChange = useCallback(
    (key: keyof typeof filters, value: string) => {
      setFilter(key, value);
      onFiltersChanged();
    },
    [setFilter, onFiltersChanged],
  );

  const handleDatePreset = useCallback(
    (fromDays: number, toDays: number) => {
      setFilter("day", "all");
      setFilter("from", isoDayOffset(fromDays));
      setFilter("to", isoDayOffset(toDays));
      onFiltersChanged();
    },
    [setFilter, onFiltersChanged],
  );

  // Active filter chips
  const chips: { key: string; label: string }[] = [];
  if (filters.outcome !== "all")
    chips.push({ key: "outcome", label: `Outcome: ${filters.outcome}` });
  if (filters.day !== "all")
    chips.push({ key: "day", label: `Day: ${filters.day}` });
  if (filters.from) chips.push({ key: "from", label: `From: ${filters.from}` });
  if (filters.to) chips.push({ key: "to", label: `To: ${filters.to}` });
  if (filters.domain)
    chips.push({ key: "domain", label: `Website: ${filters.domain}` });
  if (filters.mode !== "all")
    chips.push({ key: "mode", label: `Mode: ${filters.mode}` });
  if (filters.model !== "all")
    chips.push({ key: "model", label: `Model: ${shortModel(filters.model)}` });
  if (filters.tier !== "all")
    chips.push({ key: "tier", label: `Tier: ${filters.tier}` });
  if (filters.runId)
    chips.push({ key: "runId", label: `Run: ${filters.runId.slice(0, 8)}` });

  const handleChipRemove = (key: string) => {
    if (key === "outcome") setFilter("outcome", "all");
    if (key === "day") setFilter("day", "all");
    if (key === "from") setFilter("from", "");
    if (key === "to") setFilter("to", "");
    if (key === "domain") {
      setFilter("domain", "");
      setLocalDomain("");
    }
    if (key === "mode") setFilter("mode", "all");
    if (key === "model") setFilter("model", "all");
    if (key === "tier") setFilter("tier", "all");
    if (key === "runId") {
      setFilter("runId", "");
    }
    onFiltersChanged();
  };

  const handleClearAll = () => {
    resetFilters();
    setLocalDomain("");
    onFiltersChanged();
  };

  const selectClass =
    "w-full bg-trace-bg text-trace-text border border-trace-border rounded px-2 py-1.5 text-xs outline-none transition-colors focus:border-trace-accent";

  return (
    <div className="px-3 pt-3 pb-2 shrink-0">
      {/* Row 1: Outcome + Mode + Day */}
      <div className="flex gap-1.5 mb-2">
        <select
          value={filters.outcome}
          onChange={(e) => handleSelectChange("outcome", e.target.value)}
          className={selectClass}
        >
          <option value="all">Outcome</option>
          {availableOutcomes.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label} ({o.count})
            </option>
          ))}
        </select>
        {availableModes.length > 0 && (
          <select
            value={filters.mode}
            onChange={(e) => handleSelectChange("mode", e.target.value)}
            className={selectClass}
          >
            <option value="all">Mode</option>
            {availableModes.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label} ({m.count})
              </option>
            ))}
          </select>
        )}
        <select
          value={filters.day}
          onChange={(e) => {
            if (e.target.value !== "all") {
              setFilter("from", "");
              setFilter("to", "");
            }
            handleSelectChange("day", e.target.value);
          }}
          className={selectClass}
        >
          <option value="all">Day</option>
          {availableDays.map((d) => (
            <option key={d.day} value={d.day}>
              {d.day} ({d.count})
            </option>
          ))}
        </select>
      </div>

      {/* Row 2: Model + Tier + Website */}
      <div className="flex gap-1.5 mb-2">
        <select
          value={filters.model}
          onChange={(e) => handleSelectChange("model", e.target.value)}
          className={selectClass}
        >
          <option value="all">Model</option>
          {availableModels.map((m) => (
            <option key={m.model} value={m.model}>
              {shortModel(m.model)} ({m.count})
            </option>
          ))}
        </select>
        <select
          value={filters.tier}
          onChange={(e) => handleSelectChange("tier", e.target.value)}
          className={selectClass}
        >
          <option value="all">Tier</option>
          <option value="executor">Executor</option>
          <option value="planner">Planner</option>
        </select>
        <input
          type="text"
          value={localDomain}
          onChange={(e) => setLocalDomain(e.target.value)}
          placeholder="Website"
          className="w-full bg-trace-bg text-trace-text border border-trace-border rounded px-2 py-1.5 text-xs outline-none transition-colors focus:border-trace-accent placeholder:text-trace-dim"
        />
      </div>

      {/* Row 3: Date range + presets */}
      <div className="flex gap-1.5 items-center">
        <input
          type="date"
          value={filters.from}
          onChange={(e) => {
            if (e.target.value || filters.to) setFilter("day", "all");
            handleSelectChange("from", e.target.value);
          }}
          className="flex-1 min-w-0 bg-trace-bg text-trace-text border border-trace-border rounded px-2 py-1.5 text-xs outline-none transition-colors focus:border-trace-accent"
        />
        <span className="text-trace-dim text-[10px]">&ndash;</span>
        <input
          type="date"
          value={filters.to}
          onChange={(e) => {
            if (e.target.value || filters.from) setFilter("day", "all");
            handleSelectChange("to", e.target.value);
          }}
          className="flex-1 min-w-0 bg-trace-bg text-trace-text border border-trace-border rounded px-2 py-1.5 text-xs outline-none transition-colors focus:border-trace-accent"
        />
        <div className="flex gap-1 shrink-0">
          {(
            [
              ["Today", 0],
              ["7d", 6],
              ["30d", 29],
            ] as const
          ).map(([label, days]) => (
            <button
              key={label}
              onClick={() => handleDatePreset(days, 0)}
              className="bg-trace-bg text-trace-subtle border border-trace-border rounded px-1.5 py-1 text-[10px] cursor-pointer hover:border-trace-accent hover:text-trace-text transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <FilterChips
        chips={chips}
        onRemove={handleChipRemove}
        onClearAll={handleClearAll}
      />
    </div>
  );
}
