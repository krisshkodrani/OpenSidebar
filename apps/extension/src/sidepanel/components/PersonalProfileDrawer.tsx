import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  FileText,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useStore } from "../store";
import {
  DEFAULT_PROFILE_NOTES_MARKDOWN,
  PROFILE_NOTES_MAX_CHARS,
  hashProfileNotes,
  hasUsablePersonalProfile,
  isProfileDigestStale,
  type DigestItem,
  type DigestKind,
} from "../../utils/personal-profile";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const DIGEST_KIND_ORDER: DigestKind[] = [
  "fact",
  "preference",
  "constraint",
  "theme",
  "open_question",
  "sensitive",
];

const DIGEST_KIND_LABELS: Record<DigestKind, string> = {
  fact: "Facts",
  preference: "Preferences",
  constraint: "Constraints",
  theme: "Reusable themes",
  sensitive: "Sensitive",
  open_question: "Open questions",
};

function groupDigestItems(items: DigestItem[]): Record<DigestKind, DigestItem[]> {
  return DIGEST_KIND_ORDER.reduce(
    (groups, kind) => {
      groups[kind] = items.filter((item) => item.kind === kind);
      return groups;
    },
    {} as Record<DigestKind, DigestItem[]>,
  );
}

function digestStatusLabel(params: {
  hasNotes: boolean;
  hasDigest: boolean;
  stale: boolean;
}): string {
  if (!params.hasNotes) return "Add notes";
  if (!params.hasDigest) return "Not analyzed";
  if (params.stale) return "Digest stale";
  return "Digest ready";
}

