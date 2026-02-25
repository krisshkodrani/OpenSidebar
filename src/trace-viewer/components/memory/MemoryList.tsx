import React from "react";
import { useStore } from "../../store";
import MemoryListItem from "./MemoryListItem";
import LoadingSpinner from "../LoadingSpinner";

export default function MemoryList() {
  const memoryEntries = useStore((s) => s.memoryEntries);
  const currentMemoryEntryId = useStore((s) => s.currentMemoryEntryId);
  const setCurrentMemoryEntryId = useStore((s) => s.setCurrentMemoryEntryId);
  const memorySearchQuery = useStore((s) => s.memorySearchQuery);
  const memoryCategoryFilter = useStore((s) => s.memoryCategoryFilter);
  const memoryLoading = useStore((s) => s.memoryLoading);

  if (memoryLoading) {
    return <LoadingSpinner message="Loading memory..." />;
  }

  // Apply filters
  let filtered = memoryEntries;
  const q = memorySearchQuery.toLowerCase().trim();
  if (q) {
    filtered = filtered.filter(
      (e) =>
        (e.content || "").toLowerCase().includes(q) ||
        (e.category || "").toLowerCase().includes(q) ||
        (e.sourceUrl || "").toLowerCase().includes(q),
    );
  }
  if (memoryCategoryFilter && memoryCategoryFilter !== "all") {
    filtered = filtered.filter(
      (e) => (e.category || "uncategorized") === memoryCategoryFilter,
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="py-10 px-4 text-center text-trace-muted text-[13px]">
        {memoryEntries.length === 0 ? (
          <>
            No memory entries found.
            <br /><br />
            <span className="text-[11px] text-[#5a5a7e]">
              Memory is synced from the extension via POST /api/memory/sync
            </span>
          </>
        ) : (
          "No entries match the current filters."
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      {filtered.map((entry) => (
        <MemoryListItem
          key={entry.id}
          entry={entry}
          isActive={entry.id === currentMemoryEntryId}
          onClick={() => setCurrentMemoryEntryId(entry.id)}
        />
      ))}
    </div>
  );
}
