/**
 * Assemble the mission brief for one application (pi-backend Phase 5).
 *
 * The brief is what the workspace hands to `browser_run_task`. It is built
 * ENTIRELY from the pre-approved manifest — the honesty gate is structural: the
 * browser agent fills verbatim from these lines and is never asked to invent
 * personal data (matches the seed's `cv/risk-notes.md`).
 *
 * Two modes, ONE set of field lines. The submit brief re-states every value
 * rather than assuming an earlier fill is still on screen: fill and submit are
 * separate runs with separate browser sessions, so submit opens its own tab and
 * a form's state does not survive that (issue #109). Re-filling from the
 * manifest makes submit deterministic and safe to retry, and it types exactly
 * the same approved values either way — the manifest is the source of truth in
 * both modes, so nothing about the honesty property changes.
 *
 * The human gate is untouched: the submit click is a consequential action and
 * is forwarded for approval by the extension (Phase 4).
 */

import type { FillManifest } from "./manifest";
import type { ApplicationPackage } from "./package";

export interface BriefOptions {
  /**
   * Submit after filling. The submit click still pauses for human approval —
   * this only removes the "do not submit" instruction, it grants nothing.
   */
  submit?: boolean;
}

/**
 * Build the mission instruction. `cvUrl`, when present, is a loopback URL the
 * agent can fetch the CV from via `upload_file`.
 */
export function assembleFillBrief(
  pkg: ApplicationPackage,
  manifest: FillManifest,
  cvUrl?: string,
  options: BriefOptions = {},
): string {
  const lines: string[] = [
    `${options.submit ? "Complete and submit" : "Fill"} the job application ` +
      `for ${pkg.roleTitle} at ${pkg.company}. ` +
      `Use ONLY the details below — do not invent or guess any personal data.`,
    `Form: ${manifest.formUrl}`,
    "",
    ...(options.submit
      ? [
          "Some fields may already hold these values from an earlier attempt. " +
            "Set every field to exactly the value listed below regardless — " +
            "matching values need no change, differing ones must be corrected.",
          "",
        ]
      : []),
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
    options.submit
      ? "When every field above holds its listed value and the CV is attached, " +
        "submit the application, then report the outcome visible on the page. " +
        "Submitting is a consequential action and will pause for human " +
        "approval — that is expected; wait for the decision rather than " +
        "looking for another way to submit. If a required value is missing " +
        "from the details above, stop and report what is missing rather than " +
        "guessing, and do NOT submit a partly filled form."
      : "DO NOT submit the application. Fill every field, attach the CV if asked, " +
        "then stop and leave it filled for review — the submit is a separate, " +
        "human-approved step. If a required value is missing from the details " +
        "above, stop and report what is missing rather than guessing.",
  );

  return lines.join("\n");
}
