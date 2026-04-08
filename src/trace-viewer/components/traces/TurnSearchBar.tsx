import React, { useState, useEffect } from "react";
import { useStore } from "../../store";
import { useDebounce } from "../../hooks/useDebounce";

export default function TurnSearchBar() {
  const setSearchQuery = useStore((s) => s.setSearchQuery);
  const [localQuery, setLocalQuery] = useState("");
  const debouncedQuery = useDebounce(localQuery, 200);

  useEffect(() => {
    setSearchQuery(debouncedQuery);
  }, [debouncedQuery, setSearchQuery]);

  return (
    <div className="px-5 py-2.5 border-b border-[rgba(124,58,237,0.12)] shrink-0 bg-trace-bg">
      <input
        type="text"
        value={localQuery}
        onChange={(e) => setLocalQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setLocalQuery("");
            setSearchQuery("");
          }
        }}
        placeholder="Filter turns by tool name, text, event type..."
        className="w-full bg-trace-panel text-trace-text border border-trace-border rounded px-3 py-2 text-[13px] outline-none transition-colors focus:border-trace-accent placeholder:text-trace-dim"
      />
    </div>
  );
}
