import React, { useState, useEffect, useCallback } from "react";
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

  const [localDomain, setLocalDomain] = useState(filters.domain);
  const [localSession, setLocalSession] = useState(filters.sessionPrefix);
  const debouncedDomain = useDebounce(localDomain, 250);
  const debouncedSession = useDebounce(localSession, 250);

  useEffect(() => {
    if (debouncedDomain !== filters.domain) {
      setFilter("domain", debouncedDomain);
      onFiltersChanged();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedDomain]);

  useEffect(() => {
    if (debouncedSession !== filters.sessionPrefix) {
      setFilter("sessionPrefix", debouncedSession);
      onFiltersChanged();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSession]);

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
  if (filters.sessionPrefix)
    chips.push({ key: "session", label: `Session: ${filters.sessionPrefix}` });
  if (filters.mode !== "all")
    chips.push({ key: "mode", label: `Mode: ${filters.mode}` });
  if (filters.model !== "all")
    chips.push({ key: "model", label: `Model: ${shortModel(filters.model)}` });

  const handleChipRemove = (key: string) => {
    if (key === "outcome") setFilter("outcome", "all");
    if (key === "day") setFilter("day", "all");
    if (key === "from") setFilter("from", "");
    if (key === "to") setFilter("to", "");
    if (key === "domain") {
      setFilter("domain", "");
      setLocalDomain("");
    }
    if (key === "session") {
      setFilter("sessionPrefix", "");
      setLocalSession("");
    }
    if (key === "mode") setFilter("mode", "all");
    if (key === "model") setFilter("model", "all");
    onFiltersChanged();
  };

  const handleClearAll = () => {
    resetFilters();
    setLocalDomain("");
    setLocalSession("");
    onFiltersChanged();
  };

  const selectClass =
    "w-full bg-trace-bg text-trace-text border border-trace-border rounded px-2 py-1.5 text-xs outline-none transition-colors focus:border-trace-accent";

  return (
    <div className="p-4 border-b border-trace-border shrink-0">
      <h2 className="text-[15px] font-bold text-trace-text mb-1">
        Trace Sessions
      </h2>
      <div className="text-[11px] text-trace-muted mb-3">
        Agent execution traces
      </div>

      {/* Outcome + Mode row */}
      <div className="flex gap-2 mb-2.5">
        <div className="flex-1">
          <label className="block text-[11px] font-semibold text-trace-muted uppercase tracking-wider mb-1">
            Outcome
          </label>
          <select
            value={filters.outcome}
            onChange={(e) => handleSelectChange("outcome", e.target.value)}
            className={selectClass}
          >
            <option value="all">All</option>
            <option value="completed">Completed</option>
            <option value="stopped">Stopped</option>
            <option value="max_turns">Max Turns</option>
            <option value="error">Error</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-[11px] font-semibold text-trace-muted uppercase tracking-wider mb-1">
            Mode
          </label>
          <select
            value={filters.mode}
            onChange={(e) => handleSelectChange("mode", e.target.value)}
            className={selectClass}
          >
            <option value="all">All</option>
            <option value="agent">Agent</option>
            <option value="recording">Recording</option>
            <option value="manual">Manual</option>
          </select>
        </div>
      </div>

      {/* Day + Model row */}
      <div className="flex gap-2 mb-2.5">
        <div className="flex-1">
          <label className="block text-[11px] font-semibold text-trace-muted uppercase tracking-wider mb-1">
            Day
          </label>
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
            <option value="all">All Days</option>
            {availableDays.map((d) => (
              <option key={d.day} value={d.day}>
                {d.day} ({d.count})
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-[11px] font-semibold text-trace-muted uppercase tracking-wider mb-1">
            Model
          </label>
          <select
            value={filters.model}
            onChange={(e) => handleSelectChange("model", e.target.value)}
            className={selectClass}
          >
            <option value="all">All Models</option>
            {availableModels.map((m) => (
              <option key={m.model} value={m.model}>
                {shortModel(m.model)} ({m.count})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Website + Session */}
      <div className="flex gap-2">
        <div className="flex-1 mb-2.5">
          <label className="block text-[11px] font-semibold text-trace-muted uppercase tracking-wider mb-1">
            Website
          </label>
          <input
            type="text"
            value={localDomain}
            onChange={(e) => setLocalDomain(e.target.value)}
            placeholder="e.g. github.com"
            className="w-full bg-trace-bg text-trace-text border border-trace-border rounded px-2 py-1.5 text-xs outline-none transition-colors focus:border-trace-accent placeholder:text-trace-dim"
          />
        </div>
        <div className="flex-1 mb-2.5">
          <label className="block text-[11px] font-semibold text-trace-muted uppercase tracking-wider mb-1">
            Session
          </label>
          <input
            type="text"
            value={localSession}
            onChange={(e) => setLocalSession(e.target.value)}
            placeholder="prefix"
            className="w-full bg-trace-bg text-trace-text border border-trace-border rounded px-2 py-1.5 text-xs outline-none transition-colors focus:border-trace-accent placeholder:text-trace-dim"
          />
        </div>
      </div>

      {/* Date range */}
      <div className="flex gap-2">
        <div className="flex-1 mb-2.5">
          <label className="block text-[11px] font-semibold text-trace-muted uppercase tracking-wider mb-1">
            From
          </label>
          <input
            type="date"
            value={filters.from}
            onChange={(e) => {
              if (e.target.value || filters.to) setFilter("day", "all");
              handleSelectChange("from", e.target.value);
            }}
            className="w-full bg-trace-bg text-trace-text border border-trace-border rounded px-2 py-1.5 text-xs outline-none transition-colors focus:border-trace-accent"
          />
        </div>
        <div className="flex-1 mb-2.5">
          <label className="block text-[11px] font-semibold text-trace-muted uppercase tracking-wider mb-1">
            To
          </label>
          <input
            type="date"
            value={filters.to}
            onChange={(e) => {
              if (e.target.value || filters.from) setFilter("day", "all");
              handleSelectChange("to", e.target.value);
            }}
            className="w-full bg-trace-bg text-trace-text border border-trace-border rounded px-2 py-1.5 text-xs outline-none transition-colors focus:border-trace-accent"
          />
        </div>
      </div>

      {/* Presets */}
      <div className="flex gap-1.5 mt-1">
        <button
          onClick={() => handleDatePreset(0, 0)}
          className="bg-trace-bg text-[#c0c0d8] border border-trace-border rounded px-2 py-1 text-[11px] cursor-pointer hover:border-trace-accent hover:text-trace-text"
        >
          Today
        </button>
        <button
          onClick={() => handleDatePreset(6, 0)}
          className="bg-trace-bg text-[#c0c0d8] border border-trace-border rounded px-2 py-1 text-[11px] cursor-pointer hover:border-trace-accent hover:text-trace-text"
        >
          7d
        </button>
        <button
          onClick={() => handleDatePreset(29, 0)}
          className="bg-trace-bg text-[#c0c0d8] border border-trace-border rounded px-2 py-1 text-[11px] cursor-pointer hover:border-trace-accent hover:text-trace-text"
        >
          30d
        </button>
      </div>

      <FilterChips
        chips={chips}
        onRemove={handleChipRemove}
        onClearAll={handleClearAll}
      />
    </div>
  );
}
