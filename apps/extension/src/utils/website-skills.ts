import type {
  SkillRecordingEvent,
  UserWebsiteSkill,
  UserWebsiteSkillDraft,
} from "../types";
import {
  liveValues,
  reconcile,
  type KnowledgeStore,
  type SyncMap,
} from "./knowledge-sync";
import { HttpKnowledgeStore } from "./openclaw-client";

export const WEBSITE_SKILLS_STORAGE_KEY = "opensidebar:userWebsiteSkills";
const WEBSITE_SKILLS_NAMESPACE = "website-skills";
const OPENCLAW_GATEWAY_URL_KEY = "opensidebar:openClawGatewayUrl";
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
    if (event.controlType === "radio") {
      return `${event.checked === false ? "Deselected" : "Selected"} "${label}"`;
    }
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
  return raw.filter(isUserWebsiteSkill).map(normalizeUserWebsiteSkill);
}

/** Resolve the OpenClaw knowledge store from the configured gateway URL, or null. */
async function resolveKnowledgeStore(): Promise<KnowledgeStore | null> {
  try {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const stored = await chrome.storage.local.get(OPENCLAW_GATEWAY_URL_KEY);
      const url = stored[OPENCLAW_GATEWAY_URL_KEY];
      if (typeof url === "string" && url.trim()) {
        return new HttpKnowledgeStore({ baseUrl: url.trim() });
      }
    }
  } catch {
    // No storage / gateway → local-only.
  }
  return null;
}

/**
 * Reconcile the local website-skills with OpenClaw's canonical store (RFC LP-8,
 * M3). Additive + default-off: with no gateway configured it returns the local
 * skills unchanged (no network), preserving standalone operation. When a gateway
 * is set, last-writer-wins merges local ↔ remote (the local array stays the
 * single local source of truth — no separate cache key).
 */
export async function syncUserWebsiteSkills(
  storage: WebsiteSkillsStorageArea = chromeWebsiteSkillsStorage(),
  store?: KnowledgeStore | null,
): Promise<UserWebsiteSkill[]> {
  const local = await loadUserWebsiteSkills(storage);
  const knowledgeStore =
    store !== undefined ? store : await resolveKnowledgeStore();
  if (!knowledgeStore) return local;

  const localMap: SyncMap = {};
  for (const skill of local) {
    localMap[skill.id] = { value: skill, updatedAt: skill.updatedAt ?? 0 };
  }

  const remoteMap = await knowledgeStore.getAll(WEBSITE_SKILLS_NAMESPACE);
  const { merged, push, pull } = reconcile(localMap, remoteMap);

  if (push.length > 0) {
    const toPush: SyncMap = {};
    for (const key of push) toPush[key] = merged[key];
    await knowledgeStore.putItems(WEBSITE_SKILLS_NAMESPACE, toPush);
  }

  if (pull.length === 0) return local;

  const mergedSkills = (Object.values(liveValues(merged)) as UserWebsiteSkill[])
    .filter(isUserWebsiteSkill)
    .map(normalizeUserWebsiteSkill);
  await storage.set({ [WEBSITE_SKILLS_STORAGE_KEY]: mergedSkills });
  return mergedSkills;
}

