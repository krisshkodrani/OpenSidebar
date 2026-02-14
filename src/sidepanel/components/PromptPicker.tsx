import React, { useEffect, useRef } from "react";
import { Bookmark, Settings2 } from "lucide-react";
import { useStore } from "../store";
import { SavedPrompt } from "../../types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (content: string) => void;
  onManage: () => void;
  onSaveCurrent: () => void;
  hasInputText: boolean;
}

export function PromptPicker({
  isOpen,
  onClose,
  onSelect,
  onManage,
  onSaveCurrent,
  hasInputText,
}: Props) {
  const savedPrompts = useStore((s) => s.savedPrompts);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    const handleClick = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    // Delay to avoid catching the click that opened the picker
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 0);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClick);
      clearTimeout(timer);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Group by category
  const grouped = new Map<string, SavedPrompt[]>();
  for (const p of savedPrompts) {
    const cat = p.category || "Uncategorized";
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(p);
  }

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-full left-0 right-0 mb-1 mx-2 max-h-[240px] overflow-y-auto bg-warm-50 dark:bg-warm-800 border border-warm-200 dark:border-warm-700 rounded-xl shadow-lg z-30"
    >
      {savedPrompts.length === 0 ? (
        <div className="p-4 text-center">
          <Bookmark
            size={20}
            className="mx-auto mb-2 text-warm-400 dark:text-warm-500"
          />
          <p className="text-sm text-warm-500 dark:text-warm-400 mb-2">
            No saved prompts
          </p>
          <button
            onClick={() => {
              onClose();
              onManage();
            }}
            className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
          >
            Create one
          </button>
        </div>
      ) : (
        <div className="p-2 space-y-2">
          {Array.from(grouped.entries()).map(([category, prompts]) => (
            <div key={category}>
              <p className="text-[10px] font-semibold uppercase text-warm-400 tracking-wider px-2 py-1">
                {category}
              </p>
              {prompts.map((prompt) => (
                <button
                  key={prompt.id}
                  onClick={() => {
                    onSelect(prompt.content);
                    onClose();
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-warm-100 dark:hover:bg-warm-700 transition-colors"
                >
                  <p className="text-sm font-medium text-warm-800 dark:text-warm-100 truncate">
                    {prompt.title}
                  </p>
                  <p className="text-xs text-warm-500 dark:text-warm-400 truncate">
                    {prompt.content}
                  </p>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Footer links */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-warm-200 dark:border-warm-700 text-xs">
        {hasInputText && (
          <button
            onClick={() => {
              onClose();
              onSaveCurrent();
            }}
            className="text-primary-600 dark:text-primary-400 hover:underline"
          >
            Save current
          </button>
        )}
        <button
          onClick={() => {
            onClose();
            onManage();
          }}
          className="flex items-center gap-1 text-warm-500 dark:text-warm-400 hover:text-warm-700 dark:hover:text-warm-300 ml-auto"
        >
          <Settings2 size={12} />
          Manage
        </button>
      </div>
    </div>
  );
}
