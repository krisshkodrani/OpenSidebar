import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { useStore } from "../../store";
import { useDebounce } from "../../hooks/useDebounce";
import { isoDayOffset, shortModel } from "../../utils";
import Tooltip from "../Tooltip";

interface FilterBarProps {
  onFiltersChanged: () => void;
}

interface OptionItem {
  value: string;
  label: string;
  count: number;
}

export default function FilterBar({ onFiltersChanged }: FilterBarProps) {
  const filters = useStore((s) => s.filters);
  const setFilter = useStore((s) => s.setFilter);
  const resetFilters = useStore((s) => s.resetFilters);
  const availableDays = useStore((s) => s.availableDays);
  const availableModels = useStore((s) => s.availableModels);
  const sessions = useStore((s) => s.sessions);

  // Snapshot dropdown options when no outcome filter is active so counts
  // reflect the full dataset rather than the already-filtered result set.
  const outcomeSnapshot = useRef<OptionItem[] | null>(null);

  const computedOutcomes = useMemo(() => {
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

  // Update snapshot only when outcome filter is "all" (unfiltered)
  if (filters.outcome === "all") {
    outcomeSnapshot.current = computedOutcomes;
  }
  const availableOutcomes = outcomeSnapshot.current ?? computedOutcomes;

  // Compute available skills from sessions
  const skillSnapshot = useRef<OptionItem[] | null>(null);

  const computedSkills = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of sessions) {
      const skillId =
        s.skillToolMetrics?.skillId ||
        s.planDecomposition?.steps?.[0]?.selectedSkillId;
      if (skillId) {
        counts[skillId] = (counts[skillId] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([value, count]) => ({
        value,
        label: value.replace(/-/g, " ").slice(0, 20),
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [sessions]);

  if (filters.skill === "all") {
    skillSnapshot.current = computedSkills;
  }
  const availableSkills = skillSnapshot.current ?? computedSkills;

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

  const hasActiveFilters =
    filters.outcome !== "all" ||
    filters.day !== "all" ||
    filters.from !== isoDayOffset(6) ||
    filters.domain !== "" ||
    filters.model !== "all" ||
    filters.skill !== "all" ||
    filters.runId !== "";

  const handleClearAll = () => {
    resetFilters();
    setLocalDomain("");
    onFiltersChanged();
  };

  const selectClass =
    "bg-white text-trace-text border border-trace-border rounded px-2 py-1.5 text-[11px] outline-none transition-colors focus:border-trace-accent shadow-sm";

  return (
    <div className="flex items-center gap-2 px-5 py-2 border-b border-trace-border/40 shrink-0 flex-wrap">
      {/* Filters */}
      <Tooltip content="Filter by session outcome (completed, error, etc.)">
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
      </Tooltip>

      <Tooltip content="Filter by day">
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
      </Tooltip>

      <Tooltip content="Filter by LLM model used">
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
      </Tooltip>

      {availableSkills.length > 0 && (
        <Tooltip content="Filter by skill used in this session">
          <select
            value={filters.skill}
            onChange={(e) => handleSelectChange("skill", e.target.value)}
            className={selectClass}
          >
            <option value="all">Skill</option>
            {availableSkills.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label} ({s.count})
              </option>
            ))}
          </select>
        </Tooltip>
      )}

      <Tooltip content="Filter by website/domain">
        <input
          type="text"
          value={localDomain}
          onChange={(e) => setLocalDomain(e.target.value)}
          placeholder="Website"
          className="bg-white text-trace-text border border-trace-border rounded px-2 py-1.5 text-[11px] outline-none transition-colors focus:border-trace-accent placeholder:text-trace-dim w-28 shadow-sm"
        />
      </Tooltip>

      {/* Date presets */}
      <div className="flex gap-1">
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
            className="bg-white text-trace-subtle border border-trace-border rounded px-1.5 py-1.5 text-[10px] cursor-pointer hover:border-trace-accent hover:text-trace-text transition-colors shadow-sm"
          >
            {label}
          </button>
        ))}
      </div>

      {hasActiveFilters && (
        <button
          onClick={handleClearAll}
          className="text-[10px] text-trace-muted hover:text-trace-accent-light transition-colors ml-1"
        >
          Clear filters
        </button>
      )}

      <span className="ml-auto text-[10px] text-trace-muted">
        {sessions.length} session{sessions.length === 1 ? "" : "s"}
      </span>
    </div>
  );
}
