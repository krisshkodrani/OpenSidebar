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
import { PersonalDataSyncBadge } from "./PersonalDataSyncBadge";

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
        className="absolute inset-0 bg-fg/20 backdrop-blur-sm backdrop-enter"
        onClick={onClose}
      />

      <div
        ref={drawerRef}
        className="relative w-full max-w-[340px] h-full bg-canvas shadow-sm flex flex-col border-l border-line drawer-enter"
      >
        <header className="flex items-center justify-between p-4 border-b border-line">
          <div>
            <h2 className="font-semibold text-ui-title">
              Website Skills
            </h2>
            <PersonalDataSyncBadge category="website_skills" />
            <p className="text-ui-control text-fg-tertiary">
              Recorded workflows grouped by site
            </p>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="p-2 hover:bg-surface-subtle rounded-full"
            aria-label="Close"
          >
            <X size={20} className="text-fg-tertiary" />
          </button>
        </header>

        <div className="p-4 border-b border-line">
          <button
            onClick={onStartRecording}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-danger px-3 py-2 text-ui-body font-semibold text-canvas hover:bg-danger/90"
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
                  guardrails: draft.guardrails,
                  requiredEvidence: draft.requiredEvidence,
                  privacySummary: draft.privacySummary,
                });
                setEditing(null);
              }}
            />
          ) : skills.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-ui-body text-fg-tertiary mb-3">
                No website skills yet
              </p>
              <button
                onClick={onStartRecording}
                className="text-ui-body text-accent-text hover:underline"
              >
                Teach your first workflow
              </button>
            </div>
          ) : (
            grouped.map(([origin, items]) => (
              <section key={origin}>
                <h3 className="text-ui-control font-semibold uppercase text-fg-tertiary tracking-wider mb-2 truncate">
                  {origin}
                </h3>
                <div className="space-y-2">
                  {items.map((skill) => (
                    <div
                      key={skill.id}
                      className="rounded-lg border border-line bg-canvas p-3"
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-ui-body font-medium text-fg truncate">
                            {skill.name}
                          </p>
                          <p className="text-ui-control text-fg-tertiary truncate">
                            {skill.pathPattern}
                          </p>
                          <p className="text-ui-caption text-fg-tertiary mt-1">
                            Updated {new Date(skill.updatedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <label className="inline-flex items-center gap-1 text-ui-control text-fg-tertiary">
                          <input
                            type="checkbox"
                            checked={skill.enabled}
                            onChange={(event) =>
                              updateSkill(skill.id, {
                                enabled: event.target.checked,
                              })
                            }
                            className="h-3.5 w-3.5 rounded border-line-strong"
                          />
                          On
                        </label>
                      </div>
                      <div className="mt-2 flex items-center gap-1">
                        <button
                          onClick={() => setEditing(skill)}
                          className="p-1.5 rounded hover:bg-surface-subtle text-fg-tertiary"
                          aria-label={`Edit ${skill.name}`}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => deleteSkill(skill.id)}
                          className="p-1.5 rounded hover:bg-danger-subtle text-fg-tertiary hover:text-danger"
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
  const privacyNotice =
    status === "review" && draft
      ? draft.capturedInputCount > 0
        ? "Typed values are redacted."
        : "No typed values captured."
      : "Typed values are redacted if captured.";

  if (status === "idle" && !draft) return null;

  return (
    <div className="mx-4 mt-2 rounded-lg border border-danger/30 bg-danger-subtle p-3 text-ui-body">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-semibold text-danger">
            <span className="h-2 w-2 rounded-full bg-danger animate-pulse" />
            {status === "review" ? "Review recorded skill" : "Recording site skill"}
          </div>
          <p className="mt-1 text-ui-control text-danger">
            {privacyNotice}
          </p>
        </div>
        <button
          onClick={onHelp}
          className="p-1.5 rounded-full text-danger hover:bg-danger-subtle"
          aria-label="Recording help"
        >
          <HelpCircle size={15} />
        </button>
      </div>

      {status === "recording" || status === "paused" ? (
        <>
          <ol className="mt-3 max-h-28 overflow-y-auto space-y-1 text-ui-control text-fg-secondary">
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
              className="flex-1 rounded-md bg-danger px-3 py-1.5 text-ui-control font-semibold text-canvas hover:bg-danger/90"
            >
              Stop
            </button>
            <button
              onClick={() => cancel()}
              className="rounded-md border border-danger/30 px-3 py-1.5 text-ui-control font-semibold text-danger hover:bg-danger-subtle"
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
      <div className="rounded-md border border-danger/30 bg-surface p-2">
        <p className="text-ui-body font-semibold text-fg">
          {workingDraft.name}
        </p>
        <p className="text-ui-control text-fg-tertiary">
          {workingDraft.origin}
          {workingDraft.pathPattern}
        </p>
        <p className="mt-1 text-ui-control text-fg-secondary">
          Trigger: {workingDraft.triggerPhrase}
        </p>
      </div>
      <div>
        <p className="text-ui-control font-semibold uppercase text-fg-tertiary mb-1">
          Workflow
        </p>
        <ol className="space-y-1 text-ui-control text-fg-secondary">
          {workingDraft.workflowSteps.map((step, index) => (
            <li key={`${step}-${index}`}>{step}</li>
          ))}
        </ol>
      </div>
      {(workingDraft.guardrails ?? []).length > 0 && (
        <div>
          <p className="text-ui-control font-semibold uppercase text-fg-tertiary mb-1">
            Guardrails
          </p>
          <ul className="space-y-1 text-ui-control text-fg-secondary">
            {(workingDraft.guardrails ?? []).map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <p className="text-ui-control font-semibold uppercase text-fg-tertiary mb-1">
          Evidence
        </p>
        <ul className="space-y-1 text-ui-control text-fg-secondary">
          {workingDraft.requiredEvidence.map((item, index) => (
            <li key={`${item}-${index}`}>{item}</li>
          ))}
        </ul>
      </div>
      <p className="text-ui-control text-fg-tertiary">
        {workingDraft.privacySummary}
      </p>
      {showDetails && (
        <div className="max-h-24 overflow-y-auto rounded-md bg-surface-subtle p-2 text-ui-control text-fg-secondary">
          {timeline.map((item, index) => (
            <div key={`${item}-${index}`}>{item}</div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onSave(workingDraft)}
          className="inline-flex items-center justify-center gap-1 rounded-md bg-danger px-3 py-1.5 text-ui-control font-semibold text-canvas hover:bg-danger/90"
        >
          <Save size={13} />
          Save Skill
        </button>
        <button
          onClick={() => setEditing(true)}
          className="inline-flex items-center justify-center gap-1 rounded-md border border-line-strong px-3 py-1.5 text-ui-control font-semibold text-fg-secondary hover:bg-surface-subtle"
        >
          <Pencil size={13} />
          Edit
        </button>
        <button
          onClick={onDiscard}
          className="rounded-md border border-line-strong px-3 py-1.5 text-ui-control font-semibold text-fg-secondary hover:bg-surface-subtle"
        >
          Discard
        </button>
        <button
          onClick={onToggleDetails}
          className="inline-flex items-center justify-center gap-1 rounded-md border border-line-strong px-3 py-1.5 text-ui-control font-semibold text-fg-secondary hover:bg-surface-subtle"
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
  const [guardrails, setGuardrails] = useState(
    (skill.guardrails ?? []).join("\n"),
  );
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
    guardrails: guardrails
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean),
    requiredEvidence: evidence
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean),
    privacySummary: skill.privacySummary,
    capturedEventCount: skill.capturedEventCount,
    capturedInputCount: skill.capturedInputCount ?? 0,
    createdAt: skill.createdAt,
    updatedAt: Date.now(),
  });

  return (
    <div className="space-y-2 rounded-lg border border-accent/30 bg-accent-subtle p-3">
      <LabeledSkillField label="Skill name">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Skill name"
          className="w-full px-2.5 py-1.5 text-ui-body border border-line-strong rounded-md bg-canvas focus:ring-2 focus:ring-accent outline-none"
        />
      </LabeledSkillField>
      <LabeledSkillField label="Website origin">
        <input
          value={origin}
          onChange={(event) => setOrigin(event.target.value)}
          placeholder="https://example.com"
          className="w-full px-2.5 py-1.5 text-ui-body border border-line-strong rounded-md bg-canvas focus:ring-2 focus:ring-accent outline-none"
        />
      </LabeledSkillField>
      <LabeledSkillField label="Path pattern">
        <input
          value={pathPattern}
          onChange={(event) => setPathPattern(event.target.value)}
          placeholder="/course/*/learn/quiz/*"
          className="w-full overflow-x-auto px-2.5 py-1.5 text-ui-body border border-line-strong rounded-md bg-canvas focus:ring-2 focus:ring-accent outline-none"
        />
      </LabeledSkillField>
      <LabeledSkillField label="Trigger phrase">
        <input
          value={triggerPhrase}
          onChange={(event) => setTriggerPhrase(event.target.value)}
          placeholder="choose answers"
          className="w-full px-2.5 py-1.5 text-ui-body border border-line-strong rounded-md bg-canvas focus:ring-2 focus:ring-accent outline-none"
        />
      </LabeledSkillField>
      <LabeledSkillField label="Workflow steps">
        <textarea
          value={workflow}
          onChange={(event) => setWorkflow(event.target.value)}
          rows={5}
          placeholder="One workflow step per line"
          className="w-full px-2.5 py-1.5 text-ui-body border border-line-strong rounded-md bg-canvas focus:ring-2 focus:ring-accent outline-none resize-none"
        />
      </LabeledSkillField>
      <LabeledSkillField label="Guardrails">
        <textarea
          value={guardrails}
          onChange={(event) => setGuardrails(event.target.value)}
          rows={4}
          placeholder="One guardrail per line"
          className="w-full px-2.5 py-1.5 text-ui-body border border-line-strong rounded-md bg-canvas focus:ring-2 focus:ring-accent outline-none resize-none"
        />
      </LabeledSkillField>
      <LabeledSkillField label="Required evidence">
        <textarea
          value={evidence}
          onChange={(event) => setEvidence(event.target.value)}
          rows={3}
          placeholder="One evidence item per line"
          className="w-full px-2.5 py-1.5 text-ui-body border border-line-strong rounded-md bg-canvas focus:ring-2 focus:ring-accent outline-none resize-none"
        />
      </LabeledSkillField>
      <div className="flex gap-2">
        <button
          onClick={() => onSave(toDraft())}
          disabled={!name.trim() || !origin.trim() || !triggerPhrase.trim()}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md bg-accent py-1.5 text-ui-body font-medium text-accent-fg hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check size={14} />
          Save
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border border-line-strong px-3 py-1.5 text-ui-body text-fg-secondary hover:bg-surface-subtle"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function LabeledSkillField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1 text-ui-control font-semibold text-fg-tertiary">
      <span>{label}</span>
      {children}
    </label>
  );
}
