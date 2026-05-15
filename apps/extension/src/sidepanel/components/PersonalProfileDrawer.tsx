import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Save, ShieldCheck, Trash2, UserRound, X } from "lucide-react";
import { useStore } from "../store";
import {
  EMPTY_PERSONAL_PROFILE,
  hasUsablePersonalProfile,
  type PersonalProfile,
} from "../../utils/personal-profile";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function cloneProfile(profile: PersonalProfile): PersonalProfile {
  return JSON.parse(JSON.stringify(profile)) as PersonalProfile;
}

function linesToArray(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function arrayToLines(value: string[]): string {
  return value.join("\n");
}

function updateAtPath<T extends object>(
  value: T,
  path: string,
  nextValue: string | string[],
): T {
  const next = cloneProfile(value as unknown as PersonalProfile) as unknown as T;
  const segments = path.split(".");
  let target = next as Record<string, unknown>;
  for (const segment of segments.slice(0, -1)) {
    target = target[segment] as Record<string, unknown>;
  }
  target[segments[segments.length - 1]] = nextValue;
  return next;
}

function TextField({
  label,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "email" | "tel" | "url";
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-warm-500 dark:text-warm-400">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-warm-200 bg-white px-2.5 py-1.5 text-sm text-warm-800 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-500/20 dark:border-warm-700 dark:bg-warm-950 dark:text-warm-100"
      />
    </label>
  );
}

function TextAreaField({
  label,
  onChange,
  placeholder,
  rows = 3,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-warm-500 dark:text-warm-400">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="mt-1 w-full resize-none rounded-md border border-warm-200 bg-white px-2.5 py-1.5 text-sm text-warm-800 outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-500/20 dark:border-warm-700 dark:bg-warm-950 dark:text-warm-100"
      />
    </label>
  );
}

function Section({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="space-y-3 border-t border-warm-200 pt-4 first:border-t-0 first:pt-0 dark:border-warm-800">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-warm-400">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function PersonalProfileDrawer({ isOpen, onClose }: Props) {
  const personalProfileState = useStore((s) => s.personalProfileState);
  const savePersonalProfile = useStore((s) => s.savePersonalProfile);
  const deletePersonalProfile = useStore((s) => s.deletePersonalProfile);
  const setPersonalProfileEnabled = useStore(
    (s) => s.setPersonalProfileEnabled,
  );
  const [draft, setDraft] = useState<PersonalProfile>(
    cloneProfile(EMPTY_PERSONAL_PROFILE),
  );
  const [enabled, setEnabled] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);

  const hasProfile = useMemo(
    () => hasUsablePersonalProfile({ ...personalProfileState, profile: draft }),
    [draft, personalProfileState],
  );

  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setDraft(cloneProfile(personalProfileState.profile));
    setEnabled(personalProfileState.enabled);
    setSaveStatus(null);
    setDeleteArmed(false);
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

  const setField = (path: string, value: string | string[]) => {
    setDraft((previous) => updateAtPath(previous, path, value));
    setSaveStatus(null);
    setDeleteArmed(false);
  };

  const handleSave = async () => {
    await savePersonalProfile(draft, enabled && hasProfile);
    setSaveStatus("Saved");
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
    setDraft(cloneProfile(EMPTY_PERSONAL_PROFILE));
    setEnabled(false);
    setSaveStatus("Deleted");
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
        className="relative flex h-full w-full max-w-[370px] flex-col border-l border-warm-200 bg-warm-50 shadow-2xl drawer-enter dark:border-warm-800 dark:bg-warm-900"
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
                  Save details the agent can use for forms.
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
                Use saved profile
              </p>
              <p className="text-[11px] text-warm-500 dark:text-warm-400">
                Persistent for this browser
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleEnabledChange(!enabled)}
              className={`relative h-6 w-11 rounded-full transition ${
                enabled
                  ? "bg-primary-600"
                  : "bg-warm-300 dark:bg-warm-700"
              }`}
              aria-pressed={enabled}
              aria-label="Use saved profile"
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
          {!hasProfile ? (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
              Add at least one field before turning profile use on.
            </div>
          ) : null}

          <div className="space-y-5">
            <Section title="Identity">
              <div className="grid grid-cols-2 gap-2">
                <TextField
                  label="First name"
                  value={draft.identity.first_name}
                  onChange={(value) => setField("identity.first_name", value)}
                  placeholder="John"
                />
                <TextField
                  label="Last name"
                  value={draft.identity.last_name}
                  onChange={(value) => setField("identity.last_name", value)}
                  placeholder="Doe"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <TextField
                  label="Preferred name"
                  value={draft.identity.preferred_name}
                  onChange={(value) =>
                    setField("identity.preferred_name", value)
                  }
                />
                <TextField
                  label="Pronouns"
                  value={draft.identity.pronouns}
                  onChange={(value) => setField("identity.pronouns", value)}
                />
              </div>
            </Section>

            <Section title="Contact">
              <TextField
                label="Email"
                type="email"
                value={draft.contact.email}
                onChange={(value) => setField("contact.email", value)}
                placeholder="john.doe@example.com"
              />
              <TextField
                label="Phone"
                type="tel"
                value={draft.contact.phone}
                onChange={(value) => setField("contact.phone", value)}
              />
              <TextField
                label="Location"
                value={draft.contact.location}
                onChange={(value) => setField("contact.location", value)}
                placeholder="New York, NY"
              />
              <div className="grid grid-cols-2 gap-2">
                <TextField
                  label="Address line 1"
                  value={draft.contact.address.line1}
                  onChange={(value) =>
                    setField("contact.address.line1", value)
                  }
                />
                <TextField
                  label="Address line 2"
                  value={draft.contact.address.line2}
                  onChange={(value) =>
                    setField("contact.address.line2", value)
                  }
                />
                <TextField
                  label="City"
                  value={draft.contact.address.city}
                  onChange={(value) => setField("contact.address.city", value)}
                />
                <TextField
                  label="State"
                  value={draft.contact.address.state}
                  onChange={(value) => setField("contact.address.state", value)}
                />
                <TextField
                  label="Postal code"
                  value={draft.contact.address.postal_code}
                  onChange={(value) =>
                    setField("contact.address.postal_code", value)
                  }
                />
                <TextField
                  label="Country"
                  value={draft.contact.address.country}
                  onChange={(value) =>
                    setField("contact.address.country", value)
                  }
                />
              </div>
            </Section>

            <Section title="Links">
              <TextField
                label="LinkedIn"
                type="url"
                value={draft.links.linkedin}
                onChange={(value) => setField("links.linkedin", value)}
              />
              <TextField
                label="Portfolio"
                type="url"
                value={draft.links.portfolio}
                onChange={(value) => setField("links.portfolio", value)}
              />
              <div className="grid grid-cols-2 gap-2">
                <TextField
                  label="GitHub"
                  type="url"
                  value={draft.links.github}
                  onChange={(value) => setField("links.github", value)}
                />
                <TextField
                  label="Website"
                  type="url"
                  value={draft.links.website}
                  onChange={(value) => setField("links.website", value)}
                />
              </div>
            </Section>

            <Section title="Work Preferences">
              <TextAreaField
                label="Roles"
                value={arrayToLines(draft.preferences.roles)}
                onChange={(value) =>
                  setField("preferences.roles", linesToArray(value))
                }
                placeholder={"Product Designer\nFrontend Engineer"}
              />
              <TextAreaField
                label="Locations"
                value={arrayToLines(draft.preferences.locations)}
                onChange={(value) =>
                  setField("preferences.locations", linesToArray(value))
                }
                rows={2}
              />
              <TextAreaField
                label="Work modes"
                value={arrayToLines(draft.preferences.work_modes)}
                onChange={(value) =>
                  setField("preferences.work_modes", linesToArray(value))
                }
                placeholder={"Remote\nHybrid"}
                rows={2}
              />
              <div className="grid grid-cols-2 gap-2">
                <TextField
                  label="Salary"
                  value={draft.preferences.salary_expectation}
                  onChange={(value) =>
                    setField("preferences.salary_expectation", value)
                  }
                />
                <TextField
                  label="Available from"
                  value={draft.preferences.available_from}
                  onChange={(value) =>
                    setField("preferences.available_from", value)
                  }
                />
              </div>
            </Section>

            <Section title="Authorization">
              <TextField
                label="Work authorization"
                value={draft.authorization.work_authorized}
                onChange={(value) =>
                  setField("authorization.work_authorized", value)
                }
              />
              <TextField
                label="Sponsorship"
                value={draft.authorization.sponsorship_required}
                onChange={(value) =>
                  setField("authorization.sponsorship_required", value)
                }
              />
              <TextField
                label="Relocation"
                value={draft.authorization.relocation}
                onChange={(value) =>
                  setField("authorization.relocation", value)
                }
              />
            </Section>

            <Section title="Standard Answers">
              <TextAreaField
                label="Availability"
                value={draft.answers.availability}
                onChange={(value) => setField("answers.availability", value)}
                rows={2}
              />
              <TextAreaField
                label="Why interested"
                value={draft.answers.why_interested}
                onChange={(value) => setField("answers.why_interested", value)}
              />
              <TextAreaField
                label="Cover note"
                value={draft.answers.cover_note}
                onChange={(value) => setField("answers.cover_note", value)}
              />
            </Section>

            <Section title="Optional EEO">
              <div className="rounded-lg border border-warm-200 bg-white p-3 dark:border-warm-800 dark:bg-warm-950">
                <div className="mb-3 flex items-start gap-2 text-xs text-warm-500 dark:text-warm-400">
                  <ShieldCheck size={14} className="mt-0.5 shrink-0" />
                  <span>These fields are stored under sensitive.eeo.</span>
                </div>
                <div className="space-y-2">
                  <TextField
                    label="Gender"
                    value={draft.sensitive.eeo.gender}
                    onChange={(value) =>
                      setField("sensitive.eeo.gender", value)
                    }
                  />
                  <TextField
                    label="Race / ethnicity"
                    value={draft.sensitive.eeo.race_ethnicity}
                    onChange={(value) =>
                      setField("sensitive.eeo.race_ethnicity", value)
                    }
                  />
                  <TextField
                    label="Veteran status"
                    value={draft.sensitive.eeo.veteran_status}
                    onChange={(value) =>
                      setField("sensitive.eeo.veteran_status", value)
                    }
                  />
                  <TextField
                    label="Disability status"
                    value={draft.sensitive.eeo.disability_status}
                    onChange={(value) =>
                      setField("sensitive.eeo.disability_status", value)
                    }
                  />
                </div>
              </div>
            </Section>
          </div>
        </div>

        <footer className="border-t border-warm-200 bg-warm-50 p-3 dark:border-warm-800 dark:bg-warm-900">
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleSave()}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700"
            >
              <Save size={15} />
              Save
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
          {saveStatus ? (
            <p className="mt-2 text-center text-xs text-warm-500 dark:text-warm-400">
              {saveStatus}
            </p>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
