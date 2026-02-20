import React, { useEffect, useState, useCallback } from "react";
import {
  Trash2,
  ChevronDown,
  ChevronRight,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { Demonstration } from "../../types";

export function DemoLibrary() {
  const [demos, setDemos] = useState<Demonstration[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDemos = useCallback(async () => {
    try {
      const data = await chrome.storage.local.get("opensidebar:demos:v1");
      const raw = data["opensidebar:demos:v1"];
      if (Array.isArray(raw)) {
        setDemos(
          (raw as Demonstration[]).sort((a, b) => b.updatedAt - a.updatedAt),
        );
      } else {
        setDemos([]);
      }
    } catch {
      setDemos([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDemos();
  }, [loadDemos]);

  const deleteDemo = useCallback(
    async (id: string) => {
      const updated = demos.filter((d) => d.id !== id);
      setDemos(updated);
      await chrome.storage.local.set({ "opensidebar:demos:v1": updated });
    },
    [demos],
  );

  const toggleEnabled = useCallback(
    async (id: string) => {
      const updated = demos.map((d) =>
        d.id === id ? { ...d, enabled: !d.enabled, updatedAt: Date.now() } : d,
      );
      setDemos(updated);
      await chrome.storage.local.set({ "opensidebar:demos:v1": updated });
    },
    [demos],
  );

  const clearAll = useCallback(async () => {
    setDemos([]);
    await chrome.storage.local.set({ "opensidebar:demos:v1": [] });
  }, []);

  if (loading) {
    return <p className="text-xs text-warm-500 py-2">Loading demos...</p>;
  }

  if (demos.length === 0) {
    return (
      <p className="text-xs text-warm-500 py-2">
        No recorded demonstrations yet. Use the record button to capture one.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {demos.map((demo) => (
        <div
          key={demo.id}
          className="rounded-lg bg-warm-50 dark:bg-warm-900 border border-warm-200 dark:border-warm-700 text-xs"
        >
          <div className="flex items-center gap-1.5 p-2">
            <button
              onClick={() => setExpanded(expanded === demo.id ? null : demo.id)}
              className="text-warm-500 hover:text-warm-700 dark:hover:text-warm-300"
            >
              {expanded === demo.id ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )}
            </button>
            <span
              className={`flex-1 font-medium truncate ${!demo.enabled ? "opacity-50" : ""}`}
            >
              {demo.name}
            </span>
            <span className="text-warm-400 text-[10px]">
              {demo.actions.length} steps
            </span>
            {demo.uses > 0 && (
              <span className="text-warm-400 text-[10px]">
                {demo.uses}x used
              </span>
            )}
            <button
              onClick={() => toggleEnabled(demo.id)}
              className="text-warm-400 hover:text-warm-600 dark:hover:text-warm-300"
              title={demo.enabled ? "Disable" : "Enable"}
            >
              {demo.enabled ? (
                <ToggleRight size={14} className="text-green-500" />
              ) : (
                <ToggleLeft size={14} />
              )}
            </button>
            <button
              onClick={() => deleteDemo(demo.id)}
              className="text-warm-400 hover:text-red-500"
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          </div>
          {expanded === demo.id && (
            <div className="px-3 pb-2 text-[11px] text-warm-600 dark:text-warm-400 space-y-0.5 border-t border-warm-200 dark:border-warm-700 pt-1.5">
              {demo.goal && (
                <div className="text-warm-500 dark:text-warm-400">
                  <span className="font-medium">Goal:</span> {demo.goal}
                </div>
              )}
              {demo.preconditions && demo.preconditions.length > 0 && (
                <div className="flex flex-wrap gap-1 py-0.5">
                  {demo.preconditions.map((p, i) => (
                    <span
                      key={i}
                      className="px-1.5 py-0.5 rounded text-[10px] bg-warm-100 dark:bg-warm-800 text-warm-600 dark:text-warm-400 border border-warm-200 dark:border-warm-700"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              )}
              {demo.outcomeSignal && (
                <div className="text-warm-500 dark:text-warm-400">
                  <span className="font-medium">Outcome:</span>{" "}
                  {demo.outcomeSignal}
                </div>
              )}
              <div className="text-warm-400 mb-1">URL: {demo.urlPattern}</div>
              {demo.actions.map((action, i) => (
                <div key={i} className="flex gap-1">
                  <span className="text-warm-400 w-4 text-right flex-shrink-0">
                    {i + 1}.
                  </span>
                  <span>{formatAction(action)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      <button
        onClick={clearAll}
        className="text-xs text-red-500 hover:text-red-600 mt-2"
      >
        Clear All Demos
      </button>
    </div>
  );
}

function formatAction(a: Demonstration["actions"][0]): string {
  switch (a.type) {
    case "click":
      return `Click "${a.element?.text || a.element?.tagName || "element"}"`;
    case "type":
      return `Type "${(a.value || "").slice(0, 30)}" in ${a.element?.attributes?.placeholder || a.element?.tagName || "input"}`;
    case "scroll":
      return `Scroll ${(a.scrollDelta ?? 0) > 0 ? "down" : "up"} ${Math.abs(a.scrollDelta ?? 0)}px`;
    case "select":
      return `Select "${a.value}" from ${a.element?.tagName || "dropdown"}`;
    case "press_key":
      return `Press ${a.value ? `${a.value}+` : ""}${a.key}`;
    case "navigate":
      return `Navigate to ${a.url}`;
    default:
      return a.type;
  }
}
