import React, { useEffect, useRef, useState } from "react";
import { X, Plus, Pencil, Trash2, Check } from "lucide-react";
import { useStore } from "../store";
import { SavedPrompt } from "../../types";
import { PersonalDataSyncBadge } from "./PersonalDataSyncBadge";

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
        className="absolute inset-0 bg-fg/20 backdrop-blur-sm backdrop-enter"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        ref={drawerRef}
        className="relative w-full max-w-[320px] h-full bg-canvas shadow-sm flex flex-col border-l border-line drawer-enter"
      >
        <header className="flex items-center justify-between p-4 border-b border-line">
              <h2 className="font-semibold text-ui-title">
            Saved Prompts
              </h2>
              <PersonalDataSyncBadge category="saved_prompts" />
          <div className="flex items-center gap-1">
            <button
              onClick={startCreate}
              className="p-2 hover:bg-surface-subtle rounded-full text-accent-text"
              aria-label="Add new prompt"
            >
              <Plus size={20} />
            </button>
            <button
              ref={closeButtonRef}
              onClick={onClose}
              className="p-2 hover:bg-surface-subtle rounded-full"
              aria-label="Close"
            >
              <X size={20} className="text-fg-tertiary" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Inline create/edit form */}
          {isEditing && (
            <div className="space-y-2 p-3 rounded-lg border border-accent/30 bg-accent-subtle">
              <input
                type="text"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="Title"
                className="w-full px-2.5 py-1.5 text-ui-body border border-line-strong rounded-md bg-canvas focus:ring-2 focus:ring-accent outline-none"
                autoFocus
              />
              <textarea
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                placeholder="Prompt content"
                rows={3}
                className="w-full px-2.5 py-1.5 text-ui-body border border-line-strong rounded-md bg-canvas focus:ring-2 focus:ring-accent outline-none resize-none"
              />
              <input
                type="text"
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                placeholder="Category (optional)"
                className="w-full px-2.5 py-1.5 text-ui-body border border-line-strong rounded-md bg-canvas focus:ring-2 focus:ring-accent outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSave}
                  disabled={!formTitle.trim() || !formContent.trim()}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-accent-fg rounded-md text-ui-body font-medium transition-colors"
                >
                  <Check size={14} />
                  Save
                </button>
                <button
                  onClick={() => setIsEditing(null)}
                  className="px-3 py-1.5 border border-line-strong rounded-md text-ui-body text-fg-secondary hover:bg-surface-subtle transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Prompt list */}
          {savedPrompts.length === 0 && !isEditing ? (
            <div className="text-center py-8">
              <p className="text-ui-body text-fg-tertiary mb-3">
                No saved prompts yet
              </p>
              <button
                onClick={startCreate}
                className="text-ui-body text-accent-text hover:underline"
              >
                Create your first prompt
              </button>
            </div>
          ) : (
            Array.from(grouped.entries()).map(([category, prompts]) => (
              <section key={category}>
                <h3 className="text-ui-control font-semibold uppercase text-fg-tertiary tracking-wider mb-2">
                  {category}
                </h3>
                <div className="space-y-2">
                  {prompts.map((prompt) => (
                    <div
                      key={prompt.id}
                      className="group flex items-start gap-2 p-2.5 rounded-lg border border-line hover:border-accent/30 hover:bg-surface-subtle cursor-pointer transition-colors"
                      onClick={() => handleSelect(prompt)}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-ui-body font-medium text-fg truncate">
                          {prompt.title}
                        </p>
                        <p className="text-ui-control text-fg-tertiary line-clamp-2 mt-0.5">
                          {prompt.content}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(prompt);
                          }}
                          className="p-1 hover:bg-surface-hover rounded text-fg-tertiary hover:text-fg-secondary"
                          aria-label={`Edit ${prompt.title}`}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(prompt.id);
                          }}
                          className="p-1 hover:bg-danger-subtle rounded text-fg-tertiary hover:text-danger"
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
