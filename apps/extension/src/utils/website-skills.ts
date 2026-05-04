import type {
  SkillRecordingEvent,
  UserWebsiteSkill,
  UserWebsiteSkillDraft,
} from "../types";

export const WEBSITE_SKILLS_STORAGE_KEY = "opensidebar:userWebsiteSkills";
export const RECORD_SKILL_INTRO_DISMISSED_KEY =
  "opensidebar:recordSkillIntroDismissed";

const MAX_EVENTS_FOR_DRAFT = 18;

export interface WebsiteSkillsStorageArea {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function chromeWebsiteSkillsStorage(): WebsiteSkillsStorageArea {
  return {
    get(keys) {
      return chrome.storage.local.get(keys as any) as unknown as Promise<
        Record<string, unknown>
      >;
    },
    async set(items) {
      await chrome.storage.local.set(items);
    },
  };
}

export function classifyValueKind(
  value: string,
  inputType?: string | null,
): SkillRecordingEvent["valueKind"] {
  const trimmed = value.trim();
  const type = (inputType || "").toLowerCase();
  if (type === "email" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return "email";
  }
  if (type === "tel" || /^\+?[\d\s().-]{7,}$/.test(trimmed)) {
    return "phone";
  }
  if (type === "number" || /^-?\d+(?:[.,]\d+)?$/.test(trimmed)) {
    return "number";
  }
  if (type === "date" || /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return "date";
  }
  return "text";
}

export function isSensitiveInput(inputType?: string | null): boolean {
  const type = (inputType || "").toLowerCase();
  return type === "password" || type === "hidden";
}

export function formatRecordingTimelineEvent(
  event: Omit<SkillRecordingEvent, "timelineText">,
): string {
  const label = event.label || "unnamed control";
  if (event.kind === "click") return `Clicked "${label}"`;
  if (event.kind === "select") return `Selected "${label}"`;
  if (event.kind === "checkbox") {
    return `${event.checked ? "Checked" : "Unchecked"} "${label}"`;
  }
  if (event.kind === "input") {
    if (event.sensitive) return "Captured field intent, value redacted";
    const placeholder =
      event.valueKind && event.valueKind !== "redacted"
        ? `<${event.valueKind}>`
        : "<redacted>";
    return `Filled "${label}" with ${placeholder}`;
  }
  if (event.kind === "navigation") return `Moved to ${event.path || "a new page"}`;
  return `Saw ${label}`;
}

export function withTimelineText(
  event: Omit<SkillRecordingEvent, "timelineText">,
): SkillRecordingEvent {
  return {
    ...event,
    timelineText: formatRecordingTimelineEvent(event),
  };
}

export async function loadUserWebsiteSkills(
  storage: WebsiteSkillsStorageArea = chromeWebsiteSkillsStorage(),
): Promise<UserWebsiteSkill[]> {
  const result = await storage.get(WEBSITE_SKILLS_STORAGE_KEY);
  const raw = result[WEBSITE_SKILLS_STORAGE_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.filter(isUserWebsiteSkill);
}

export async function saveUserWebsiteSkill(
  draft: UserWebsiteSkillDraft,
  enabled = true,
  storage: WebsiteSkillsStorageArea = chromeWebsiteSkillsStorage(),
): Promise<UserWebsiteSkill> {
  const skills = await loadUserWebsiteSkills(storage);
  const now = Date.now();
  const skill: UserWebsiteSkill = {
    ...draft,
    enabled,
    updatedAt: now,
    createdAt: draft.createdAt || now,
  };
  const next = [skill, ...skills.filter((existing) => existing.id !== skill.id)];
  await storage.set({ [WEBSITE_SKILLS_STORAGE_KEY]: next });
  return skill;
}

export async function updateUserWebsiteSkill(
  id: string,
  updates: Partial<
    Pick<
      UserWebsiteSkill,
      | "name"
      | "origin"
      | "pathPattern"
      | "triggerPhrase"
      | "workflowSteps"
      | "requiredEvidence"
      | "privacySummary"
      | "enabled"
    >
  >,
  storage: WebsiteSkillsStorageArea = chromeWebsiteSkillsStorage(),
): Promise<UserWebsiteSkill[]> {
  const skills = await loadUserWebsiteSkills(storage);
  const now = Date.now();
  const next = skills.map((skill) =>
    skill.id === id
      ? {
          ...skill,
          ...updates,
          updatedAt: now,
        }
      : skill,
  );
  await storage.set({ [WEBSITE_SKILLS_STORAGE_KEY]: next });
  return next;
}

export async function deleteUserWebsiteSkill(
  id: string,
  storage: WebsiteSkillsStorageArea = chromeWebsiteSkillsStorage(),
): Promise<UserWebsiteSkill[]> {
  const next = (await loadUserWebsiteSkills(storage)).filter(
    (skill) => skill.id !== id,
  );
  await storage.set({ [WEBSITE_SKILLS_STORAGE_KEY]: next });
  return next;
}

export function generateWebsiteSkillDraft(
  events: SkillRecordingEvent[],
  fallbackUrl: string,
): UserWebsiteSkillDraft {
  const now = Date.now();
  const url = safeUrl(events[0]?.url || fallbackUrl);
  const origin = url?.origin || "";
  const pathPattern = buildPathPattern(events, url);
  const meaningful = events
    .filter((event) => event.kind !== "page")
    .slice(0, MAX_EVENTS_FOR_DRAFT);
  const actionLabels = meaningful
    .filter((event) => event.kind === "click")
    .map((event) => event.label)
    .filter(Boolean);
  const name = buildSkillName(actionLabels, url);
  const workflowSteps =
    meaningful.length > 0
      ? meaningful.map((event) => generalizeStep(event))
      : ["Ground on the current page and identify the target workflow controls."];

  return {
    id: crypto.randomUUID(),
    name,
    origin,
    pathPattern,
    triggerPhrase: name.toLowerCase(),
    workflowSteps: dedupePreserveOrder(workflowSteps),
    requiredEvidence: [
      "The final page state, confirmation message, saved record, or changed field is visible.",
      "Any submitted values are verified by field labels or summary text, not by raw captured input.",
    ],
    privacySummary:
      "Typed values were redacted by default. The saved skill keeps field intent, control labels, page scope, and verification expectations.",
    capturedEventCount: events.length,
    createdAt: now,
    updatedAt: now,
  };
}

export function findMatchingUserWebsiteSkill(
  skills: UserWebsiteSkill[],
  input: { url?: string | null; task?: string | null },
): UserWebsiteSkill | null {
  const url = safeUrl(input.url || "");
  if (!url) return null;
  const task = (input.task || "").toLowerCase();
  const candidates = skills.filter(
    (skill) =>
      skill.enabled &&
      skill.origin === url.origin &&
      pathMatchesPattern(url.pathname, skill.pathPattern),
  );
  if (candidates.length === 0) return null;
  return (
    candidates.find((skill) => {
      const trigger = skill.triggerPhrase.trim().toLowerCase();
      const name = skill.name.trim().toLowerCase();
      return (
        (trigger.length > 0 && task.includes(trigger)) ||
        (name.length > 0 && task.includes(name))
      );
    }) ?? candidates[0]
  );
}

export function formatUserWebsiteSkillGuidance(
  skill: UserWebsiteSkill,
): string {
  return [
    "Use this saved website skill if it fits the current page and request.",
    `Skill: ${skill.name}`,
    `Website scope: ${skill.origin}${skill.pathPattern}`,
    `Trigger phrase: ${skill.triggerPhrase}`,
    "Workflow steps:",
    ...skill.workflowSteps.map((step) => `- ${step}`),
    "Required verification evidence:",
    ...skill.requiredEvidence.map((item) => `- ${item}`),
    `Privacy: ${skill.privacySummary}`,
    "Treat this as generalized guidance. Do not replay captured values or assume old page state is still true.",
  ].join("\n");
}

function isUserWebsiteSkill(value: unknown): value is UserWebsiteSkill {
  const skill = value as UserWebsiteSkill;
  return (
    typeof skill?.id === "string" &&
    typeof skill.name === "string" &&
    typeof skill.origin === "string" &&
    typeof skill.pathPattern === "string" &&
    Array.isArray(skill.workflowSteps) &&
    Array.isArray(skill.requiredEvidence)
  );
}

function safeUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function buildPathPattern(
  events: SkillRecordingEvent[],
  fallbackUrl: URL | null,
): string {
  const paths = dedupePreserveOrder(
    events
      .map((event) => safeUrl(event.url)?.pathname)
      .filter((path): path is string => Boolean(path)),
  );
  if (paths.length === 0) return fallbackUrl?.pathname || "/";
  if (paths.length === 1) return paths[0] || "/";
  const prefix = commonPathPrefix(paths);
  return `${prefix.replace(/\/$/, "") || "/"}/*`;
}

function commonPathPrefix(paths: string[]): string {
  const segments = paths.map((path) => path.split("/").filter(Boolean));
  const first = segments[0] || [];
  const shared: string[] = [];
  for (let i = 0; i < first.length; i++) {
    if (segments.every((parts) => parts[i] === first[i])) {
      shared.push(first[i]);
    } else {
      break;
    }
  }
  return `/${shared.join("/")}`;
}

function pathMatchesPattern(pathname: string, pattern: string): boolean {
  if (!pattern || pattern === "/*") return true;
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1);
    return pathname.startsWith(prefix);
  }
  return pathname === pattern || pathname.startsWith(`${pattern.replace(/\/$/, "")}/`);
}

function buildSkillName(labels: string[], url: URL | null): string {
  const submitLabel = labels.find((label) =>
    /\b(create|save|submit|send|order|checkout|publish|confirm|apply)\b/i.test(
      label,
    ),
  );
  if (submitLabel) return titleCase(submitLabel);
  const host = url?.hostname.replace(/^www\./, "") || "Website";
  return `Workflow on ${host}`;
}

function generalizeStep(event: SkillRecordingEvent): string {
  const label = event.label || "the relevant control";
  if (event.kind === "click") return `Click "${label}" when it is visible.`;
  if (event.kind === "select") return `Choose the requested option for "${label}".`;
  if (event.kind === "checkbox") {
    return `Set "${label}" to the requested checked state.`;
  }
  if (event.kind === "input") {
    return `Fill "${label}" with the user-provided ${event.valueKind || "value"}.`;
  }
  if (event.kind === "navigation") return `Re-ground after navigation to ${event.path}.`;
  return `Verify the page shows ${label}.`;
}

function dedupePreserveOrder<T>(values: T[]): T[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function titleCase(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