export function PersonalProfileDrawer({ isOpen, onClose }: Props) {
  const personalProfileState = useStore((s) => s.personalProfileState);
  const savePersonalProfileNotes = useStore((s) => s.savePersonalProfileNotes);
  const analyzePersonalProfileNotes = useStore(
    (s) => s.analyzePersonalProfileNotes,
  );
  const clearPersonalProfileDigest = useStore(
    (s) => s.clearPersonalProfileDigest,
  );
  const deletePersonalProfile = useStore((s) => s.deletePersonalProfile);
  const setPersonalProfileEnabled = useStore(
    (s) => s.setPersonalProfileEnabled,
  );
  const [draftNotes, setDraftNotes] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);

  const hasNotes = draftNotes.trim().length > 0;
  const overLimit = draftNotes.length > PROFILE_NOTES_MAX_CHARS;
  const hasDigest = Boolean(personalProfileState.digest);
  const draftNotesHash = useMemo(
    () => hashProfileNotes(draftNotes),
    [draftNotes],
  );
  const stale =
    isProfileDigestStale(personalProfileState) ||
    (hasDigest && personalProfileState.digest?.notesHash !== draftNotesHash);
  const digestItems = useMemo(
    () => personalProfileState.digest?.items ?? [],
    [personalProfileState.digest],
  );
  const groupedDigestItems = useMemo(
    () => groupDigestItems(digestItems),
    [digestItems],
  );
  const digestStatus = digestStatusLabel({ hasNotes, hasDigest, stale });
  const active = enabled && hasNotes;

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setDraftNotes(personalProfileState.notesMarkdown);
    setEnabled(personalProfileState.enabled);
    setStatus(null);
    setError(null);
    setDeleteArmed(false);
    setAnalyzing(false);
    closeButtonRef.current?.focus();
  }, [isOpen, personalProfileState]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable =
        drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleSave = async () => {
    if (overLimit) {
      setError(
        `Profile Notes must be ${PROFILE_NOTES_MAX_CHARS.toLocaleString()} characters or fewer.`,
      );
      return;
    }
    await savePersonalProfileNotes(draftNotes, enabled && hasNotes);
    setStatus("Notes saved");
    setError(null);
    setDeleteArmed(false);
  };

  const handleAnalyze = async () => {
    if (!hasNotes) {
      setError("Add Profile Notes before analyzing.");
      return;
    }
    if (overLimit) {
      setError(
        `Profile Notes must be ${PROFILE_NOTES_MAX_CHARS.toLocaleString()} characters or fewer.`,
      );
      return;
    }
    setAnalyzing(true);
    setStatus("Analyzing notes...");
    setError(null);
    try {
      await savePersonalProfileNotes(draftNotes, enabled && hasNotes);
      await analyzePersonalProfileNotes();
      setStatus("Digest ready");
      setDeleteArmed(false);
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "Profile analysis failed.",
      );
      setStatus(null);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleClearDigest = async () => {
    await clearPersonalProfileDigest();
    setStatus("Digest cleared");
    setError(null);
    setDeleteArmed(false);
  };

  const handleEnabledChange = async (nextEnabled: boolean) => {
    setEnabled(nextEnabled);
    if (hasUsablePersonalProfile(personalProfileState)) {
      await setPersonalProfileEnabled(nextEnabled);
    }
  };

  const handleDelete = async () => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    await deletePersonalProfile();
    setDraftNotes("");
    setEnabled(false);
    setStatus("Deleted");
    setError(null);
    setDeleteArmed(false);
  };

  if (!isOpen) return null;

  return (
    <div
      className="absolute inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Personalize"
    >
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-sm backdrop-enter"
        onClick={onClose}
      />
      <div
        ref={drawerRef}
        className="relative flex h-full w-full max-w-[430px] flex-col border-l border-warm-200 bg-warm-50 shadow-2xl drawer-enter dark:border-warm-800 dark:bg-warm-900"
      >
        <header className="border-b border-warm-200 p-4 dark:border-warm-800">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="rounded-lg bg-primary-50 p-2 text-primary-600 dark:bg-primary-950/40 dark:text-primary-300">
                <UserRound size={18} />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-warm-900 dark:text-warm-100">
                  Personalize
                </h2>
                <p className="mt-0.5 text-xs text-warm-500 dark:text-warm-400">
                  Keep user-owned notes and review the extracted digest.
                </p>
              </div>
            </div>
            <button
              ref={closeButtonRef}
              onClick={onClose}
              className="rounded-full p-2 text-warm-500 hover:bg-warm-100 dark:hover:bg-warm-800"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-warm-200 bg-white px-3 py-2 dark:border-warm-800 dark:bg-warm-950">
            <div className="min-w-0">
              <p className="text-sm font-medium text-warm-800 dark:text-warm-100">
                Use Profile Notes
              </p>
              <p className="text-[11px] text-warm-500 dark:text-warm-400">
                {active ? "Enabled for this browser" : digestStatus}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleEnabledChange(!enabled)}
              className={`relative h-6 w-11 rounded-full transition ${
                enabled ? "bg-primary-600" : "bg-warm-300 dark:bg-warm-700"
              }`}
              aria-pressed={enabled}
              aria-label="Use Profile Notes"
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${
                  enabled ? "left-5" : "left-0.5"
                }`}
              />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="space-y-4">
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <FileText size={15} className="text-warm-400" />
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-warm-400">
                    Profile Notes
                  </h3>
                </div>
                <span
                  className={`text-[11px] ${
                    overLimit
                      ? "text-red-500"
                      : "text-warm-400 dark:text-warm-500"
                  }`}
                >
                  {draftNotes.length.toLocaleString()} /{" "}
                  {PROFILE_NOTES_MAX_CHARS.toLocaleString()}
                </span>
              </div>
              <label className="block">
                <span className="sr-only">Profile Notes</span>
                <textarea
                  value={draftNotes}
                  onChange={(event) => {
                    setDraftNotes(event.target.value);
                    setStatus(null);
                    setError(null);
                    setDeleteArmed(false);
                  }}
                  placeholder={DEFAULT_PROFILE_NOTES_MARKDOWN}
                  rows={16}
                  className="w-full resize-none rounded-md border border-warm-200 bg-white px-3 py-2 font-mono text-xs leading-relaxed text-warm-800 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-500/20 dark:border-warm-700 dark:bg-warm-950 dark:text-warm-100"
                />
              </label>
            </section>

            <section className="space-y-3 border-t border-warm-200 pt-4 dark:border-warm-800">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles size={15} className="text-warm-400" />
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-warm-400">
                    Profile Digest
                  </h3>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    !hasNotes || stale
                      ? "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
                      : "bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-200"
                  }`}
                >
                  {digestStatus}
                </span>
              </div>

              {personalProfileState.analyzer ? (
                <p className="text-[11px] text-warm-500 dark:text-warm-400">
                  Last analyzed with {personalProfileState.analyzer.model} at{" "}
                  {new Date(
                    personalProfileState.analyzer.analyzedAt,
                  ).toLocaleString()}
                </p>
              ) : null}

              {digestItems.length === 0 ? (
                <div className="rounded-md border border-dashed border-warm-300 px-3 py-4 text-center text-xs text-warm-500 dark:border-warm-700 dark:text-warm-400">
                  Analyze notes to extract facts, preferences, constraints,
                  themes, sensitive items, and open questions.
                </div>
              ) : (
                <div className="space-y-3">
                  {DIGEST_KIND_ORDER.map((kind) => {
                    const items = groupedDigestItems[kind];
                    if (!items || items.length === 0) return null;
                    return (
                      <div key={kind} className="space-y-1.5">
                        <h4 className="text-[11px] font-semibold text-warm-500 dark:text-warm-400">
                          {DIGEST_KIND_LABELS[kind]}
                        </h4>
                        <div className="space-y-1.5">
                          {items.map((item) => (
                            <div
                              key={item.id}
                              className="rounded-md border border-warm-200 bg-white px-2.5 py-2 text-xs dark:border-warm-800 dark:bg-warm-950"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <span className="font-medium text-warm-800 dark:text-warm-100">
                                  {item.label}
                                </span>
                                <span className="shrink-0 text-[10px] uppercase text-warm-400">
                                  {item.confidence}
                                </span>
                              </div>
                              <p className="mt-1 text-warm-600 dark:text-warm-300">
                                {item.value}
                              </p>
                              {item.sourceQuote ? (
                                <p className="mt-1 line-clamp-2 text-[11px] text-warm-400 dark:text-warm-500">
                                  Source: {item.sourceQuote}
                                </p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>

        <footer className="border-t border-warm-200 bg-warm-50 p-3 dark:border-warm-800 dark:bg-warm-900">
          {error ? (
            <div className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => void handleSave()}
              disabled={overLimit}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save size={15} />
              Save Notes
            </button>
            <button
              onClick={() => void handleAnalyze()}
              disabled={analyzing || !hasNotes || overLimit}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-primary-200 bg-white px-3 py-2 text-sm font-semibold text-primary-700 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-primary-800 dark:bg-warm-950 dark:text-primary-200 dark:hover:bg-primary-900/20"
            >
              {analyzing ? (
                <RefreshCw size={15} className="animate-spin" />
              ) : (
                <Sparkles size={15} />
              )}
              Analyze
            </button>
            <button
              onClick={() => void handleClearDigest()}
              disabled={!hasDigest}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-warm-300 px-3 py-2 text-sm font-semibold text-warm-600 hover:bg-warm-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-warm-700 dark:text-warm-300 dark:hover:bg-warm-800"
            >
              <X size={15} />
              Clear Digest
            </button>
            <button
              onClick={() => void handleDelete()}
              className={`inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${
                deleteArmed
                  ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
                  : "border-warm-300 text-warm-600 hover:bg-warm-100 dark:border-warm-700 dark:text-warm-300 dark:hover:bg-warm-800"
              }`}
            >
              {deleteArmed ? <Check size={15} /> : <Trash2 size={15} />}
              {deleteArmed ? "Confirm" : "Delete"}
            </button>
          </div>
          {status ? (
            <p className="mt-2 text-center text-xs text-warm-500 dark:text-warm-400">
              {status}
            </p>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
