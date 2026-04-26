import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  PersonalProfileDocument,
  ProfileFileResolveResult,
  ProfileResolveResult,
  ProfileSafeContextEntry,
  ProfileSafeContextResult,
  ProfileValue,
} from "../types.js";

const DEFAULT_PROFILE_PATH = join(
  homedir(),
  ".opensidebar",
  "profiles",
  "default.yaml",
);
const MAX_PROFILE_FILE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_FILE_ALIASES = new Set(["cv"]);
const JOB_CONTEXT_KEYWORDS = new Set([
  "authorization",
  "career",
  "job",
  "location",
  "professional",
  "remote",
  "role",
  "salary",
  "summary",
  "work",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProfilePathSegment(segment: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(segment);
}

export function resolveProfilePath(explicitPath?: string): string {
  const configured =
    explicitPath || process.env.OPENSIDEBAR_PROFILE_PATH || DEFAULT_PROFILE_PATH;
  return resolve(configured);
}

export function parseProfileDocument(raw: string): PersonalProfileDocument {
  const parsed = parseYaml(raw);
  if (!isPlainObject(parsed)) {
    throw new Error("Profile file must contain a top-level object.");
  }
  if (!isPlainObject(parsed.profile)) {
    throw new Error("Profile file must contain a top-level `profile` object.");
  }
  return { profile: parsed.profile };
}

export function loadProfile(profilePath = resolveProfilePath()): PersonalProfileDocument {
  if (!existsSync(profilePath)) {
    throw new Error(
      `Profile file not found at ${profilePath}. Create it or set OPENSIDEBAR_PROFILE_PATH.`,
    );
  }
  const raw = readFileSync(profilePath, "utf-8");
  return parseProfileDocument(raw);
}

export function isSensitiveProfileField(field: string): boolean {
  return field === "sensitive" || field.startsWith("sensitive.");
}

export function normalizeRequestedFields(fields: string[]): string[] {
  const normalized = new Set<string>();
  for (const rawField of fields) {
    if (typeof rawField !== "string") continue;
    const field = rawField.trim().replace(/^profile\./, "").replace(/\.+/g, ".");
    if (!field) continue;
    const segments = field.split(".");
    if (segments.some((segment) => !isProfilePathSegment(segment))) {
      throw new Error(`Invalid profile field path: ${rawField}`);
    }
    normalized.add(field);
  }
  return Array.from(normalized);
}

function readProfileValue(
  profile: Record<string, unknown>,
  field: string,
): ProfileValue | undefined {
  const segments = field.split(".");
  let current: unknown = profile;
  for (const segment of segments) {
    if (!isPlainObject(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }

  if (
    current === null ||
    typeof current === "string" ||
    typeof current === "number" ||
    typeof current === "boolean"
  ) {
    return current;
  }

  if (
    Array.isArray(current) &&
    current.every(
      (item) =>
        item === null ||
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean",
    )
  ) {
    return current as ProfileValue;
  }

  if (isPlainObject(current)) {
    return current;
  }

  return undefined;
}

export function resolveProfileFields(
  fields: string[],
  profilePath = resolveProfilePath(),
): ProfileResolveResult {
  const normalizedFields = normalizeRequestedFields(fields);
  if (normalizedFields.length === 0) {
    throw new Error("At least one profile field is required.");
  }

  const document = loadProfile(profilePath);
  const values: Record<string, ProfileValue> = {};
  const missing: string[] = [];
  const sensitiveFields: string[] = [];

  for (const field of normalizedFields) {
    const value = readProfileValue(document.profile, field);
    if (value === undefined) {
      missing.push(field);
      continue;
    }
    values[field] = value;
    if (isSensitiveProfileField(field)) {
      sensitiveFields.push(field);
    }
  }

  return {
    profilePath,
    values,
    missing,
    sensitiveFields,
  };
}

export function getProfileDirectory(profilePath = resolveProfilePath()): string {
  return dirname(profilePath);
}

function renderProfileValue(value: ProfileValue): string {
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function flattenProfileContext(
  value: unknown,
  prefix: string,
  entries: ProfileSafeContextEntry[],
): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    entries.push({ path: prefix, value });
    return;
  }

  if (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item === null ||
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean",
    )
  ) {
    entries.push({ path: prefix, value: value as ProfileValue });
    return;
  }

  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (!isProfilePathSegment(key)) continue;
    flattenProfileContext(child, prefix ? `${prefix}.${key}` : key, entries);
  }
}

function tokenizeForContext(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3),
  );
}

