import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  FileText,
  Pencil,
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
  PROFILE_DIGEST_LABEL_MAX_CHARS,
  PROFILE_DIGEST_VALUE_MAX_CHARS,
  PROFILE_NOTES_MAX_CHARS,
  hashProfileNotes,
  hasUsablePersonalProfile,
  isProfileDigestStale,
  type DigestItem,
  type DigestKind,
} from "../../utils/personal-profile";
import { PersonalDataSyncBadge } from "./PersonalDataSyncBadge";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR = [
  "button:not(:disabled)",
  "[href]",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

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
  const updatePersonalProfileDigestItem = useStore(
    (s) => s.updatePersonalProfileDigestItem,
  );
  const deletePersonalProfileDigestItem = useStore(
    (s) => s.deletePersonalProfileDigestItem,
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
  const [analysisElapsedSeconds, setAnalysisElapsedSeconds] = useState(0);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [editingDigestItemId, setEditingDigestItemId] = useState<string | null>(
    null,
  );
  const [deleteDigestItemId, setDeleteDigestItemId] = useState<string | null>(
    null,
  );
  const [digestEditDraft, setDigestEditDraft] = useState<{
    label: string;
    value: string;
    kind: DigestKind;
  } | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const analysisInFlightRef = useRef(false);

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
  const drawerLocked = analyzing;
  const digestItemControlsDisabled = drawerLocked || stale || overLimit;

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      analysisInFlightRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setDraftNotes(personalProfileState.notesMarkdown);
    setEnabled(personalProfileState.enabled);
    setStatus(null);
    setError(null);
    setDeleteArmed(false);
    setEditingDigestItemId(null);
    setDeleteDigestItemId(null);
    setDigestEditDraft(null);
    setAnalyzing(false);
    closeButtonRef.current?.focus();
  }, [isOpen, personalProfileState]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!drawerLocked) onClose();
        event.preventDefault();
        return;
      }
      if (drawerLocked && event.key === "Tab") {
        event.preventDefault();
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
  }, [drawerLocked, isOpen, onClose]);

  useEffect(() => {
    if (!analyzing) {
      setAnalysisElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setAnalysisElapsedSeconds(0);
    const intervalId = window.setInterval(() => {
      setAnalysisElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [analyzing]);

  const handleSave = async () => {
    if (drawerLocked || analysisInFlightRef.current) return;
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
    if (drawerLocked || analysisInFlightRef.current) return;
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
    analysisInFlightRef.current = true;
    setAnalyzing(true);
    setStatus("Analyzing notes...");
    setError(null);
    try {
      await savePersonalProfileNotes(draftNotes, enabled && hasNotes);
      await analyzePersonalProfileNotes();
      setStatus("Digest ready");
      setDeleteArmed(false);
      setEditingDigestItemId(null);
      setDeleteDigestItemId(null);
      setDigestEditDraft(null);
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "Profile analysis failed.",
      );
      setStatus(null);
    } finally {
      analysisInFlightRef.current = false;
      setAnalyzing(false);
    }
  };

  const handleClearDigest = async () => {
    if (drawerLocked || analysisInFlightRef.current) return;
    await clearPersonalProfileDigest();
    setStatus("Digest cleared");
    setError(null);
    setDeleteArmed(false);
    setEditingDigestItemId(null);
    setDeleteDigestItemId(null);
    setDigestEditDraft(null);
  };

  const handleStartDigestEdit = (item: DigestItem) => {
    if (digestItemControlsDisabled || analysisInFlightRef.current) return;
    setEditingDigestItemId(item.id);
    setDigestEditDraft({
      label: item.label,
      value: item.value,
      kind: item.kind,
    });
    setDeleteDigestItemId(null);
    setStatus(null);
    setError(null);
  };

  const handleCancelDigestEdit = () => {
    setEditingDigestItemId(null);
    setDigestEditDraft(null);
  };

  const handleSaveDigestEdit = async (itemId: string) => {
    if (
      digestItemControlsDisabled ||
      analysisInFlightRef.current ||
      !digestEditDraft
    ) {
      return;
    }
    if (!digestEditDraft.label.trim() || !digestEditDraft.value.trim()) {
      setError("Digest item label and value are required.");
      return;
    }
    try {
      const state = await updatePersonalProfileDigestItem(itemId, {
        label: digestEditDraft.label,
        value: digestEditDraft.value,
        kind: digestEditDraft.kind,
      });
      setDraftNotes(state.notesMarkdown);
      setEditingDigestItemId(null);
      setDigestEditDraft(null);
      setDeleteDigestItemId(null);
      setDeleteArmed(false);
      setStatus("Digest item updated");
      setError(null);
    } catch (editError) {
      setError(
        editError instanceof Error
          ? editError.message
          : "Digest item update failed.",
      );
      setStatus(null);
    }
  };

  const handleDeleteDigestItem = async (itemId: string) => {
    if (digestItemControlsDisabled || analysisInFlightRef.current) return;
    if (deleteDigestItemId !== itemId) {
      setDeleteDigestItemId(itemId);
      setEditingDigestItemId(null);
      setDigestEditDraft(null);
      setStatus(null);
      setError(null);
      return;
    }
    try {
      const state = await deletePersonalProfileDigestItem(itemId);
      setDraftNotes(state.notesMarkdown);
      setEditingDigestItemId(null);
      setDigestEditDraft(null);
      setDeleteDigestItemId(null);
      setDeleteArmed(false);
      setStatus("Digest item deleted");
      setError(null);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Digest item delete failed.",
      );
      setStatus(null);
    }
  };

  const handleEnabledChange = async (nextEnabled: boolean) => {
    if (drawerLocked || analysisInFlightRef.current) return;
    setEnabled(nextEnabled);
    if (hasUsablePersonalProfile(personalProfileState)) {
      await setPersonalProfileEnabled(nextEnabled);
    }
  };

  const handleDelete = async () => {
    if (drawerLocked || analysisInFlightRef.current) return;
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
    setEditingDigestItemId(null);
    setDeleteDigestItemId(null);
    setDigestEditDraft(null);
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
        className="absolute inset-0 bg-fg/20 backdrop-blur-sm backdrop-enter"
        onClick={drawerLocked ? undefined : onClose}
      />
      <div
        ref={drawerRef}
        className="relative flex h-full w-full max-w-[430px] flex-col border-l border-line bg-canvas shadow-sm drawer-enter"
        aria-busy={analyzing}
      >
        <header className="border-b border-line p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="rounded-lg bg-accent-subtle p-2 text-accent-text">
                <UserRound size={18} />
              </div>
              <div className="min-w-0">
                <h2 className="text-ui-title font-semibold text-fg">
                  Personalize
                </h2>
                <PersonalDataSyncBadge category="profile" />
                <p className="mt-0.5 text-ui-control text-fg-tertiary">
                  Keep user-owned notes and review the extracted digest.
                </p>
              </div>
            </div>
            <button
              ref={closeButtonRef}
              onClick={onClose}
              disabled={drawerLocked}
              className="rounded-full p-2 text-fg-tertiary hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2">
            <div className="min-w-0">
              <p className="text-ui-body font-medium text-fg">
                Use Profile Notes
              </p>
              <p className="text-ui-caption text-fg-tertiary">
                {active ? "Enabled for this browser" : digestStatus}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleEnabledChange(!enabled)}
              disabled={drawerLocked}
              className={`relative h-6 w-11 rounded-full transition ${
                enabled ? "bg-accent" : "bg-line-strong"
              } disabled:cursor-not-allowed disabled:opacity-60`}
              aria-pressed={enabled}
              aria-label="Use Profile Notes"
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-surface shadow transition ${
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
                  <FileText size={15} className="text-fg-tertiary" />
                  <h3 className="text-ui-control font-semibold uppercase tracking-wide text-fg-tertiary">
                    Profile Notes
                  </h3>
                </div>
                <span
                  className={`text-ui-caption ${
                    overLimit
                      ? "text-danger"
                      : "text-fg-tertiary"
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
                  disabled={drawerLocked}
                  onChange={(event) => {
                    setDraftNotes(event.target.value);
                    setStatus(null);
                    setError(null);
                    setDeleteArmed(false);
                    setEditingDigestItemId(null);
                    setDeleteDigestItemId(null);
                    setDigestEditDraft(null);
                  }}
                  placeholder={DEFAULT_PROFILE_NOTES_MARKDOWN}
                  rows={16}
                  className="w-full resize-none rounded-md border border-line bg-surface px-3 py-2 font-mono text-ui-control leading-relaxed text-fg outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-70"
                />
              </label>
            </section>

            <section className="space-y-3 border-t border-line pt-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles size={15} className="text-fg-tertiary" />
                  <h3 className="text-ui-control font-semibold uppercase tracking-wide text-fg-tertiary">
                    Profile Digest
                  </h3>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-ui-caption font-medium ${
                    !hasNotes || stale
                      ? "bg-warning-subtle text-warning"
                      : "bg-accent-subtle text-accent-text"
                  }`}
                >
                  {digestStatus}
                </span>
              </div>

              {personalProfileState.analyzer ? (
                <p className="text-ui-caption text-fg-tertiary">
                  Last analyzed with {personalProfileState.analyzer.model} at{" "}
                  {new Date(
                    personalProfileState.analyzer.analyzedAt,
                  ).toLocaleString()}
                </p>
              ) : null}

              {digestItems.length === 0 ? (
                <div className="rounded-md border border-dashed border-line-strong px-3 py-4 text-center text-ui-control text-fg-tertiary">
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
                        <h4 className="text-ui-caption font-semibold text-fg-tertiary">
                          {DIGEST_KIND_LABELS[kind]}
                        </h4>
                        <div className="space-y-1.5">
                          {items.map((item) => {
                            const isEditing = editingDigestItemId === item.id;
                            const isDeleteConfirming =
                              deleteDigestItemId === item.id;
                            const editInvalid =
                              !digestEditDraft?.label.trim() ||
                              !digestEditDraft?.value.trim();
                            return (
                              <div
                                key={item.id}
                                className="rounded-md border border-line bg-surface px-2.5 py-2 text-ui-control"
                              >
                                {isEditing && digestEditDraft ? (
                                  <div className="space-y-2">
                                    <input
                                      value={digestEditDraft.label}
                                      maxLength={PROFILE_DIGEST_LABEL_MAX_CHARS}
                                      onChange={(event) =>
                                        setDigestEditDraft({
                                          ...digestEditDraft,
                                          label: event.target.value,
                                        })
                                      }
                                      className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-ui-control text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                                      aria-label="Digest item label"
                                    />
                                    <textarea
                                      value={digestEditDraft.value}
                                      maxLength={PROFILE_DIGEST_VALUE_MAX_CHARS}
                                      rows={3}
                                      onChange={(event) =>
                                        setDigestEditDraft({
                                          ...digestEditDraft,
                                          value: event.target.value,
                                        })
                                      }
                                      className="w-full resize-none rounded-md border border-line bg-surface px-2 py-1.5 text-ui-control leading-relaxed text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                                      aria-label="Digest item value"
                                    />
                                    <select
                                      value={digestEditDraft.kind}
                                      onChange={(event) =>
                                        setDigestEditDraft({
                                          ...digestEditDraft,
                                          kind: event.target.value as DigestKind,
                                        })
                                      }
                                      className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-ui-control text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                                      aria-label="Digest item kind"
                                    >
                                      {DIGEST_KIND_ORDER.map((digestKind) => (
                                        <option
                                          key={digestKind}
                                          value={digestKind}
                                        >
                                          {DIGEST_KIND_LABELS[digestKind]}
                                        </option>
                                      ))}
                                    </select>
                                    <div className="flex justify-end gap-1.5">
                                      <button
                                        type="button"
                                        onClick={handleCancelDigestEdit}
                                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line text-fg-tertiary hover:bg-surface-subtle"
                                        aria-label="Cancel digest item edit"
                                        title="Cancel"
                                      >
                                        <X size={14} />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void handleSaveDigestEdit(item.id)
                                        }
                                        disabled={
                                          digestItemControlsDisabled ||
                                          editInvalid
                                        }
                                        className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-fg hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                                        aria-label="Save digest item edit"
                                        title="Save"
                                      >
                                        <Check size={14} />
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <div className="flex items-start justify-between gap-2">
                                      <span className="font-medium text-fg">
                                        {item.label}
                                      </span>
                                      <div className="flex shrink-0 items-center gap-1">
                                        <span className="text-ui-caption uppercase text-fg-tertiary">
                                          {item.confidence}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleStartDigestEdit(item)
                                          }
                                          disabled={digestItemControlsDisabled}
                                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-fg-tertiary hover:bg-surface-subtle hover:text-fg-secondary disabled:cursor-not-allowed disabled:opacity-50"
                                          aria-label={`Edit ${item.label}`}
                                          title={
                                            stale
                                              ? "Analyze current notes before editing digest items"
                                              : "Edit"
                                          }
                                        >
                                          <Pencil size={13} />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            void handleDeleteDigestItem(item.id)
                                          }
                                          disabled={digestItemControlsDisabled}
                                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-fg-tertiary hover:bg-danger-subtle hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
                                          aria-label={`Delete ${item.label}`}
                                          title={
                                            stale
                                              ? "Analyze current notes before deleting digest items"
                                              : "Delete"
                                          }
                                        >
                                          <Trash2 size={13} />
                                        </button>
                                      </div>
                                    </div>
                                    <p className="mt-1 text-fg-secondary">
                                      {item.value}
                                    </p>
                                    {item.sourceQuote ? (
                                      <p className="mt-1 line-clamp-2 text-ui-caption text-fg-tertiary">
                                        Source: {item.sourceQuote}
                                      </p>
                                    ) : null}
                                    {isDeleteConfirming ? (
                                      <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-danger/30 bg-danger-subtle px-2 py-1.5 text-ui-caption text-danger">
                                        <span>Delete this digest item?</span>
                                        <div className="flex gap-1">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setDeleteDigestItemId(null)
                                            }
                                            className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-danger-subtle"
                                            aria-label="Cancel digest item delete"
                                            title="Cancel"
                                          >
                                            <X size={13} />
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              void handleDeleteDigestItem(
                                                item.id,
                                              )
                                            }
                                            disabled={digestItemControlsDisabled}
                                            className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-danger text-canvas hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-50"
                                            aria-label="Confirm digest item delete"
                                            title="Confirm delete"
                                          >
                                            <Check size={13} />
                                          </button>
                                        </div>
                                      </div>
                                    ) : null}
                                  </>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>

        <footer className="border-t border-line bg-canvas p-3">
          {error ? (
            <div className="mb-2 rounded-md border border-danger/30 bg-danger-subtle px-3 py-2 text-ui-control text-danger">
              {error}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => void handleSave()}
              disabled={drawerLocked || overLimit}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-3 py-2 text-ui-body font-semibold text-accent-fg hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Save size={15} />
              Save Notes
            </button>
            <button
              onClick={() => void handleAnalyze()}
              disabled={drawerLocked || !hasNotes || overLimit}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-accent/30 bg-surface px-3 py-2 text-ui-body font-semibold text-accent-text hover:bg-accent-subtle disabled:cursor-not-allowed disabled:opacity-50"
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
              disabled={drawerLocked || !hasDigest}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-line-strong px-3 py-2 text-ui-body font-semibold text-fg-secondary hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X size={15} />
              Clear Digest
            </button>
            <button
              onClick={() => void handleDelete()}
              disabled={drawerLocked}
              className={`inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-ui-body font-semibold ${
                deleteArmed
                  ? "border-danger/30 bg-danger-subtle text-danger hover:bg-danger/10"
                  : "border-line-strong text-fg-secondary hover:bg-surface-subtle"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {deleteArmed ? <Check size={15} /> : <Trash2 size={15} />}
              {deleteArmed ? "Confirm" : "Delete"}
            </button>
          </div>
          {status ? (
            <p className="mt-2 text-center text-ui-control text-fg-tertiary">
              {status}
            </p>
          ) : null}
        </footer>
        {analyzing ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-canvas px-4 backdrop-blur-sm">
            <div
              className="w-full max-w-[330px] rounded-lg border border-line bg-surface px-4 py-5 text-center shadow-sm"
              role="status"
              aria-live="polite"
            >
              <RefreshCw
                size={22}
                className="mx-auto animate-spin text-accent-text"
              />
              <h3 className="mt-3 text-ui-body font-semibold text-fg">
                Analyzing Profile Notes
              </h3>
              <p className="mt-2 text-ui-control leading-relaxed text-fg-secondary">
                Extracting facts, preferences, constraints, themes, sensitive
                items, and open questions.
              </p>
              <p
                className="mt-3 text-ui-caption text-fg-tertiary"
                aria-hidden="true"
              >
                {draftNotes.length.toLocaleString()} chars -{" "}
                {analysisElapsedSeconds}s elapsed
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
