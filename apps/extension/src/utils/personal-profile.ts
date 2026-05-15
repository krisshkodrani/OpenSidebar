import type { UserSettings } from "../types";

export const PERSONAL_PROFILE_STORAGE_KEY = "opensidebar:personalProfile";

export const PERSONALIZATION_VERSION = 2;
export const PROFILE_DIGEST_SCHEMA_VERSION = 1;
export const PROFILE_ANALYZER_VERSION = "profile-notes-digest-v1";
export const PROFILE_NOTES_MAX_CHARS = 20_000;
export const PROFILE_DIGEST_MAX_ITEMS = 60;
export const PROFILE_DIGEST_RUNTIME_MAX_ITEMS = 12;
export const PROFILE_DIGEST_LABEL_MAX_CHARS = 80;
export const PROFILE_DIGEST_VALUE_MAX_CHARS = 500;
export const PROFILE_DIGEST_SOURCE_QUOTE_MAX_CHARS = 240;
export const FIREWORKS_PROFILE_ANALYZER_MODEL =
  "accounts/fireworks/routers/kimi-k2p6-turbo";

export type PersonalProfileStorageKeys =
  | string
  | string[]
  | Record<string, unknown>
  | null
  | undefined;

export interface PersonalProfileStorageArea {
  get(keys?: PersonalProfileStorageKeys): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface PersonalProfileStorage {
  local: PersonalProfileStorageArea;
}

export type DigestKind =
  | "fact"
  | "preference"
  | "constraint"
  | "theme"
  | "sensitive"
  | "open_question";

export type DigestConfidence = "high" | "medium" | "low";

export interface DigestItem {
  id: string;
  label: string;
  value: string;
  kind: DigestKind;
  confidence: DigestConfidence;
  sourceQuote?: string;
}

export interface ProfileDigest {
  schemaVersion: 1;
  notesHash: string;
  analyzerVersion: string;
  items: DigestItem[];
}

export interface AnalyzerMetadata {
  provider: string;
  model: string;
  analyzerVersion: string;
  analyzedAt: number;
}

export interface PersonalizationState {
  version: 2;
  enabled: boolean;
  notesMarkdown: string;
  notesHash: string;
  digest: ProfileDigest | null;
  updatedAt: number;
  analyzer: AnalyzerMetadata | null;
}

export interface ProfileResolveResult {
  values: Record<string, unknown>;
  missing: string[];
  disabled?: boolean;
}

export interface ProfileAnalysisResult {
  digest: ProfileDigest;
  analyzer: AnalyzerMetadata;
}

export type ProfileDigestItemPatch = Pick<
  DigestItem,
  "label" | "value" | "kind"
>;

export const DEFAULT_PROFILE_NOTES_MARKDOWN = [
  "# About me",
  "",
  "# Contact and links",
  "",
  "# Work preferences",
  "",
  "# Availability",
  "",
  "# Authorization and relocation",
  "",
  "# Writing style",
  "",
  "# Things to avoid",
  "",
  "# Sensitive / do not use",
  "",
].join("\n");

const DIGEST_REVIEW_START_MARKER =
  "<!-- opensidebar:digest-review:start -->";
const DIGEST_REVIEW_END_MARKER = "<!-- opensidebar:digest-review:end -->";
const DIGEST_REVIEW_INTRO =
  "Corrections in this block are user-reviewed and take priority over earlier notes.";

export const EMPTY_PERSONALIZATION_STATE: PersonalizationState = {
  version: 2,
  enabled: false,
  notesMarkdown: "",
  notesHash: hashProfileNotes(""),
  digest: null,
  updatedAt: 0,
  analyzer: null,
};

const PROFILE_TASK_PATTERN =
  /\b(apply|application|job|role|position|career|cover letter|resume|cv|form|profile|preferences?|availability|authorization|relocation|sponsorship|about me|personal)\b/i;

const DIGEST_KIND_LABELS: Record<DigestKind, string> = {
  fact: "Fact",
  preference: "Preference",
  constraint: "Constraint",
  theme: "Theme",
  sensitive: "Sensitive",
  open_question: "Open question",
};

const DIGEST_KIND_PRIORITY: Record<DigestKind, number> = {
  fact: 0,
  constraint: 1,
  preference: 2,
  theme: 3,
  open_question: 4,
  sensitive: 5,
};

const CONFIDENCE_PRIORITY: Record<DigestConfidence, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function defaultStorage(): PersonalProfileStorage {
  return chrome.storage as unknown as PersonalProfileStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max).trimEnd() : value;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function slug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "item";
}

