import React, { useState, useEffect } from "react";
import { useStore } from "../../store";
import { useDebounce } from "../../hooks/useDebounce";

export default function MemoryFilterPanel() {
  const setMemorySearchQuery = useStore((s) => s.setMemorySearchQuery);
  const memoryCategoryFilter = useStore((s) => s.memoryCategoryFilter);
  const setMemoryCategoryFilter = useStore((s) => s.setMemoryCategoryFilter);
  const memoryCategories = useStore((s) => s.memoryCategories);

  const [localSearch, setLocalSearch] = useState("");
  const debouncedSearch = useDebounce(localSearch, 200);

  useEffect(() => {
    setMemorySearchQuery(debouncedSearch);
  }, [debouncedSearch, setMemorySearchQuery]);

  return (
    <div className="p-4 border-b border-trace-border shrink-0">
      <h2 className="text-[15px] font-bold text-trace-text mb-1">Memory Entries</h2>
      <div className="text-[11px] text-trace-muted mb-3">
        Stored knowledge from agent sessions
      </div>

      <div className="mb-2.5">
        <label className="block text-[11px] font-semibold text-trace-muted uppercase tracking-wider mb-1">
          Search
        </label>
        <input
          type="text"
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          placeholder="Search content..."
          className="w-full bg-trace-bg text-trace-text border border-trace-border rounded px-2 py-1.5 text-xs outline-none transition-colors focus:border-trace-accent placeholder:text-trace-dim"
        />
      </div>

      <div className="mb-2.5">
        <label className="block text-[11px] font-semibold text-trace-muted uppercase tracking-wider mb-1">
          Category
        </label>
        <select
          value={memoryCategoryFilter}
          onChange={(e) => setMemoryCategoryFilter(e.target.value)}
          className="w-full bg-trace-bg text-trace-text border border-trace-border rounded px-2 py-1.5 text-xs outline-none transition-colors focus:border-trace-accent"
        >
          <option value="all">All Categories</option>
          {memoryCategories.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name} ({c.count})
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
