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
  // Recorded corpora, regenerated with UPDATE_COMPLETION_CORPUS=1 — nobody
  // hand-edits these, and on a big PR they crowd out real source files.
  /^apps\/extension\/tests\/fixtures\//,
  /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|mp4|pdf|zip)$/i,
  /\.min\.(js|css)$/,
];

/**
 * Review order when a budget has to bind. Diff order is alphabetical, which is
 * meaningless — on the design-debt PR it spent the budget on early files and
 * dropped the entire `packages/shared-types/src/messages/` split, the riskiest
 * change in the PR. Source code earns attention first, prose last.
 */
function reviewPriority(path: string): number {
  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) return 0;
  if (/\.(json|ya?ml|toml)$/.test(path)) return 1;
  return 2; // markdown and everything else
}

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
 * Plan the review as BATCHES that together cover every reviewable file.
 *
 * The first version truncated instead: one request, and whatever did not fit
 * was simply never looked at. On a 47-file PR that silently dropped 20 files
 * — including the entire message-union split it most needed to check. A review
 * that skips the risky half of a change is worse than no review, because it
 * still prints a verdict.
 *
 * Files are ordered by `reviewPriority` so that if anything must be dropped it
 * is prose, never source. `oversized` holds files whose single patch exceeds a
 * whole batch budget; they are reviewed alone, and the caller reports them so
 * the reader knows they got a batch to themselves.
 */
export function planReviewBatches(
  files: FileDiff[],
  maxChars: number = MAX_REVIEW_CHARS,
): { batches: FileDiff[][]; skipped: string[]; oversized: string[] } {
  const skipped: string[] = [];
  const candidates: FileDiff[] = [];
  for (const file of files) {
    if (isReviewablePath(file.path)) candidates.push(file);
    else skipped.push(file.path);
  }
  candidates.sort((a, b) => reviewPriority(a.path) - reviewPriority(b.path));

  const batches: FileDiff[][] = [];
  const oversized: string[] = [];
  let current: FileDiff[] = [];
  let used = 0;
  for (const file of candidates) {
    if (file.patch.length > maxChars) {
      // Too big to share a batch with anything: give it its own request rather
      // than dropping it. Better a lone huge file than an unreviewed one.
      oversized.push(file.path);
      batches.push([file]);
      continue;
    }
    if (used + file.patch.length > maxChars && current.length > 0) {
      batches.push(current);
      current = [];
      used = 0;
    }
    current.push(file);
    used += file.patch.length;
  }
  if (current.length > 0) batches.push(current);
  return { batches, skipped, oversized };
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

/**
 * A second, TypeScript-specific lens. The correctness lens asks "does this do
 * the wrong thing?"; this one asks "does this type system claim something the
 * runtime does not guarantee?" — the failure mode where tsc is green, the code
 * looks reviewed, and the contract is fiction.
 *
 * The catalogue below was researched with deepseek-v4-pro and then curated
 * against this repo: MV3-specific realms, the ServiceNow/tool three-layer
 * param contract, and the exhaustive `never` check that guards RuntimeMessage.
 * Items a strict tsc or the linter already catches reliably are excluded — they
 * would be noise.
 */
export const TS_REVIEW_SYSTEM_PROMPT = [
  "You review a pull request diff for TypeScript unsoundness and sub-par typing.",
  "Report at two levels, and label each finding's severity accordingly:",
  "",
  "A. UNSOUND (high/medium) — the types claim a guarantee the runtime does not:",
  "  - `as` assertion on unvalidated data (JSON.parse, storage, network, message",
  "    payloads). The shape is asserted, never checked.",
  "  - non-null `!` on something that can genuinely be absent (DOM lookups,",
  "    map.get, array index, optional config).",
  "  - indexed access treated as present: `arr[0].x`, `map[key].y`.",
  "  - `any` (or `as any`) re-entering typed code, so property access is unchecked.",
  "  - catch variable used as an Error (`e.message`) without narrowing.",
  "  - user-defined type guard whose runtime check does not actually prove the",
  "    type it narrows to.",
  "  - discriminated union narrowed by assertion instead of by its tag.",
  "  - missing case in a discriminated union / switch, especially where an",
  "    exhaustive `never` check is the established pattern.",
  "  - floating promise: async work started and not awaited or caught, so a",
  "    rejection is silent (fatal in an MV3 service worker).",
  "  - realm/context errors: `window` or DOM globals in a service worker;",
  "    `instanceof` across the content-script/page boundary; `structuredClone`",
  "    or postMessage dropping methods and prototypes from a class instance.",
  "  - `delete` of a property the type declares as required.",
  "  - a test mock whose shape does not match the real module's exports, so the",
  "    test passes against a contract that does not exist.",
  "",
  "B. SUB-PAR (low) — types that compile but erase a contract that was available:",
  "  - `Record<string, unknown>` / `object` / `string` where a union, literal",
  "    type, or an existing shared type already models the value.",
  "  - a shape re-declared locally instead of importing the canonical type,",
  "    so the two can drift apart silently.",
  "  - everything optional (`a?: X; b?: Y`) when the states are actually",
  "    mutually exclusive and a discriminated union would make illegal states",
  "    unrepresentable.",
  "  - a parameter or return typed loosely enough that a caller passing the",
  "    wrong thing still compiles.",
  "",
  "Every finding — including sub-par ones — MUST name a concrete consequence:",
  "the input or state, and the wrong result, crash, or contract that goes",
  "unchecked. 'This could be typed better' with no consequence is not a finding.",
  "",
  "Do NOT report formatting, naming, import order, comments, or anything a",
  "strict tsc already rejects.",
  "",
  "Respond with STRICT JSON only, no prose, no markdown fence:",
  '{"findings":[{"file":"path","line":123,"severity":"high|medium|low",',
  '"title":"one line","detail":"why the type claim is false or weak",',
  '"failureScenario":"inputs -> wrong result / unchecked contract"}]}',
  "",
  "An empty findings array is valid. A wrong finding costs the author more time",
  "than a missed one.",
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

/**
 * Did the model actually answer the question? A reasoning model asked for JSON
 * will happily deliberate in prose until it runs out of tokens and never emit
 * the object — and `parseFindings` cannot tell that apart from an honest empty
 * result, so the tool posts a clean bill of health it never earned. It did
 * exactly that on its first two live runs. Callers MUST check this and fail
 * loudly rather than reporting "no defects".
 */
export function isWellFormedReview(raw: unknown): boolean {
  return (
    !!raw &&
    typeof raw === "object" &&
    Array.isArray((raw as { findings?: unknown }).findings)
  );
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
  /** Files large enough to need a review request to themselves. */
  oversized: string[];
  /** How many requests the diff was split across. */
  batchCount: number;
  /** Reviewable files actually sent. */
  reviewedCount: number;
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
      `${input.reviewedCount} file(s) across ${input.batchCount} request(s); ` +
      `${input.rejectedCount} finding(s) rejected as unproven.`,
  );
  if (input.skipped.length > 0) {
    lines.push(
      "",
      `Not reviewed (generated/vendored/binary): ${input.skipped.join(", ")}.`,
    );
  }
  if (input.oversized.length > 0) {
    lines.push(
      "",
      `Reviewed alone (large diffs): ${input.oversized.join(", ")}.`,
    );
  }
  lines.push("", "_Machine review. It is wrong sometimes — judge it, don't trust it._");
  return lines.join("\n");
}