export function hashProfileNotes(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function shortHash(text: string): string {
  return hashProfileNotes(text).slice(0, 8);
}

function generateDigestItemId(item: Omit<DigestItem, "id">): string {
  return `${item.kind}:${slug(item.label)}:${shortHash(
    `${normalizeWhitespace(item.value)}|${normalizeWhitespace(
      item.sourceQuote ?? "",
    )}`,
  )}`;
}

function isDigestKind(value: unknown): value is DigestKind {
  return (
    value === "fact" ||
    value === "preference" ||
    value === "constraint" ||
    value === "theme" ||
    value === "sensitive" ||
    value === "open_question"
  );
}

function isDigestConfidence(value: unknown): value is DigestConfidence {
  return value === "high" || value === "medium" || value === "low";
}

function normalizeDigestItem(input: unknown): DigestItem | null {
  if (!isRecord(input)) return null;
  if (!isDigestKind(input.kind)) return null;
  const label = truncate(normalizeWhitespace(stringValue(input.label)), PROFILE_DIGEST_LABEL_MAX_CHARS);
  const value = truncate(normalizeWhitespace(stringValue(input.value)), PROFILE_DIGEST_VALUE_MAX_CHARS);
  if (!label || !value) return null;

  const sourceQuote = truncate(
    normalizeWhitespace(stringValue(input.sourceQuote)),
    PROFILE_DIGEST_SOURCE_QUOTE_MAX_CHARS,
  );
  const itemWithoutId: Omit<DigestItem, "id"> = {
    label,
    value,
    kind: input.kind,
    confidence: isDigestConfidence(input.confidence)
      ? input.confidence
      : "low",
    ...(sourceQuote ? { sourceQuote } : {}),
  };
  return {
    ...itemWithoutId,
    id: generateDigestItemId(itemWithoutId),
  };
}

function sortDigestItems(items: DigestItem[]): DigestItem[] {
  return [...items].sort((left, right) => {
    const kindDiff =
      DIGEST_KIND_PRIORITY[left.kind] - DIGEST_KIND_PRIORITY[right.kind];
    if (kindDiff !== 0) return kindDiff;
    const confidenceDiff =
      CONFIDENCE_PRIORITY[left.confidence] -
      CONFIDENCE_PRIORITY[right.confidence];
    if (confidenceDiff !== 0) return confidenceDiff;
    return left.label.localeCompare(right.label);
  });
}

export function normalizeDigestItems(items: unknown): DigestItem[] {
  if (!Array.isArray(items)) return [];
  const byKey = new Map<string, DigestItem>();
  for (const raw of items) {
    const item = normalizeDigestItem(raw);
    if (!item) continue;
    const key = `${item.kind}\0${item.label.toLowerCase()}\0${item.value.toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return sortDigestItems(Array.from(byKey.values())).slice(
    0,
    PROFILE_DIGEST_MAX_ITEMS,
  );
}

function normalizeDigest(input: unknown, notesHash: string): ProfileDigest | null {
  if (!isRecord(input)) return null;
  const schemaVersion =
    input.schemaVersion === PROFILE_DIGEST_SCHEMA_VERSION
      ? PROFILE_DIGEST_SCHEMA_VERSION
      : null;
  if (!schemaVersion) return null;
  const digestNotesHash = stringValue(input.notesHash);
  const analyzerVersion = stringValue(input.analyzerVersion);
  const items = normalizeDigestItems(input.items);
  return {
    schemaVersion,
    notesHash: digestNotesHash || notesHash,
    analyzerVersion: analyzerVersion || PROFILE_ANALYZER_VERSION,
    items,
  };
}

function formatDigestItemReference(item: DigestItem): string {
  return `[${item.kind}] ${item.label} = ${item.value}`;
}

function formatDigestReviewCorrection(params: {
  action: "replace" | "delete";
  original: DigestItem;
  replacement?: DigestItem;
}): string {
  if (params.action === "delete") {
    return `- Do not include or use digest item: ${formatDigestItemReference(
      params.original,
    )}.`;
  }
  return `- Replace digest item: ${formatDigestItemReference(
    params.original,
  )} -> ${formatDigestItemReference(params.replacement ?? params.original)}.`;
}

function appendDigestReviewCorrection(
  notesMarkdown: string,
  correctionLine: string,
): string {
  const startIndex = notesMarkdown.indexOf(DIGEST_REVIEW_START_MARKER);
  const endIndex = notesMarkdown.indexOf(DIGEST_REVIEW_END_MARKER);
  if (startIndex >= 0 && endIndex > startIndex) {
    const beforeEnd = notesMarkdown.slice(0, endIndex).trimEnd();
    const afterEnd = notesMarkdown.slice(endIndex);
    return `${beforeEnd}\n${correctionLine}\n${afterEnd}`;
  }

  const prefix = notesMarkdown.trimEnd();
  const block = [
    "# Digest review corrections",
    DIGEST_REVIEW_START_MARKER,
    DIGEST_REVIEW_INTRO,
    correctionLine,
    DIGEST_REVIEW_END_MARKER,
  ].join("\n");
  return prefix ? `${prefix}\n\n${block}\n` : `${block}\n`;
}

function assertProfileNotesLength(notesMarkdown: string): void {
  if (notesMarkdown.length > PROFILE_NOTES_MAX_CHARS) {
    throw new Error(
      `Profile Notes must be ${PROFILE_NOTES_MAX_CHARS.toLocaleString()} characters or fewer.`,
    );
  }
}

function normalizeDigestItemPatch(patch: ProfileDigestItemPatch): DigestItem {
  const item = normalizeDigestItem({
    label: patch.label,
    value: patch.value,
    kind: patch.kind,
    confidence: "high",
  });
  if (!item) {
    throw new Error("Digest item label and value are required.");
  }
  return item;
}

function normalizeAnalyzerMetadata(input: unknown): AnalyzerMetadata | null {
  if (!isRecord(input)) return null;
  const provider = stringValue(input.provider).trim();
  const model = stringValue(input.model).trim();
  const analyzerVersion = stringValue(input.analyzerVersion).trim();
  const analyzedAt = numberValue(input.analyzedAt);
  if (!provider || !model || !analyzerVersion || !analyzedAt) return null;
  return { provider, model, analyzerVersion, analyzedAt };
}

function renderImportedLine(
  lines: string[],
  label: string,
  value: unknown,
): void {
  if (typeof value === "string" && value.trim()) {
    lines.push(`${label}: ${value.trim()}`);
    return;
  }
  if (Array.isArray(value)) {
    const values = value
      .filter((item): item is string => typeof item === "string" && !!item.trim())
      .map((item) => item.trim());
    if (values.length > 0) lines.push(`${label}: ${values.join(", ")}`);
  }
}

function readPath(source: Record<string, unknown>, path: string): unknown {
  let current: unknown = source;
  for (const segment of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function migrateLegacyProfileToNotes(source: Record<string, unknown>): string {
  const profile = isRecord(source.profile) ? source.profile : {};
  const lines: string[] = [];
  const imported: string[] = [];
  const application: string[] = [];
  const sensitive: string[] = [];

  const firstName = stringValue(readPath(profile, "identity.first_name")).trim();
  const lastName = stringValue(readPath(profile, "identity.last_name")).trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  renderImportedLine(imported, "Name", fullName);
  renderImportedLine(imported, "Preferred name", readPath(profile, "identity.preferred_name"));
  renderImportedLine(imported, "Pronouns", readPath(profile, "identity.pronouns"));
  renderImportedLine(imported, "Email", readPath(profile, "contact.email"));
  renderImportedLine(imported, "Phone", readPath(profile, "contact.phone"));
  renderImportedLine(imported, "Location", readPath(profile, "contact.location"));
  renderImportedLine(imported, "Address line 1", readPath(profile, "contact.address.line1"));
  renderImportedLine(imported, "Address line 2", readPath(profile, "contact.address.line2"));
  renderImportedLine(imported, "City", readPath(profile, "contact.address.city"));
  renderImportedLine(imported, "State", readPath(profile, "contact.address.state"));
  renderImportedLine(imported, "Postal code", readPath(profile, "contact.address.postal_code"));
  renderImportedLine(imported, "Country", readPath(profile, "contact.address.country"));
  renderImportedLine(imported, "LinkedIn", readPath(profile, "links.linkedin"));
  renderImportedLine(imported, "Portfolio", readPath(profile, "links.portfolio"));
  renderImportedLine(imported, "GitHub", readPath(profile, "links.github"));
  renderImportedLine(imported, "Website", readPath(profile, "links.website"));

  renderImportedLine(application, "Roles", readPath(profile, "preferences.roles"));
  renderImportedLine(application, "Locations", readPath(profile, "preferences.locations"));
  renderImportedLine(application, "Work modes", readPath(profile, "preferences.work_modes"));
  renderImportedLine(application, "Salary expectation", readPath(profile, "preferences.salary_expectation"));
  renderImportedLine(application, "Available from", readPath(profile, "preferences.available_from"));
  renderImportedLine(application, "Work authorization", readPath(profile, "authorization.work_authorized"));
  renderImportedLine(application, "Sponsorship", readPath(profile, "authorization.sponsorship_required"));
  renderImportedLine(application, "Relocation", readPath(profile, "authorization.relocation"));
  renderImportedLine(application, "Availability", readPath(profile, "answers.availability"));
  renderImportedLine(application, "Why interested", readPath(profile, "answers.why_interested"));
  renderImportedLine(application, "Cover note", readPath(profile, "answers.cover_note"));

  renderImportedLine(sensitive, "Gender", readPath(profile, "sensitive.eeo.gender"));
  renderImportedLine(sensitive, "Race / ethnicity", readPath(profile, "sensitive.eeo.race_ethnicity"));
  renderImportedLine(sensitive, "Veteran status", readPath(profile, "sensitive.eeo.veteran_status"));
  renderImportedLine(sensitive, "Disability status", readPath(profile, "sensitive.eeo.disability_status"));

  if (imported.length > 0) {
    lines.push("# Imported from old profile", "", ...imported, "");
  }
  if (application.length > 0) {
    lines.push("# Imported application notes", "", ...application, "");
  }
  if (sensitive.length > 0) {
    lines.push("# Sensitive / do not use", "", ...sensitive, "");
  }
  return lines.join("\n").trim();
}

function normalizeState(input: unknown): PersonalizationState {
  if (!isRecord(input)) {
    return { ...EMPTY_PERSONALIZATION_STATE };
  }

  if (input.version !== 2) {
    const notesMarkdown = truncate(
      migrateLegacyProfileToNotes(input),
      PROFILE_NOTES_MAX_CHARS,
    );
    return {
      version: 2,
      enabled: input.enabled === true,
      notesMarkdown,
      notesHash: hashProfileNotes(notesMarkdown),
      digest: null,
      updatedAt: numberValue(input.updatedAt),
      analyzer: null,
    };
  }

  const notesMarkdown = truncate(
    stringValue(input.notesMarkdown),
    PROFILE_NOTES_MAX_CHARS,
  );
  const notesHash = hashProfileNotes(notesMarkdown);
  return {
    version: 2,
    enabled: input.enabled === true,
    notesMarkdown,
    notesHash,
    digest: normalizeDigest(input.digest, notesHash),
    updatedAt: numberValue(input.updatedAt),
    analyzer: normalizeAnalyzerMetadata(input.analyzer),
  };
}

export async function loadPersonalizationState(
  storage: PersonalProfileStorage = defaultStorage(),
): Promise<PersonalizationState> {
  const stored = await storage.local.get(PERSONAL_PROFILE_STORAGE_KEY);
  return normalizeState(stored[PERSONAL_PROFILE_STORAGE_KEY]);
}

export async function savePersonalizationState(
  state: Partial<
    Pick<
      PersonalizationState,
      "enabled" | "notesMarkdown" | "digest" | "analyzer"
    >
  >,
  storage: PersonalProfileStorage = defaultStorage(),
): Promise<PersonalizationState> {
  const current = await loadPersonalizationState(storage).catch(
    () => EMPTY_PERSONALIZATION_STATE,
  );
  const notesMarkdown =
    state.notesMarkdown != null
      ? truncate(state.notesMarkdown, PROFILE_NOTES_MAX_CHARS)
      : current.notesMarkdown;
  const notesHash = hashProfileNotes(notesMarkdown);
  const next: PersonalizationState = {
    version: 2,
    enabled: state.enabled ?? current.enabled,
    notesMarkdown,
    notesHash,
    digest:
      state.digest !== undefined
        ? normalizeDigest(state.digest, notesHash)
        : current.digest,
    updatedAt: Date.now(),
    analyzer:
      state.analyzer !== undefined
        ? normalizeAnalyzerMetadata(state.analyzer)
        : current.analyzer,
  };
  await storage.local.set({ [PERSONAL_PROFILE_STORAGE_KEY]: next });
  return next;
}

export async function saveProfileAnalysisResult(
  result: ProfileAnalysisResult,
  storage: PersonalProfileStorage = defaultStorage(),
): Promise<PersonalizationState | null> {
  const current = await loadPersonalizationState(storage);
  if (current.notesHash !== result.digest.notesHash) {
    return null;
  }
  return savePersonalizationState(
    {
      digest: result.digest,
      analyzer: result.analyzer,
    },
    storage,
  );
}

export async function updateProfileDigestItem(
  itemId: string,
  patch: ProfileDigestItemPatch,
  storage: PersonalProfileStorage = defaultStorage(),
): Promise<PersonalizationState> {
  const current = await loadPersonalizationState(storage);
  if (!current.digest) {
    throw new Error("Profile digest is not ready.");
  }
  const itemIndex = current.digest.items.findIndex((item) => item.id === itemId);
  if (itemIndex < 0) {
    throw new Error("Digest item not found.");
  }

  const original = current.digest.items[itemIndex];
  const replacement = normalizeDigestItemPatch(patch);
  const nextNotesMarkdown = appendDigestReviewCorrection(
    current.notesMarkdown,
    formatDigestReviewCorrection({
      action: "replace",
      original,
      replacement,
    }),
  );
  assertProfileNotesLength(nextNotesMarkdown);
  const nextNotesHash = hashProfileNotes(nextNotesMarkdown);
  const nextDigest: ProfileDigest = {
    ...current.digest,
    notesHash: nextNotesHash,
    items: normalizeDigestItems([
      ...current.digest.items.slice(0, itemIndex),
      replacement,
      ...current.digest.items.slice(itemIndex + 1),
    ]),
  };

  return savePersonalizationState(
    {
      notesMarkdown: nextNotesMarkdown,
      digest: nextDigest,
    },
    storage,
  );
}

export async function deleteProfileDigestItem(
  itemId: string,
  storage: PersonalProfileStorage = defaultStorage(),
): Promise<PersonalizationState> {
  const current = await loadPersonalizationState(storage);
  if (!current.digest) {
    throw new Error("Profile digest is not ready.");
  }
  const item = current.digest.items.find((candidate) => candidate.id === itemId);
  if (!item) {
    throw new Error("Digest item not found.");
  }

  const nextNotesMarkdown = appendDigestReviewCorrection(
    current.notesMarkdown,
    formatDigestReviewCorrection({ action: "delete", original: item }),
  );
  assertProfileNotesLength(nextNotesMarkdown);
  const nextNotesHash = hashProfileNotes(nextNotesMarkdown);
  const nextDigest: ProfileDigest = {
    ...current.digest,
    notesHash: nextNotesHash,
    items: normalizeDigestItems(
      current.digest.items.filter((candidate) => candidate.id !== itemId),
    ),
  };

  return savePersonalizationState(
    {
      notesMarkdown: nextNotesMarkdown,
      digest: nextDigest,
    },
    storage,
  );
}

export async function clearProfileDigest(
  storage: PersonalProfileStorage = defaultStorage(),
): Promise<PersonalizationState> {
  return savePersonalizationState({ digest: null, analyzer: null }, storage);
}

export async function deletePersonalProfile(
  storage: PersonalProfileStorage = defaultStorage(),
): Promise<PersonalizationState> {
  await storage.local.remove(PERSONAL_PROFILE_STORAGE_KEY);
  return { ...EMPTY_PERSONALIZATION_STATE };
}

export function hasUsablePersonalProfile(state: PersonalizationState): boolean {
  return state.notesMarkdown.trim().length > 0;
}

export function isProfileDigestStale(state: PersonalizationState): boolean {
  if (!state.digest) return true;
  return (
    state.digest.notesHash !== state.notesHash ||
    state.digest.analyzerVersion !== PROFILE_ANALYZER_VERSION ||
    state.digest.schemaVersion !== PROFILE_DIGEST_SCHEMA_VERSION
  );
}

export function hasReadyProfileDigest(state: PersonalizationState): boolean {
  return (
    state.enabled &&
    !!state.digest &&
    !isProfileDigestStale(state) &&
    state.digest.items.length > 0
  );
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3),
  );
}

function profileFieldTokens(field: string): Set<string> {
  const normalized = field
    .replace(/^profile\./, "")
    .replace(/[._-]+/g, " ");
  const aliases: Record<string, string> = {
    email: "email contact email address",
    phone: "phone telephone mobile",
    location: "location city current location",
    name: "name full name first last",
    full_name: "name full name first last",
    first_name: "first name",
    last_name: "last name",
    linkedin: "linkedin linked in",
    github: "github",
    portfolio: "portfolio website",
    website: "website portfolio",
  };
  return tokenize(`${normalized} ${aliases[normalized] ?? ""}`);
}

function scoreFieldMatch(item: DigestItem, field: string): number {
  if (item.kind !== "fact") return 0;
  const fieldSlug = slug(field.replace(/^profile\./, "").split(".").pop() ?? field);
  const labelSlug = slug(item.label);
  if (fieldSlug && fieldSlug === labelSlug) return 20;

  const requested = profileFieldTokens(field);
  const haystack = tokenize(`${item.label} ${item.value}`);
  let score = 0;
  for (const token of requested) {
    if (haystack.has(token)) score += 3;
  }
  if (item.confidence === "high") score += 2;
  if (item.confidence === "medium") score += 1;
  return score;
}

export async function resolveProfileFields(
  fields: string[],
  storage: PersonalProfileStorage = defaultStorage(),
): Promise<ProfileResolveResult> {
  const state = await loadPersonalizationState(storage);
  const requested = fields
    .filter((field): field is string => typeof field === "string")
    .map((field) => field.trim())
    .filter(Boolean);

  if (!hasReadyProfileDigest(state)) {
    return { values: {}, missing: requested, disabled: true };
  }

  const factItems = state.digest?.items.filter((item) => item.kind === "fact") ?? [];
  const values: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const field of requested) {
    const best = factItems
      .map((item) => ({ item, score: scoreFieldMatch(item, field) }))
      .filter((candidate) => candidate.score >= 3)
      .sort((left, right) => right.score - left.score)[0];
    if (best) {
      values[field] = best.item.value;
    } else {
      missing.push(field);
    }
  }
  return { values, missing };
}

export interface RelevantDigestItem extends DigestItem {
  relevanceScore: number;
}

function scoreDigestItem(item: DigestItem, corpusTokens: Set<string>): number {
  if (item.kind === "sensitive") return Number.NEGATIVE_INFINITY;
  const itemTokens = tokenize(`${item.label} ${item.value} ${item.kind}`);
  let score = 0;
  for (const token of itemTokens) {
    if (corpusTokens.has(token)) score += token.length > 5 ? 2 : 1;
  }
  if (item.kind === "fact") score += 2;
  if (item.kind === "constraint") score += 2;
  if (item.confidence === "high") score += 2;
  if (item.confidence === "medium") score += 1;
  return score;
}

export function selectRelevantProfileDigestItems(
  query: string,
  state: PersonalizationState,
): RelevantDigestItem[] {
  if (!hasReadyProfileDigest(state) || !state.digest) return [];
  const corpusTokens = tokenize(query);
  const isProfileTask = PROFILE_TASK_PATTERN.test(query);
  return state.digest.items
    .map((item) => {
      let relevanceScore = scoreDigestItem(item, corpusTokens);
      if (
        isProfileTask &&
        (item.kind === "fact" ||
          item.kind === "preference" ||
          item.kind === "constraint" ||
          item.kind === "theme")
      ) {
        relevanceScore += 1;
      }
      if (item.kind === "open_question") {
        relevanceScore = relevanceScore > 0 ? relevanceScore : -1;
      }
      return { ...item, relevanceScore };
    })
    .filter((item) => item.relevanceScore > 0)
    .sort((left, right) => {
      if (right.relevanceScore !== left.relevanceScore) {
        return right.relevanceScore - left.relevanceScore;
      }
      return (
        DIGEST_KIND_PRIORITY[left.kind] - DIGEST_KIND_PRIORITY[right.kind]
      );
    })
    .slice(0, PROFILE_DIGEST_RUNTIME_MAX_ITEMS);
}

function renderDigestItemForPrompt(item: DigestItem): string {
  return `- ${DIGEST_KIND_LABELS[item.kind]}: ${item.label} = ${item.value}`;
}

export function buildPersonalProfilePlannerContext(
  query: string,
  state: PersonalizationState,
): string {
  const selected = selectRelevantProfileDigestItems(query, state);
  if (selected.length === 0) return "";

  const contextLines = selected.map(renderDigestItemForPrompt);
  return [
    "PROFILE DIGEST CONTEXT:",
    ...contextLines,
    "",
    "PROFILE POLICY:",
    "- Use facts only for exact matching fields.",
    "- Use preferences only to choose among clear options.",
    "- Treat constraints as hard boundaries.",
    "- Use themes only for drafting, not exact fields.",
    "- Do not infer open questions.",
    "- Do not use sensitive profile items unless the user explicitly asks for them.",
    "- Report unresolved fields at the end instead of guessing.",
  ].join("\n");
}

function renderValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function formatProfileFieldsForToolResult(
  result: ProfileResolveResult,
): string {
  if (result.disabled) {
    return "Profile notes are off, missing, stale, or not analyzed. Ask the user to add Profile Notes and run Analyze Notes before using saved profile data.";
  }

  const lines = ["PROFILE DIGEST FACTS:"];
  for (const [field, value] of Object.entries(result.values)) {
    lines.push(`- ${field}: ${renderValue(value)}`);
  }
  if (Object.keys(result.values).length === 0) {
    lines.push("- No requested profile facts were found.");
  }
  if (result.missing.length > 0) {
    lines.push("", `Missing: ${result.missing.join(", ")}`);
  }
  return lines.join("\n");
}

export function buildProfileAnalyzerSystemPrompt(): string {
  return [
    "You analyze user-owned profile notes for a browser automation assistant.",
    "",
    "Return strict JSON only. Do not wrap it in markdown. Do not include prose.",
    "",
    "Your job is to extract a conservative profile digest from the notes. The digest helps an automation agent decide what it can safely use in forms or drafts.",
    "",
    "Rules:",
    "- Extract only information directly supported by the notes.",
    "- Do not invent missing values.",
    "- Preserve uncertainty.",
    "- Prefer omission over overconfident extraction.",
    "- Keep labels short.",
    "- Keep values short and practical.",
    "- Include sourceQuote when it helps audit the extraction.",
    "- Use fact only for exact reusable values, such as name, email, location, a direct authorization statement, a specific date, or a specific URL.",
    "- Use preference for soft choices, such as preferred work mode, role types, locations, writing style, or communication preferences.",
    '- Use constraint for hard boundaries, such as "do not relocate", "do not use salary numbers", or "must not submit without review".',
    "- Use theme for reusable drafting material, motivations, positioning, or narrative points.",
    "- Use sensitive for private, regulated, or risky information that should not be used by default.",
    "- Use open_question for missing or ambiguous information that would be useful to ask the user.",
    "- Do not classify vague goals or themes as facts.",
    "- Do not turn themes into exact application answers.",
    `- If the notes include a ${DIGEST_REVIEW_START_MARKER} block, treat that block as user-reviewed corrections with priority over earlier conflicting notes.`,
    '- Honor "Do not include or use digest item" corrections by omitting that item from the digest unless a later correction explicitly replaces it.',
    '- Honor "Replace digest item" corrections by extracting the replacement item instead of the original item.',
    "",
    "Output schema:",
    '{"items":[{"label":"short label","value":"short extracted value","kind":"fact | preference | constraint | theme | sensitive | open_question","confidence":"high | medium | low","sourceQuote":"optional short quote from notes"}]}',
  ].join("\n");
}

export function buildProfileAnalyzerUserPrompt(notesMarkdown: string): string {
  return [
    "Analyze these profile notes and return the digest JSON.",
    "",
    "<profile_notes>",
    notesMarkdown,
    "</profile_notes>",
  ].join("\n");
}

async function readFireworksCompletionText(response: Response): Promise<string> {
  if (!response.body) {
    const parsed = (await response.json()) as any;
    return String(parsed?.choices?.[0]?.message?.content ?? "");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";

  let streamDone = false;
  while (!streamDone) {
    const { done, value } = await reader.read();
    if (done) {
      streamDone = true;
      continue;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice("data:".length).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed?.choices?.[0]?.delta?.content;
        const message = parsed?.choices?.[0]?.message?.content;
        if (typeof delta === "string") content += delta;
        else if (typeof message === "string") content += message;
      } catch {
        // Ignore malformed keepalive chunks.
      }
    }
  }

  return content;
}

export function parseProfileAnalyzerJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error("Analyzer returned non-JSON content.");
  }
  return JSON.parse(trimmed);
}

export function buildProfileDigestFromAnalyzerOutput(params: {
  output: unknown;
  notesHash: string;
}): ProfileDigest {
  if (!isRecord(params.output) || !Array.isArray(params.output.items)) {
    throw new Error("Analyzer output is missing items[].");
  }
  return {
    schemaVersion: PROFILE_DIGEST_SCHEMA_VERSION,
    notesHash: params.notesHash,
    analyzerVersion: PROFILE_ANALYZER_VERSION,
    items: normalizeDigestItems(params.output.items),
  };
}

export async function analyzePersonalProfileNotes(params: {
  notesMarkdown: string;
  settings: Pick<UserSettings, "fireworksApiKey">;
  fetchImpl?: typeof fetch;
}): Promise<ProfileAnalysisResult> {
  const notesMarkdown = params.notesMarkdown;
  if (!notesMarkdown.trim()) {
    throw new Error("Add Profile Notes before analyzing.");
  }
  if (notesMarkdown.length > PROFILE_NOTES_MAX_CHARS) {
    throw new Error(
      `Profile Notes must be ${PROFILE_NOTES_MAX_CHARS.toLocaleString()} characters or fewer.`,
    );
  }
  const apiKey = params.settings.fireworksApiKey?.trim();
  if (!apiKey) {
    throw new Error("Add a Fireworks API key in Settings before analyzing notes.");
  }

  const fetchImpl = params.fetchImpl ?? fetch;
  const notesHash = hashProfileNotes(notesMarkdown);
  const response = await fetchImpl(
    "https://api.fireworks.ai/inference/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: FIREWORKS_PROFILE_ANALYZER_MODEL,
        temperature: 0,
        stream: true,
        messages: [
          { role: "system", content: buildProfileAnalyzerSystemPrompt() },
          { role: "user", content: buildProfileAnalyzerUserPrompt(notesMarkdown) },
        ],
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Profile analysis failed with status ${response.status}.`);
  }

  const content = await readFireworksCompletionText(response);
  const output = parseProfileAnalyzerJson(content);
  return {
    digest: buildProfileDigestFromAnalyzerOutput({ output, notesHash }),
    analyzer: {
      provider: "fireworks",
      model: FIREWORKS_PROFILE_ANALYZER_MODEL,
      analyzerVersion: PROFILE_ANALYZER_VERSION,
      analyzedAt: Date.now(),
    },
  };
}
