import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  PersonalProfileDocument,
  ProfileResolveResult,
  ProfileValue,
} from "../types.js";

const DEFAULT_PROFILE_PATH = join(
  homedir(),
  ".opensidebar",
  "profiles",
  "default.yaml",
);

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