export async function saveUserWebsiteSkill(
  draft: UserWebsiteSkillDraft,
  enabled = true,
  storage: WebsiteSkillsStorageArea = chromeWebsiteSkillsStorage(),
): Promise<UserWebsiteSkill> {
  const skills = await loadUserWebsiteSkills(storage);
  const now = Date.now();
  const skill: UserWebsiteSkill = {
    ...normalizeUserWebsiteSkillDraft(draft),
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
      | "guardrails"
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
  const normalizedEvents = normalizeSkillRecordingEvents(events);
  const url = safeUrl(normalizedEvents[0]?.url || events[0]?.url || fallbackUrl);
  const origin = url?.origin || "";
  const pathPattern = buildPathPattern(normalizedEvents, url);
  const meaningful = normalizedEvents
    .filter((event) => event.kind !== "page")
    .slice(0, MAX_EVENTS_FOR_DRAFT);
  const actionLabels = meaningful
    .filter((event) => event.kind === "click")
    .map((event) => event.label)
    .filter(Boolean);
  const hasSubmitAction = actionLabels.some(isSubmitLikeLabel);
  const choiceEvents = meaningful.filter(isChoiceSelectionEvent);
  const choiceOnly =
    choiceEvents.length > 0 &&
    meaningful.every(
      (event) => event.kind === "checkbox" || event.kind === "navigation",
    );
  const quizLike = isQuizLikePath(pathPattern) || meaningful.some(isQuizLikeEvent);
  const name = choiceOnly
    ? quizLike
      ? "Choose answers on quiz page"
      : "Choose options on form"
    : buildSkillName(actionLabels, url);
  const workflowSteps =
    choiceOnly
      ? buildChoiceWorkflowSteps(quizLike)
      : meaningful.length > 0
      ? meaningful.map((event) => generalizeStep(event))
      : ["Ground on the current page and identify the target workflow controls."];
  const guardrails = buildGuardrails({
    hasSubmitAction,
    choiceOnly,
    quizLike,
  });
  const capturedInputCount = normalizedEvents.filter(
    (event) => event.kind === "input",
  ).length;

  return {
    id: crypto.randomUUID(),
    name,
    origin,
    pathPattern,
    triggerPhrase: choiceOnly
      ? quizLike
        ? "choose answers"
        : "choose options"
      : name.toLowerCase(),
    workflowSteps: dedupePreserveOrder(workflowSteps),
    guardrails,
    requiredEvidence: buildRequiredEvidence({ choiceOnly, quizLike }),
    privacySummary: buildPrivacySummary(capturedInputCount),
    capturedEventCount: events.length,
    capturedInputCount,
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeSkillRecordingEvents(
  events: SkillRecordingEvent[],
): SkillRecordingEvent[] {
  const normalized: SkillRecordingEvent[] = [];
  const replaceableIndexes = new Map<string, number>();

  for (const event of events) {
    const key = getReplaceableRecordingEventKey(event);
    if (!key) {
      normalized.push(event);
      continue;
    }

    const existingIndex = replaceableIndexes.get(key);
    if (existingIndex == null) {
      replaceableIndexes.set(key, normalized.length);
      normalized.push(event);
      continue;
    }

    normalized[existingIndex] = event;
  }

  return normalized;
}

export function formatSkillRecordingTimeline(
  events: SkillRecordingEvent[],
): string[] {
  return normalizeSkillRecordingEvents(events).map((event) => event.timelineText);
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
    ...((skill.guardrails ?? []).length
      ? [
          "Guardrails:",
          ...(skill.guardrails ?? []).map((item) => `- ${item}`),
        ]
      : []),
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

function normalizeUserWebsiteSkillDraft(
  draft: UserWebsiteSkillDraft,
): UserWebsiteSkillDraft {
  const capturedInputCount =
    typeof draft.capturedInputCount === "number" ? draft.capturedInputCount : 0;
  return {
    ...draft,
    guardrails: Array.isArray(draft.guardrails) ? draft.guardrails : [],
    capturedInputCount,
    privacySummary: draft.privacySummary || buildPrivacySummary(capturedInputCount),
  };
}

function normalizeUserWebsiteSkill(skill: UserWebsiteSkill): UserWebsiteSkill {
  return {
    ...normalizeUserWebsiteSkillDraft(skill),
    enabled: skill.enabled !== false,
  };
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
      .map((path) => (path ? generalizePathPattern(path) : path))
      .filter((path): path is string => Boolean(path)),
  );
  if (paths.length === 0) {
    return fallbackUrl ? generalizePathPattern(fallbackUrl.pathname) : "/";
  }
  if (paths.length === 1) return paths[0] || "/";
  const prefix = commonPathPrefix(paths);
  return `${prefix.replace(/\/$/, "") || "/"}/*`;
}

function generalizePathPattern(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  const courseIndex = segments.indexOf("course");
  const learnIndex = segments.indexOf("learn");
  const quizIndex = segments.indexOf("quiz");
  if (
    courseIndex >= 0 &&
    learnIndex === courseIndex + 2 &&
    quizIndex === learnIndex + 1
  ) {
    return "/course/*/learn/quiz/*";
  }

  const next = segments.map((segment) =>
    isVolatilePathSegment(segment) ? "*" : segment,
  );
  return `/${next.join("/")}` || "/";
}

function isVolatilePathSegment(segment: string): boolean {
  return (
    /^\d+$/.test(segment) ||
    /^[0-9a-f]{8,}$/i.test(segment) ||
    /^[0-9a-f]{8}-[0-9a-f-]{13,}$/i.test(segment)
  );
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
  if (pattern.includes("*")) return pathMatchesWildcardPattern(pathname, pattern);
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1);
    return pathname.startsWith(prefix);
  }
  return pathname === pattern || pathname.startsWith(`${pattern.replace(/\/$/, "")}/`);
}

function pathMatchesWildcardPattern(pathname: string, pattern: string): boolean {
  const pathSegments = pathname.split("/").filter(Boolean);
  const patternSegments = pattern.split("/").filter(Boolean);
  for (let index = 0; index < patternSegments.length; index++) {
    const segment = patternSegments[index];
    if (segment === "*" && index === patternSegments.length - 1) return true;
    if (segment === "*") continue;
    if (pathSegments[index] !== segment) return false;
  }
  return pathSegments.length === patternSegments.length;
}

function buildSkillName(labels: string[], url: URL | null): string {
  const submitLabel = labels.find(isSubmitLikeLabel);
  if (submitLabel) return titleCase(submitLabel);
  const host = url?.hostname.replace(/^www\./, "") || "Website";
  return `Workflow on ${host}`;
}

function buildChoiceWorkflowSteps(quizLike: boolean): string[] {
  if (quizLike) {
    return [
      "Find the answer options requested by the user.",
      "Select only the requested answer options.",
      "Verify each requested answer option is visibly selected.",
    ];
  }
  return [
    "Find the options requested by the user.",
    "Set only the requested options to the requested state.",
    "Verify each requested option state is visible.",
  ];
}

function buildGuardrails(input: {
  hasSubmitAction: boolean;
  choiceOnly: boolean;
  quizLike: boolean;
}): string[] {
  const guardrails = [
    "Do not infer missing values or choose a substitute when a requested target is not visible.",
    "Do not change unrelated fields or options unless the user asks.",
  ];
  if (!input.hasSubmitAction) {
    guardrails.unshift(
      input.quizLike || input.choiceOnly
        ? "Do not submit, finish, grade, or move to the next question unless the user explicitly asks."
        : "Do not submit, finish, or move to the next step unless the user explicitly asks.",
    );
  } else {
    guardrails.unshift(
      "Verify the requested state before using any submit, finish, or confirmation action.",
    );
  }
  return guardrails;
}

function buildRequiredEvidence(input: {
  choiceOnly: boolean;
  quizLike: boolean;
}): string[] {
  if (input.choiceOnly) {
    return [
      input.quizLike
        ? "Each requested answer option is visibly selected."
        : "Each requested option or checkbox state is visible.",
      "No submit, next, finish, or grade action was taken unless explicitly requested.",
    ];
  }
  return [
    "The final page state, confirmation message, saved record, or changed field is visible.",
    "Any submitted values are verified by field labels or summary text, not by raw captured input.",
  ];
}

function buildPrivacySummary(capturedInputCount: number): string {
  if (capturedInputCount > 0) {
    return "Typed values were redacted by default. The saved skill keeps field intent, control labels, page scope, guardrails, and verification expectations.";
  }
  return "No typed values were captured. The saved skill keeps control labels, page scope, guardrails, and verification expectations.";
}

function isSubmitLikeLabel(label: string): boolean {
  return /\b(create|save|submit|send|order|checkout|publish|confirm|apply|finish|grade|next)\b/i.test(
    label,
  );
}

function isChoiceSelectionEvent(event: SkillRecordingEvent): boolean {
  return event.kind === "checkbox" && event.checked !== false;
}

function isQuizLikePath(pathPattern: string): boolean {
  return /\b(quiz|exam|assessment|question)\b/i.test(pathPattern);
}

function isQuizLikeEvent(event: SkillRecordingEvent): boolean {
  return (
    isQuizLikePath(event.path) ||
    /\b(answer|option|question|quiz|exam)\b/i.test(event.label)
  );
}

function getReplaceableRecordingEventKey(
  event: SkillRecordingEvent,
): string | null {
  if (
    event.kind !== "input" &&
    event.kind !== "select" &&
    event.kind !== "checkbox"
  ) {
    return null;
  }
  return [
    event.kind,
    event.path,
    event.label.trim().toLowerCase(),
    event.tagName || "",
    event.inputType || "",
    event.controlType || "",
  ].join("|");
}

function generalizeStep(event: SkillRecordingEvent): string {
  const label = event.label || "the relevant control";
  if (event.kind === "click") return `Click "${label}" when it is visible.`;
  if (event.kind === "select") return `Choose the requested option for "${label}".`;
  if (event.kind === "checkbox") {
    if (event.controlType === "radio") {
      return `Select the requested option in the "${label}" choice group.`;
    }
    return `Set the checkbox labeled "${label}" to the requested state.`;
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
