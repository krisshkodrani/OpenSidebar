/**
 * Assemble the fill-only mission brief for one application (pi-backend Phase 5).
 *
 * The brief is what the workspace hands to `browser_run_task`. It is built
 * ENTIRELY from the pre-approved manifest — the honesty gate is structural: the
 * browser agent fills verbatim from these lines and is never asked to invent
 * personal data (matches the seed's `cv/risk-notes.md`). The brief is
 * deliberately fill-only; the actual submit is a separate, human-gated step
 * (Phase 4 approval forwarding), so the instruction forbids submitting.
 */

import type { FillManifest } from "./manifest";
import type { ApplicationPackage } from "./package";

/**
 * Build the mission instruction. `cvUrl`, when present, is a loopback URL the
 * agent can fetch the CV from via `upload_file`.
 */
export function assembleFillBrief(
  pkg: ApplicationPackage,
  manifest: FillManifest,
  cvUrl?: string,
): string {
  const lines: string[] = [
    `Fill the job application for ${pkg.roleTitle} at ${pkg.company}. ` +
      `Use ONLY the details below — do not invent or guess any personal data.`,
    `Form: ${manifest.formUrl}`,
    "",
    ...manifest.promptLines,
  ];

  if (cvUrl) {
    const file = manifest.cvServe?.file ?? "the CV";
    lines.push(
      "",
      `Attach the CV by uploading it from this URL: ${cvUrl} (${file}).`,
    );
  }

  lines.push(
    "",
    "DO NOT submit the application. Fill every field, attach the CV if asked, " +
      "then stop and leave it filled for review — the submit is a separate, " +
      "human-approved step. If a required value is missing from the details " +
      "above, stop and report what is missing rather than guessing.",
  );

  return lines.join("\n");
}
