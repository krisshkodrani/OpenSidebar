/**
 * AI PR review — the deterministic half.
 *
 * An INDEPENDENT second opinion: the reviewer seat is a non-Claude model
 * (Fireworks GLM), and a second non-Claude model (GPT-OSS, the repo's existing
 * judge seat) adjudicates every finding before it is posted. Weaker models are
 * confident and wrong more often than they are silent, so the judge pass is
 * what makes the output readable rather than noisy — the same reason the agent
 * runtime has a judge seat (RFC LP-15 Phase 10).
 *
 * Everything in this file is pure and unit-tested; all network/GitHub IO lives
 * in `main.ts`. Nothing here imports extension code — the workflow runs with
 * `pnpm install` only.
 */

/** Diff hunks for one file, as split out of a unified diff. */
export interface FileDiff {
  path: string;
  /** The raw `diff --git …` section, verbatim. */
  patch: string;
}

export interface Finding {
  file: string;
  line?: number;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  /** How this breaks: concrete inputs/state → wrong behaviour. */
  failureScenario?: string;
}

export interface Verdict {
  keep: boolean;
  reason: string;
}

/**
 * Paths never worth a model's attention: generated output, lockfiles, vendored
 * corpora and binaries. Reviewing these burns tokens and produces findings the
 * author cannot act on (the file is rebuilt, not edited).
 */
const SKIP_PATTERNS: RegExp[] = [
  /^dist\//,
  /^dist-dev\//,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)package-lock\.json$/,
  // Built by `pnpm run prompts:build` — CLAUDE.md forbids editing it directly.
  /^apps\/extension\/src\/prompts\/generated\.ts$/,
  /^apps\/extension\/tests\/e2e\/bench\//,
  /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|mp4|pdf|zip)$/i,
  /\.min\.(js|css)$/,
];

/** Total patch characters sent to the reviewer. Beyond this we truncate. */
export const MAX_REVIEW_CHARS = 180_000;

export function isReviewablePath(path: string): boolean {
  return !SKIP_PATTERNS.some((p) => p.test(path));
}

/**
 * Split a unified diff into per-file sections. Tolerant by design: GitHub's
 * diff output includes renames, mode changes and binary stubs, and a parser
 * that throws on any of those would take the whole review down.
 */
export function splitDiff(diff: string): FileDiff[] {
  const sections = diff.split(/^diff --git /m).filter((s) => s.trim().length > 0);
  const files: FileDiff[] = [];
  for (const section of sections) {
    // `a/path/to/file b/path/to/file` — take the b-side (post-change) path.
    const header = section.split("\n", 1)[0] ?? "";
    const match = header.match(/\s+b\/(.+)$/);
    const path = match?.[1]?.trim();
    if (!path) continue;
    files.push({ path, patch: `diff --git ${section}`.trimEnd() });
  }
  return files;
}

/**
 * The files worth reviewing, largest-context-first truncation. Returns what
 * was dropped so the posted comment can say so — a silent cap reads as
 * "reviewed everything" when it did not.
 */
export function selectForReview(
  files: FileDiff[],
  maxChars: number = MAX_REVIEW_CHARS,
): { selected: FileDiff[]; skipped: string[]; truncated: string[] } {
  const skipped: string[] = [];
  const candidates: FileDiff[] = [];
  for (const file of files) {
    if (isReviewablePath(file.path)) candidates.push(file);
    else skipped.push(file.path);
  }

  const selected: FileDiff[] = [];
  const truncated: string[] = [];
  let budget = maxChars;
  for (const file of candidates) {
    if (file.patch.length <= budget) {
      selected.push(file);
      budget -= file.patch.length;
    } else {
      truncated.push(file.path);
    }
  }
  return { selected, skipped, truncated };
}

export const REVIEW_SYSTEM_PROMPT = [
  "You are a rigorous code reviewer. You are reviewing a pull request diff.",
  "",
  "Report ONLY defects you can point at a specific changed line: correctness",
  "bugs, security holes, data loss, race conditions, broken error handling,",
  "and tests that assert nothing. Do NOT report style, formatting, naming,",
  "missing comments, or speculative refactors.",
  "",
  "For each finding you MUST give a concrete failure scenario: specific inputs",
  "or state, and the wrong result they produce. If you cannot write that",
  "scenario, the finding is not real — drop it.",
  "",
  "Respond with STRICT JSON only, no prose, no markdown fence:",
  '{"findings":[{"file":"path","line":123,"severity":"high|medium|low",',
  '"title":"one line","detail":"why it is wrong","failureScenario":"inputs -> wrong result"}]}',
  "",
  "An empty findings array is a valid and common answer. Prefer silence to",
  "guessing: a wrong finding costs the author more time than a missed one.",
].join("\n");

