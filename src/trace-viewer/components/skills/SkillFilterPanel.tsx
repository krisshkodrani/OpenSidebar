import React, { useState, useEffect } from "react";
import { useStore } from "../../store";
import { useDebounce } from "../../hooks/useDebounce";

export default function SkillFilterPanel() {
  const setSkillSearchQuery = useStore((s) => s.setSkillSearchQuery);
  const skillStatusFilter = useStore((s) => s.skillStatusFilter);
  const setSkillStatusFilter = useStore((s) => s.setSkillStatusFilter);

  const [localSearch, setLocalSearch] = useState("");
  const debouncedSearch = useDebounce(localSearch, 200);

  useEffect(() => {
    setSkillSearchQuery(debouncedSearch);
  }, [debouncedSearch, setSkillSearchQuery]);

  return (
    <div className="p-4 border-b border-trace-border shrink-0">
      <h2 className="text-[15px] font-bold text-trace-text mb-1">Learned Skills</h2>
      <div className="text-[11px] text-trace-muted mb-3">Skills learned from completed tasks</div>

      <div className="mb-2.5">
        <label className="block text-[11px] font-semibold text-trace-muted uppercase tracking-wider mb-1">
          Search
        </label>
        <input
          type="text"
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          placeholder="Filter skills..."
          className="w-full bg-trace-bg text-trace-text border border-trace-border rounded px-2 py-1.5 text-xs outline-none transition-colors focus:border-trace-accent placeholder:text-trace-dim"
        />
      </div>

      <div className="mb-2.5">
        <label className="block text-[11px] font-semibold text-trace-muted uppercase tracking-wider mb-1">
          Status
        </label>
        <select
          value={skillStatusFilter}
          onChange={(e) => setSkillStatusFilter(e.target.value)}
          className="w-full bg-trace-bg text-trace-text border border-trace-border rounded px-2 py-1.5 text-xs outline-none transition-colors focus:border-trace-accent"
        >
          <option value="all">All</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
          <option value="pinned">Pinned</option>
        </select>
      </div>
    </div>
  );
}
