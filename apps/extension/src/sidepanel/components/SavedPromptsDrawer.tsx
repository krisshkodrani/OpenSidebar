import React, { useEffect, useRef, useState } from "react";
import { X, Plus, Pencil, Trash2, Check } from "lucide-react";
import { useStore } from "../store";
import { SavedPrompt } from "../../types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectPrompt: (content: string) => void;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function SavedPromptsDrawer({
  isOpen,
  onClose,
  onSelectPrompt,
}: Props) {
  const savedPrompts = useStore((s) => s.savedPrompts);
  const addSavedPrompt = useStore((s) => s.addSavedPrompt);
  const updateSavedPrompt = useStore((s) => s.updateSavedPrompt);
  const deleteSavedPrompt = useStore((s) => s.deleteSavedPrompt);

  const [isEditing, setIsEditing] = useState<string | null>(null); // prompt ID or "new"
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formCategory, setFormCategory] = useState("");

  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Reset the form whenever a freshly-mounted drawer opens.
  useEffect(() => {
    if (isOpen) {
      setIsEditing(null);
    }
  }, [isOpen]);

  // Focus trap + Escape
  useEffect(() => {
    if (!isOpen) return;

    closeButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isEditing) {
          setIsEditing(null);
        } else {
          onClose();
        }
        return;
      }

      if (e.key === "Tab" && drawerRef.current) {
        const focusable =
          drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isEditing, onClose]);

  const startCreate = () => {
    setIsEditing("new");
    setFormTitle("");
    setFormContent("");
    setFormCategory("");
  };

  const startEdit = (prompt: SavedPrompt) => {
    setIsEditing(prompt.id);
    setFormTitle(prompt.title);
    setFormContent(prompt.content);
    setFormCategory(prompt.category);
  };

  const handleSave = async () => {
    if (!formTitle.trim() || !formContent.trim()) return;
    if (isEditing === "new") {
      await addSavedPrompt(formTitle, formContent, formCategory);
    } else if (isEditing) {
      await updateSavedPrompt(isEditing, {
        title: formTitle,
        content: formContent,
        category: formCategory,
      });
    }
    setIsEditing(null);
  };

  const handleDelete = async (id: string) => {
    await deleteSavedPrompt(id);
    if (isEditing === id) setIsEditing(null);
  };

  const handleSelect = (prompt: SavedPrompt) => {
    onSelectPrompt(prompt.content);
    onClose();
  };

  // Group prompts by category
  const grouped = new Map<string, SavedPrompt[]>();
  for (const p of savedPrompts) {
    const cat = p.category || "Uncategorized";
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(p);
  }

  if (!isOpen) return null;

  return (
    <div
      className="absolute inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Saved Prompts"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-sm backdrop-enter"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className="relative w-full max-w-[320px] h-full bg-warm-50 dark:bg-warm-900 shadow-2xl flex flex-col border-l border-warm-200 dark:border-warm-800 drawer-enter"
      >
        <header className="flex items-center justify-between p-4 border-b border-warm-200 dark:border-warm-800">
          <h2 className="font-semibold text-lg dark:text-warm-100">
            Saved Prompts
          </h2>
          <div className="flex items-center gap-1">
            <button
              onClick={startCreate}
              className="p-2 hover:bg-warm-100 dark:hover:bg-warm-800 rounded-full text-primary-500 hover:text-primary-600"
              aria-label="Add new prompt"
            >
              <Plus size={20} />
            </button>
            <button
              ref={closeButtonRef}
              onClick={onClose}
              className="p-2 hover:bg-warm-100 dark:hover:bg-warm-800 rounded-full"
              aria-label="Close"
            >
              <X size={20} className="text-warm-500" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Inline create/edit form */}
          {isEditing && (
            <div className="space-y-2 p-3 rounded-lg border border-primary-300 dark:border-primary-700 bg-primary-50/50 dark:bg-primary-900/20">
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="Title"
                className="w-full px-2.5 py-1.5 text-sm border border-warm-300 dark:border-warm-700 rounded-md bg-warm-50 dark:bg-warm-900 focus:ring-2 focus:ring-primary-500 outline-none dark:text-warm-100"
                autoFocus
              />
              <textarea
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                placeholder="Prompt content"
                rows={3}
                className="w-full px-2.5 py-1.5 text-sm border border-warm-300 dark:border-warm-700 rounded-md bg-warm-50 dark:bg-warm-900 focus:ring-2 focus:ring-primary-500 outline-none dark:text-warm-100 resize-none"
              />
              <input
                type="text"
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                placeholder="Category (optional)"
                className="w-full px-2.5 py-1.5 text-sm border border-warm-300 dark:border-warm-700 rounded-md bg-warm-50 dark:bg-warm-900 focus:ring-2 focus:ring-primary-500 outline-none dark:text-warm-100"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={!formTitle.trim() || !formContent.trim()}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-md text-sm font-medium transition-colors"
                >
                  <Check size={14} />
                  Save
                </button>
                <button
                  onClick={() => setIsEditing(null)}
                  className="px-3 py-1.5 border border-warm-300 dark:border-warm-700 rounded-md text-sm text-warm-600 dark:text-warm-300 hover:bg-warm-100 dark:hover:bg-warm-800 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Prompt list */}
          {savedPrompts.length === 0 && !isEditing ? (
            <div className="text-center py-8">
              <p className="text-sm text-warm-500 dark:text-warm-400 mb-3">
                No saved prompts yet
              </p>
              <button
                onClick={startCreate}
                className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
              >
                Create your first prompt
              </button>
            </div>
          ) : (
            Array.from(grouped.entries()).map(([category, prompts]) => (
              <section key={category}>
                <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider mb-2">
                  {category}
                </h3>
                <div className="space-y-2">
                  {prompts.map((prompt) => (
                    <div
                      key={prompt.id}
                      className="group flex items-start gap-2 p-2.5 rounded-lg border border-warm-200 dark:border-warm-700 hover:border-primary-300 dark:hover:border-primary-700 hover:bg-warm-100/50 dark:hover:bg-warm-800/50 cursor-pointer transition-colors"
                      onClick={() => handleSelect(prompt)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-warm-800 dark:text-warm-100 truncate">
                          {prompt.title}
                        </p>
                        <p className="text-xs text-warm-500 dark:text-warm-400 line-clamp-2 mt-0.5">
                          {prompt.content}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(prompt);
                          }}
                          className="p-1 hover:bg-warm-200 dark:hover:bg-warm-700 rounded text-warm-400 hover:text-warm-600 dark:hover:text-warm-300"
                          aria-label={`Edit ${prompt.title}`}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(prompt.id);
                          }}
                          className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded text-warm-400 hover:text-red-500"
                          aria-label={`Delete ${prompt.title}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
