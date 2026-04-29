import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Eye,
  HelpCircle,
  Pencil,
  Play,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useStore } from "../store";
import type { UserWebsiteSkill, UserWebsiteSkillDraft } from "../../types";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onStartRecording: () => void;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function WebsiteSkillsDrawer({
  isOpen,
  onClose,
  onStartRecording,
}: Props) {
  const skills = useStore((s) => s.userWebsiteSkills);
  const updateSkill = useStore((s) => s.updateUserWebsiteSkillLocal);
  const deleteSkill = useStore((s) => s.deleteUserWebsiteSkill);
  const [editing, setEditing] = useState<UserWebsiteSkill | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (editing) setEditing(null);
        else onClose();
        return;
      }
      if (event.key === "Tab" && drawerRef.current) {
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
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editing, isOpen, onClose]);

  const grouped = useMemo(() => {
    const map = new Map<string, UserWebsiteSkill[]>();
    for (const skill of skills) {
      const key = skill.origin || "Unknown website";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(skill);
    }
    return [...map.entries()];
  }, [skills]);

  if (!isOpen) return null;

  return (
    <div
      className="absolute inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Website Skills"
    >
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-sm backdrop-enter"
        onClick={onClose}
      />

      <div
        ref={drawerRef}
        className="relative w-full max-w-[340px] h-full bg-warm-50 dark:bg-warm-900 shadow-2xl flex flex-col border-l border-warm-200 dark:border-warm-800 drawer-enter"
      >
        <header className="flex items-center justify-between p-4 border-b border-warm-200 dark:border-warm-800">
          <div>
            <h2 className="font-semibold text-lg dark:text-warm-100">
              Website Skills
            </h2>
            <p className="text-xs text-warm-500 dark:text-warm-400">
              Recorded workflows grouped by site
            </p>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="p-2 hover:bg-warm-100 dark:hover:bg-warm-800 rounded-full"
            aria-label="Close"
          >
            <X size={20} className="text-warm-500" />
          </button>
        </header>

        <div className="p-4 border-b border-warm-200 dark:border-warm-800">
          <button
            onClick={onStartRecording}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            <Play size={15} />
            Record Skill
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {editing ? (
            <SkillEditForm
              skill={editing}
              onCancel={() => setEditing(null)}
              onSave={async (draft) => {
                await updateSkill(editing.id, {
                  name: draft.name,
                  origin: draft.origin,
                  pathPattern: draft.pathPattern,
                  triggerPhrase: draft.triggerPhrase,
                  workflowSteps: draft.workflowSteps,
                  requiredEvidence: draft.requiredEvidence,
                  privacySummary: draft.privacySummary,
                });
                setEditing(null);
              }}
            />
          ) : skills.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-sm text-warm-500 dark:text-warm-400 mb-3">
                No website skills yet
              </p>
              <button
                onClick={onStartRecording}
                className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
              >
                Teach your first workflow
              </button>
            </div>
          ) : (
            grouped.map(([origin, items]) => (
              <section key={origin}>
                <h3 className="text-xs font-semibold uppercase text-warm-400 tracking-wider mb-2 truncate">
                  {origin}
                </h3>
                <div className="space-y-2">
                  {items.map((skill) => (
                    <div
                      key={skill.id}
                      className="rounded-lg border border-warm-200 dark:border-warm-700 bg-warm-50/70 dark:bg-warm-900/70 p-3"
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-warm-800 dark:text-warm-100 truncate">
                            {skill.name}
                          </p>
                          <p className="text-xs text-warm-500 dark:text-warm-400 truncate">
                            {skill.pathPattern}
                          </p>
                          <p className="text-[11px] text-warm-400 mt-1">
                            Updated {new Date(skill.updatedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <label className="inline-flex items-center gap-1 text-xs text-warm-500">
                          <input
                            type="checkbox"
                            checked={skill.enabled}
                            onChange={(event) =>
                              updateSkill(skill.id, {
                                enabled: event.target.checked,
                              })
                            }
                            className="h-3.5 w-3.5 rounded border-warm-300"
                          />
                          On
                        </label>
                      </div>
                      <div className="mt-2 flex items-center gap-1">
                        <button
                          onClick={() => setEditing(skill)}
                          className="p-1.5 rounded hover:bg-warm-100 dark:hover:bg-warm-800 text-warm-500"
                          aria-label={`Edit ${skill.name}`}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => deleteSkill(skill.id)}
                          className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-warm-500 hover:text-red-600"
                          aria-label={`Delete ${skill.name}`}
                        >
                          <Trash2 size={14} />
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

interface ReviewProps {
  onHelp: () => void;
}

export function SkillRecordingPanel({ onHelp }: ReviewProps) {
  const status = useStore((s) => s.skillRecordingStatus);
  const timeline = useStore((s) => s.skillRecordingTimeline);
  const draft = useStore((s) => s.skillRecordingDraft);
  const stop = useStore((s) => s.stopSkillRecording);
  const cancel = useStore((s) => s.cancelSkillRecording);
  const save = useStore((s) => s.saveUserWebsiteSkill);
  const clearDraft = useStore((s) => s.clearSkillRecordingDraft);
  const [showDetails, setShowDetails] = useState(false);

  if (status === "idle" && !draft) return null;

  return (
    <div className="mx-4 mt-2 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50/85 dark:bg-red-950/20 p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold text-red-800 dark:text-red-200">
            <span className="h-2 w-2 rounded-full bg-red-600 animate-pulse" />
            {status === "review" ? "Review recorded skill" : "Recording site skill"}
          </div>
          <p className="mt-1 text-xs text-red-700/80 dark:text-red-200/75">
            Typed values are redacted.
          </p>
        </div>
        <button
          onClick={onHelp}
          className="p-1.5 rounded-full text-red-700 hover:bg-red-100 dark:text-red-200 dark:hover:bg-red-900/30"
          aria-label="Recording help"
        >
          <HelpCircle size={15} />
        </button>
      </div>

      {status === "recording" || status === "paused" ? (
        <>
          <ol className="mt-3 max-h-28 overflow-y-auto space-y-1 text-xs text-warm-700 dark:text-warm-200">
            {(timeline.length > 0
              ? timeline.slice(-5)
              : [
                  status === "paused"
                    ? "Recording paused on restricted page"
                    : "Waiting for actions on the page",
                ]
            ).map((item, index) => (
              <li key={`${item}-${index}`} className="truncate">
                {item}
              </li>
            ))}
          </ol>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => stop()}
              className="flex-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
            >
              Stop
            </button>
            <button
              onClick={() => cancel()}
              className="rounded-md border border-red-200 dark:border-red-900 px-3 py-1.5 text-xs font-semibold text-red-700 dark:text-red-200 hover:bg-red-100 dark:hover:bg-red-900/30"
            >
              Cancel
            </button>
          </div>
        </>
      ) : draft ? (
        <SkillDraftReview
          draft={draft}
          showDetails={showDetails}
          timeline={timeline}
          onToggleDetails={() => setShowDetails((value) => !value)}
          onDiscard={clearDraft}
          onSave={save}
        />
      ) : null}
    </div>
  );
}

function SkillDraftReview({
  draft,
  timeline,
  showDetails,
  onToggleDetails,
  onDiscard,
  onSave,
}: {
  draft: UserWebsiteSkillDraft;
  timeline: string[];
  showDetails: boolean;
  onToggleDetails: () => void;
  onDiscard: () => void;
  onSave: (draft: UserWebsiteSkillDraft) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [workingDraft, setWorkingDraft] = useState(draft);

  useEffect(() => {
    setWorkingDraft(draft);
  }, [draft]);

  if (editing) {
    return (
      <SkillEditForm
        skill={{ ...workingDraft, enabled: true }}
        onCancel={() => setEditing(false)}
        onSave={async (next) => {
          setWorkingDraft(next);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-md border border-red-100 dark:border-red-900/50 bg-white/70 dark:bg-warm-950/30 p-2">
        <p className="text-sm font-semibold text-warm-800 dark:text-warm-100">
          {workingDraft.name}
        </p>
        <p className="text-xs text-warm-500 dark:text-warm-400">
          {workingDraft.origin}
          {workingDraft.pathPattern}
        </p>
        <p className="mt-1 text-xs text-warm-600 dark:text-warm-300">
          Trigger: {workingDraft.triggerPhrase}
        </p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase text-warm-400 mb-1">
          Workflow
        </p>
        <ol className="space-y-1 text-xs text-warm-700 dark:text-warm-200">
          {workingDraft.workflowSteps.map((step, index) => (
            <li key={`${step}-${index}`}>{step}</li>
          ))}
        </ol>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase text-warm-400 mb-1">
          Evidence
        </p>
        <ul className="space-y-1 text-xs text-warm-700 dark:text-warm-200">
          {workingDraft.requiredEvidence.map((item, index) => (
            <li key={`${item}-${index}`}>{item}</li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-warm-500 dark:text-warm-400">
        {workingDraft.privacySummary}
      </p>
      {showDetails && (
        <div className="max-h-24 overflow-y-auto rounded-md bg-warm-100 dark:bg-warm-800 p-2 text-xs text-warm-600 dark:text-warm-300">
          {timeline.map((item, index) => (
            <div key={`${item}-${index}`}>{item}</div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onSave(workingDraft)}
          className="inline-flex items-center justify-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
        >
          <Save size={13} />
          Save Skill
        </button>
        <button
          onClick={() => setEditing(true)}
          className="inline-flex items-center justify-center gap-1 rounded-md border border-warm-300 dark:border-warm-700 px-3 py-1.5 text-xs font-semibold text-warm-700 dark:text-warm-200 hover:bg-warm-100 dark:hover:bg-warm-800"
        >
          <Pencil size={13} />
          Edit
        </button>
        <button
          onClick={onDiscard}
          className="rounded-md border border-warm-300 dark:border-warm-700 px-3 py-1.5 text-xs font-semibold text-warm-700 dark:text-warm-200 hover:bg-warm-100 dark:hover:bg-warm-800"
        >
          Discard
        </button>
        <button
          onClick={onToggleDetails}
          className="inline-flex items-center justify-center gap-1 rounded-md border border-warm-300 dark:border-warm-700 px-3 py-1.5 text-xs font-semibold text-warm-700 dark:text-warm-200 hover:bg-warm-100 dark:hover:bg-warm-800"
        >
          <Eye size={13} />
          {showDetails ? "Hide details" : "Show captured details"}
        </button>
      </div>
    </div>
  );
}

function SkillEditForm({
  skill,
  onCancel,
  onSave,
}: {
  skill: UserWebsiteSkill;
  onCancel: () => void;
  onSave: (draft: UserWebsiteSkillDraft) => Promise<void>;
}) {
  const [name, setName] = useState(skill.name);
  const [origin, setOrigin] = useState(skill.origin);
  const [pathPattern, setPathPattern] = useState(skill.pathPattern);
  const [triggerPhrase, setTriggerPhrase] = useState(skill.triggerPhrase);
  const [workflow, setWorkflow] = useState(skill.workflowSteps.join("\n"));
  const [evidence, setEvidence] = useState(skill.requiredEvidence.join("\n"));

  const toDraft = (): UserWebsiteSkillDraft => ({
    id: skill.id,
    name: name.trim(),
    origin: origin.trim(),
    pathPattern: pathPattern.trim() || "/",
    triggerPhrase: triggerPhrase.trim(),
    workflowSteps: workflow
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean),
    requiredEvidence: evidence
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean),
    privacySummary: skill.privacySummary,
    capturedEventCount: skill.capturedEventCount,
    createdAt: skill.createdAt,
    updatedAt: Date.now(),
  });

  return (
    <div className="space-y-2 rounded-lg border border-primary-300 dark:border-primary-700 bg-primary-50/50 dark:bg-primary-900/20 p-3">
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Skill name"
        className="w-full px-2.5 py-1.5 text-sm border border-warm-300 dark:border-warm-700 rounded-md bg-warm-50 dark:bg-warm-900 focus:ring-2 focus:ring-primary-500 outline-none dark:text-warm-100"
      />
      <input
        value={origin}
        onChange={(event) => setOrigin(event.target.value)}
        placeholder="Website origin"
        className="w-full px-2.5 py-1.5 text-sm border border-warm-300 dark:border-warm-700 rounded-md bg-warm-50 dark:bg-warm-900 focus:ring-2 focus:ring-primary-500 outline-none dark:text-warm-100"
      />
      <input
        value={pathPattern}
        onChange={(event) => setPathPattern(event.target.value)}
        placeholder="Path pattern"
        className="w-full px-2.5 py-1.5 text-sm border border-warm-300 dark:border-warm-700 rounded-md bg-warm-50 dark:bg-warm-900 focus:ring-2 focus:ring-primary-500 outline-none dark:text-warm-100"
      />
      <input
        value={triggerPhrase}
        onChange={(event) => setTriggerPhrase(event.target.value)}
        placeholder="Trigger phrase"
        className="w-full px-2.5 py-1.5 text-sm border border-warm-300 dark:border-warm-700 rounded-md bg-warm-50 dark:bg-warm-900 focus:ring-2 focus:ring-primary-500 outline-none dark:text-warm-100"
      />
      <textarea
        value={workflow}
        onChange={(event) => setWorkflow(event.target.value)}
        rows={5}
        placeholder="Workflow steps, one per line"
        className="w-full px-2.5 py-1.5 text-sm border border-warm-300 dark:border-warm-700 rounded-md bg-warm-50 dark:bg-warm-900 focus:ring-2 focus:ring-primary-500 outline-none dark:text-warm-100 resize-none"
      />
      <textarea
        value={evidence}
        onChange={(event) => setEvidence(event.target.value)}
        rows={3}
        placeholder="Evidence, one item per line"
        className="w-full px-2.5 py-1.5 text-sm border border-warm-300 dark:border-warm-700 rounded-md bg-warm-50 dark:bg-warm-900 focus:ring-2 focus:ring-primary-500 outline-none dark:text-warm-100 resize-none"
      />
      <div className="flex gap-2">
        <button
          onClick={() => onSave(toDraft())}
          disabled={!name.trim() || !origin.trim() || !triggerPhrase.trim()}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-primary-600 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check size={14} />
          Save
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border border-warm-300 dark:border-warm-700 px-3 py-1.5 text-sm text-warm-600 dark:text-warm-300 hover:bg-warm-100 dark:hover:bg-warm-800"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
