import React from "react";
import { useStore } from "../../store";
import * as apiModule from "../../api";
import EmptyState from "../EmptyState";
import { formatDate } from "../../utils";

export default function MemoryDetail() {
  const memoryEntries = useStore((s) => s.memoryEntries);
  const currentMemoryEntryId = useStore((s) => s.currentMemoryEntryId);
  const removeMemoryEntryLocal = useStore((s) => s.removeMemoryEntryLocal);

  const entry = memoryEntries.find((e) => e.id === currentMemoryEntryId);

  if (!entry) {
    return (
      <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
        <EmptyState icon="&#128218;" message="Select a memory entry to view details" />
      </div>
    );
  }

  const handleDelete = async () => {
    if (!confirm("Delete this memory entry? This cannot be undone.")) return;
    try {
      await apiModule.deleteMemoryEntry(entry.id);
      removeMemoryEntryLocal(entry.id);
    } catch (err) {
      alert(`Failed to delete: ${err}`);
    }
  };

  const metaItems = [
    entry.type && { label: "Type", value: entry.type },
    entry.category && { label: "Category", value: entry.category },
    entry.sourceUrl && { label: "Source URL", value: entry.sourceUrl, isUrl: true },
    entry.createdAt && { label: "Created", value: formatDate(entry.createdAt) },
  ].filter(Boolean) as Array<{ label: string; value: string; isUrl?: boolean }>;

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
      <div className="bg-trace-panel border border-[rgba(15,52,96,0.6)] rounded-lg p-4 mb-4">
        {/* Meta grid */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2.5 mt-3">
          {metaItems.map((item) => (
            <div key={item.label} className="bg-[rgba(26,26,46,0.5)] rounded-[5px] p-2">
              <div className="text-[10px] text-trace-muted uppercase tracking-wider mb-0.5">
                {item.label}
              </div>
              <div
                className={`text-xs break-all ${item.isUrl ? "text-trace-accent-light" : "text-[#c0c0d8]"}`}
              >
                {item.value}
              </div>
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="mt-3">
          <label className="block text-[11px] font-semibold text-trace-muted uppercase tracking-wider mb-1">
            Content
          </label>
          <div className="text-[13px] text-[#c0c0d8] leading-relaxed whitespace-pre-wrap break-words bg-[rgba(26,26,46,0.5)] p-3 rounded-[5px] mt-2 max-h-[400px] overflow-y-auto scrollbar-thin">
            {entry.content}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-3 flex-wrap">
          <button
            onClick={handleDelete}
            className="px-3.5 py-1.5 rounded-[5px] text-xs font-semibold cursor-pointer border bg-red-500/15 text-[#e74c3c] border-red-500/30 hover:bg-red-500/25"
          >
            Delete Entry
          </button>
        </div>
      </div>

      <div className="text-[10px] text-trace-dim mt-2 font-mono">ID: {entry.id}</div>
    </div>
  );
}