function isJobContextQuery(query: string): boolean {
  return /\b(job|jobs|role|roles|career|apply|application|cv|resume|hiring|salary|remote)\b/i.test(
    query,
  );
}

function rankSafeContextEntry(
  entry: ProfileSafeContextEntry,
  queryTokens: Set<string>,
  jobContext: boolean,
): number {
  const haystack = `${entry.path} ${renderProfileValue(entry.value)}`.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) score += 1;
  }
  if (jobContext) {
    const segments = entry.path.toLowerCase().split(".");
    if (segments.some((segment) => JOB_CONTEXT_KEYWORDS.has(segment))) score += 3;
    if (JOB_CONTEXT_KEYWORDS.has(segments[0])) score += 1;
  }
  return score;
}

export function resolveSafeProfileContext(
  query: string,
  profilePath = resolveProfilePath(),
): ProfileSafeContextResult {
  const document = loadProfile(profilePath);
  const safeRoot = readProfileValue(document.profile, "context.safe");
  if (!isPlainObject(safeRoot)) {
    return { profilePath, entries: [], rendered: "" };
  }

  const allEntries: ProfileSafeContextEntry[] = [];
  flattenProfileContext(safeRoot, "", allEntries);

  const queryTokens = tokenizeForContext(query);
  const jobContext = isJobContextQuery(query);
  const ranked = allEntries
    .map((entry, index) => ({
      entry,
      index,
      score: rankSafeContextEntry(entry, queryTokens, jobContext),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 8)
    .map((item) => item.entry);

  const lines = ranked.map((entry) => {
    const raw = renderProfileValue(entry.value);
    const value = raw.length > 400 ? `${raw.slice(0, 400).trimEnd()}...` : raw;
    return `- ${entry.path}: ${value}`;
  });

  return {
    profilePath,
    entries: ranked,
    rendered: lines.length > 0 ? `PERSONAL CONTEXT:\n${lines.join("\n")}` : "",
  };
}

function inferMimeType(filename: string): string {
  switch (extname(filename).toLowerCase()) {
    case ".pdf":
      return "application/pdf";
    case ".doc":
      return "application/msword";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

export function resolveProfileFile(
  alias: string,
  profilePath = resolveProfilePath(),
): ProfileFileResolveResult {
  const normalizedAlias = alias.trim().toLowerCase();
  if (!SUPPORTED_FILE_ALIASES.has(normalizedAlias)) {
    throw new Error(`Unsupported profile file alias: ${alias}`);
  }

  const document = loadProfile(profilePath);
  const fileConfig = readProfileValue(document.profile, `files.${normalizedAlias}`);
  if (!isPlainObject(fileConfig) || typeof fileConfig.path !== "string") {
    throw new Error(`Profile file alias not configured: ${normalizedAlias}`);
  }

  const rawPath = fileConfig.path.trim();
  if (!rawPath || isAbsolute(rawPath)) {
    throw new Error("Profile file paths must be relative to the profile directory.");
  }

  const profileDir = getProfileDirectory(profilePath);
  const filePath = resolve(profileDir, rawPath);
  const rel = relative(profileDir, filePath);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Profile file path must stay within the profile directory.");
  }

  if (!existsSync(filePath)) {
    throw new Error(`Profile file not found for alias ${normalizedAlias}: ${filePath}`);
  }

  const stats = statSync(filePath);
  if (!stats.isFile()) {
    throw new Error(`Profile file alias ${normalizedAlias} does not point to a file.`);
  }
  if (stats.size > MAX_PROFILE_FILE_BYTES) {
    throw new Error("Profile file exceeds 10MB limit.");
  }

  const filename = basename(filePath);
  const mimeType =
    typeof fileConfig.mime_type === "string" && fileConfig.mime_type.trim()
      ? fileConfig.mime_type.trim()
      : inferMimeType(filename);

  return {
    profilePath,
    alias: normalizedAlias,
    filename,
    mimeType,
    byteLength: stats.size,
    data: readFileSync(filePath).toString("base64"),
  };
}