export function buildReviewPrompt(
  title: string,
  body: string,
  files: FileDiff[],
): string {
  const parts = [
    `Pull request: ${title}`,
    body.trim() ? `Description:\n${body.trim()}` : "Description: (none)",
    "",
    "Diff:",
    ...files.map((f) => f.patch),
  ];
  return parts.join("\n");
}

export const JUDGE_SYSTEM_PROMPT = [
  "You adjudicate a code-review finding. The reviewer is an LLM and is often",
  "confidently wrong. Your default is to REJECT.",
  "",
  "Keep the finding ONLY if the diff itself proves it: the cited line exists in",
  "the diff, and the described failure genuinely follows from the changed code.",
  "Reject if the claim depends on code you cannot see, restates a style",
  "preference, describes intended behaviour, or has no concrete failure.",
  "",
  'Respond with STRICT JSON only: {"keep":true|false,"reason":"one line"}',
].join("\n");

export function buildJudgePrompt(finding: Finding, files: FileDiff[]): string {
  const context =
    files.find((f) => f.path === finding.file)?.patch ??
    "(the reviewer cited a file that is not in this diff)";
  return [
    "Finding:",
    JSON.stringify(finding, null, 1),
    "",
    "The diff for the cited file:",
    context,
  ].join("\n");
}

/**
 * Extract JSON from a model response. Models wrap JSON in prose or fences
 * despite instructions, so we strip fences and fall back to the outermost
 * brace pair before giving up.
 */
export function extractJson(text: string): unknown {
  const unfenced = text.replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf("{");
    const end = unfenced.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(unfenced.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

const SEVERITIES = new Set(["high", "medium", "low"]);

/** Hand-validated parse (package.ts convention): drop malformed entries. */
export function parseFindings(raw: unknown): Finding[] {
  const container = raw as { findings?: unknown } | null;
  const list = Array.isArray(container?.findings) ? container.findings : [];
  const findings: Finding[] = [];
  for (const item of list) {
    const f = item as Record<string, unknown>;
    if (typeof f?.file !== "string" || typeof f?.title !== "string") continue;
    if (f.file.length === 0 || f.title.length === 0) continue;
    findings.push({
      file: f.file,
      line: typeof f.line === "number" && Number.isFinite(f.line) ? f.line : undefined,
      severity: SEVERITIES.has(String(f.severity))
        ? (f.severity as Finding["severity"])
        : "medium",
      title: f.title,
      detail: typeof f.detail === "string" ? f.detail : "",
      failureScenario:
        typeof f.failureScenario === "string" ? f.failureScenario : undefined,
    });
  }
  return findings;
}

/**
 * A judge response that cannot be parsed REJECTS the finding. Failing open
 * would let every unparseable verdict through, which is precisely the noise
 * the judge exists to stop.
 */
export function parseVerdict(raw: unknown): Verdict {
  const v = raw as Record<string, unknown> | null;
  if (!v || typeof v.keep !== "boolean") {
    return { keep: false, reason: "judge response unparseable — rejected by default" };
  }
  return {
    keep: v.keep,
    reason: typeof v.reason === "string" ? v.reason : "(no reason given)",
  };
}

const SEVERITY_RANK: Record<Finding["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
}

export interface CommentInput {
  findings: Finding[];
  reviewerModel: string;
  judgeModel: string;
  /** Findings the judge rejected — reported as a count, for calibration. */
  rejectedCount: number;
  skipped: string[];
  truncated: string[];
}

/** The PR comment. States its own limits — a silent cap is a lie by omission. */
export function renderComment(input: CommentInput): string {
  const lines: string[] = ["## AI review (independent, non-Claude)", ""];

  if (input.findings.length === 0) {
    lines.push("No defects survived adjudication.", "");
  } else {
    for (const f of sortFindings(input.findings)) {
      const where = f.line ? `${f.file}:${f.line}` : f.file;
      lines.push(`### ${f.severity.toUpperCase()} — ${f.title}`);
      lines.push(`\`${where}\``, "");
      if (f.detail) lines.push(f.detail, "");
      if (f.failureScenario) lines.push(`**Failure:** ${f.failureScenario}`, "");
    }
  }

  lines.push("---", "");
  lines.push(
    `Reviewer \`${input.reviewerModel}\` → judge \`${input.judgeModel}\`; ` +
      `${input.rejectedCount} finding(s) rejected as unproven.`,
  );
  if (input.skipped.length > 0) {
    lines.push(
      "",
      `Not reviewed (generated/vendored/binary): ${input.skipped.join(", ")}.`,
    );
  }
  if (input.truncated.length > 0) {
    lines.push(
      "",
      `**Not reviewed — diff too large:** ${input.truncated.join(", ")}. ` +
        "These files were NOT looked at.",
    );
  }
  lines.push("", "_Machine review. It is wrong sometimes — judge it, don't trust it._");
  return lines.join("\n");
}
