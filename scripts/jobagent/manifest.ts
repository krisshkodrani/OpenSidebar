/**
 * The fill manifest for one application (pi-backend Phase 5).
 *
 * Reuses the `run-config.json` shape the live-application kit already uses, so
 * the seed's real kit and the synthetic fixture both load unchanged. It carries
 * the concrete, PRE-APPROVED apply material — the form URL, the exact field
 * answers, and the CV file — which the workspace hands to the browser agent
 * verbatim. Answers are never synthesized here; provenance is the manifest.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface FillManifest {
  /** The application form URL. */
  formUrl: string;
  /** Turn budget for the fill mission. */
  maxTurns?: number;
  /** The CV to attach: served over loopback so `upload_file` can fetch it. */
  cvServe?: { dir: string; port: number; file: string };
  /** The human-authored instruction lines (what to fill, per field). */
  promptLines: string[];
  /** Byte-exact values expected among the filled inputs (the approved answers). */
  expectedFieldValues: string[];
  /** Long-form answers expected (whitespace-normalized). */
  expectedLongTexts?: string[];
  /** Text expected on the page (e.g. the attached CV filename). */
  expectedPageText?: string[];
  /** Text that must NOT appear — the not-submitted guard. */
  forbiddenPageText?: string[];
}

const MANIFEST_FILE = "run-config.json";

/** Load an application's fill manifest, or null when absent/unspecified. */
export function loadFillManifest(dir: string | undefined): FillManifest | null {
  if (!dir) return null;
  const path = join(dir, MANIFEST_FILE);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as FillManifest;
}
