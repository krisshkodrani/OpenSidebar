/**
 * The application package (pi-backend Phase 5) — the schema-valid identity +
 * status record for one job application. Mirrors
 * `~/.opensidebar/seed/schemas/application-package.schema.json` (schemaVersion 1).
 * The status lifecycle is human-in-the-loop by design: an agent fills
 * (`filled-awaiting-submit`) and only a human moves it to `submitted-by-user`.
 * `recordStatus` enforces that ordering so a loop can never fast-forward past
 * the human gate.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ApplicationStatus =
  | "reviewing"
  | "ready"
  | "filled-awaiting-submit"
  | "submitted-by-user"
  | "applied"
  | "archived"
  | "duplicate-risk";

export interface ApplicationPackage {
  schemaVersion: 1;
  company: string;
  roleTitle: string;
  locationMode?: string;
  sourceUrl?: string;
  /**
   * The application FORM's URL, when it differs from `sourceUrl` (the posting).
   * Job boards routinely put the form on a separate ATS page, so without this
   * a fill would open the posting and find no form to fill.
   */
  formUrl?: string;
  dateFound?: string;
  status?: ApplicationStatus;
  cv?: { selectedVariant?: string; uploadPath?: string };
  artifacts?: Array<{ type: string; path: string }>;
  risks?: string[];
}

const PACKAGE_FILE = "application-package.json";

/** The forward lifecycle path (excludes the from-anywhere/gate states). */
const LIFECYCLE: ApplicationStatus[] = [
  "reviewing",
  "ready",
  "filled-awaiting-submit",
  "submitted-by-user",
  "applied",
  "archived",
];

const ALL_STATUSES: ReadonlySet<ApplicationStatus> = new Set([
  ...LIFECYCLE,
  "duplicate-risk",
]);

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/**
 * Parse + validate against the package schema. Throws with a precise message on
 * a violation (hand-validated to avoid a JSON-schema dependency; kept aligned
 * with application-package.schema.json — schemaVersion const 1, required
 * company/roleTitle, closed status enum, cv shape).
 */
export function parseApplicationPackage(raw: unknown): ApplicationPackage {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("application package must be a JSON object");
  }
  const p = raw as Record<string, unknown>;
  if (p.schemaVersion !== 1) {
    throw new Error("application package: schemaVersion must be 1");
  }
  if (!nonEmptyString(p.company)) {
    throw new Error("application package: company is required (non-empty)");
  }
  if (!nonEmptyString(p.roleTitle)) {
    throw new Error("application package: roleTitle is required (non-empty)");
  }
  if (p.status !== undefined && !ALL_STATUSES.has(p.status as ApplicationStatus)) {
    throw new Error(`application package: unknown status "${String(p.status)}"`);
  }
  return raw as ApplicationPackage;
}

/** Load + validate the package for an application dir, or null when absent. */
export function loadApplicationPackage(
  dir: string | undefined,
): ApplicationPackage | null {
  if (!dir) return null;
  const path = join(dir, PACKAGE_FILE);
  if (!existsSync(path)) return null;
  return parseApplicationPackage(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * True iff `next` is a legal transition from `current`: a no-op, the immediate
 * forward step (`ready → filled-awaiting-submit → submitted-by-user → applied`),
 * `archived` from anywhere, or `duplicate-risk` from the early triage states.
 * Skips (e.g. `ready → applied`) and backward moves are illegal.
 */
export function isLegalStatusTransition(
  current: ApplicationStatus | undefined,
  next: ApplicationStatus,
): boolean {
  const from: ApplicationStatus = current ?? "reviewing";
  if (from === next) return true;
  if (next === "archived") return true;
  if (next === "duplicate-risk") return from === "reviewing" || from === "ready";
  const fromIdx = LIFECYCLE.indexOf(from);
  const nextIdx = LIFECYCLE.indexOf(next);
  return fromIdx >= 0 && nextIdx === fromIdx + 1;
}

/**
 * Record a new status, enforcing the lifecycle. Throws on an illegal transition
 * so a loop cannot skip the human submit gate. Returns the updated package.
 */
export function recordStatus(
  dir: string,
  next: ApplicationStatus,
): ApplicationPackage {
  const pkg = loadApplicationPackage(dir);
  if (!pkg) throw new Error(`no application package in ${dir}`);
  if (!ALL_STATUSES.has(next)) {
    throw new Error(`unknown target status "${next}"`);
  }
  if (!isLegalStatusTransition(pkg.status, next)) {
    throw new Error(
      `illegal status transition ${pkg.status ?? "reviewing"} → ${next}`,
    );
  }
  const updated: ApplicationPackage = { ...pkg, status: next };
  writeFileSync(
    join(dir, PACKAGE_FILE),
    JSON.stringify(updated, null, 2) + "\n",
    "utf8",
  );
  return updated;
}
