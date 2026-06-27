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
  ProfileValue,
} from "../types.js";

// Note: `resolveProfileFields` and `resolveSafeProfileContext` (the
// `/profile/resolve` and `/profile/context` handlers) were removed in RFC LP-8,
// M1 — they had no callers in the extension. Only file-alias resolution
// (`/profile/file`, e.g. the CV) remains in use.

const DEFAULT_PROFILE_PATH = join(
  homedir(),
  ".opensidebar",
  "profiles",
  "default.yaml",
);
const MAX_PROFILE_FILE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_FILE_ALIASES = new Set(["cv"]);
const PROFILE_FIELD_ALIASES = new Map<string, string>([
  ["description", "summary"],
  ["endDate", "end_date"],
  ["startDate", "start_date"],
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toSnakeCase(segment: string): string {
  return segment.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function toCamelCase(segment: string): string {
  return segment.replace(/_([a-z])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
}

function readObjectField(
  value: Record<string, unknown>,
  segment: string,
): unknown {
  if (segment in value) return value[segment];

  const alias = PROFILE_FIELD_ALIASES.get(segment);
  if (alias && alias in value) return value[alias];

  const snakeCase = toSnakeCase(segment);
  if (snakeCase !== segment && snakeCase in value) return value[snakeCase];

  const camelCase = toCamelCase(segment);
  if (camelCase !== segment && camelCase in value) return value[camelCase];

  return undefined;
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

function readProfileValue(
  profile: Record<string, unknown>,
  field: string,
): ProfileValue | undefined {
  const segments = field.split(".");
  let current: unknown = profile;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return undefined;
      current = current[Number(segment)];
      continue;
    }
    if (!isPlainObject(current)) {
      return undefined;
    }
    current = readObjectField(current, segment);
    if (current === undefined) return undefined;
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

  if (Array.isArray(current) && current.every((item) => isPlainObject(item))) {
    return current as ProfileValue;
  }

  if (isPlainObject(current)) {
    return current;
  }

  return undefined;
}

export function getProfileDirectory(profilePath = resolveProfilePath()): string {
  return dirname(profilePath);
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
