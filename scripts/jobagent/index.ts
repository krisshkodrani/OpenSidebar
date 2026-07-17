/**
 * JobAgent workspace — host-side data/orchestration layer for the single-package
 * apply loop (pi-backend Phase 5). Pure filesystem + assembly; no browser bridge
 * and no extension imports. The `.pi/extensions/jobagent.ts` extension registers
 * thin tools over these functions and drives the browser via the existing
 * `browser_run_task` / `browser_respond_approval` tools.
 */

import { existsSync, readdirSync } from "node:fs";

import { loadFillManifest, type FillManifest } from "./manifest";
import {
  loadApplicationPackage,
  type ApplicationPackage,
  type ApplicationStatus,
} from "./package";
import { resolveApplicationDir, resolveApplicationsDir } from "./paths";

export { assembleFillBrief } from "./brief";
export { startCvServer, type CvServer } from "./cv-server";
export { recordStatus, isLegalStatusTransition } from "./package";
export type { ApplicationPackage, ApplicationStatus } from "./package";
export type { FillManifest } from "./manifest";
export {
  resolveApplicationDir,
  resolveApplicationsDir,
  resolveSeedDir,
} from "./paths";

export interface ApplicationSummary {
  name: string;
  company: string;
  roleTitle: string;
  status: ApplicationStatus | "unknown";
}

/** One application ready to drive: its dir, validated package, and fill manifest. */
export interface LoadedApplication {
  name: string;
  dir: string;
  package: ApplicationPackage;
  manifest: FillManifest;
}

/**
 * List the applications in the workspace (each subdir with a package). Skips
 * dirs missing/invalid a package rather than throwing, so one bad entry does not
 * hide the rest.
 */
export function listApplications(): ApplicationSummary[] {
  const root = resolveApplicationsDir();
  if (!existsSync(root)) return [];
  const summaries: ApplicationSummary[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const pkg = loadApplicationPackage(resolveApplicationDir(entry.name));
      if (!pkg) continue;
      summaries.push({
        name: entry.name,
        company: pkg.company,
        roleTitle: pkg.roleTitle,
        status: pkg.status ?? "unknown",
      });
    } catch {
      // Invalid package — skip; jobagent_load_application surfaces the error.
    }
  }
  return summaries;
}

/** Load one application, throwing a precise error when the package/manifest is missing. */
export function loadApplication(name: string): LoadedApplication {
  const dir = resolveApplicationDir(name);
  const pkg = loadApplicationPackage(dir);
  if (!pkg) {
    throw new Error(`application "${name}": no application-package.json in ${dir}`);
  }
  const manifest = loadFillManifest(dir);
  if (!manifest) {
    throw new Error(`application "${name}": no run-config.json (fill manifest) in ${dir}`);
  }
  return { name, dir, package: pkg, manifest };
}
