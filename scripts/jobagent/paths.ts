/**
 * JobAgent workspace path resolution (pi-backend Phase 5).
 *
 * The real applications live outside the repo under the seed store (Phase 0):
 * `~/.opensidebar/seed/applications/<name>/`. Resolution mirrors the seed
 * convention — `OPENSIDEBAR_SEED_DIR` for the seed root, with a dedicated
 * `JOBAGENT_APPLICATIONS_DIR` override for the applications dir itself (matching
 * the separate JobAgent project's `JOBAGENT_APPLICATIONS_DIR`). Kept free of any
 * test-helper import so the host code stays standalone.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** The seed root: `OPENSIDEBAR_SEED_DIR` or `~/.opensidebar/seed`. */
export function resolveSeedDir(): string {
  return resolve(
    process.env.OPENSIDEBAR_SEED_DIR || join(homedir(), ".opensidebar", "seed"),
  );
}

/** The applications dir: `JOBAGENT_APPLICATIONS_DIR` or `<seed>/applications`. */
export function resolveApplicationsDir(): string {
  return resolve(
    process.env.JOBAGENT_APPLICATIONS_DIR ||
      join(resolveSeedDir(), "applications"),
  );
}

/** The directory for one named application. */
export function resolveApplicationDir(name: string): string {
  return join(resolveApplicationsDir(), name);
}
