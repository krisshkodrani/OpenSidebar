/**
 * AI PR review — the IO half. Runs in GitHub Actions (see
 * .github/workflows/ai-review.yml), on demand only.
 *
 * Flow: fetch the PR + its unified diff → reviewer model proposes findings →
 * judge model adjudicates each one independently → post ONE comment with the
 * survivors. Fails loudly: a broken review must not look like a clean review,
 * so any unrecoverable error exits non-zero and the check goes red.
 *
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, FIREWORKS_API_KEY,
 *      optional AI_REVIEW_MODEL / AI_REVIEW_JUDGE_MODEL.
 */

import {
  isWellFormedReview,
  buildJudgePrompt,
  buildReviewPrompt,
  extractJson,
  parseFindings,
  parseVerdict,
  renderComment,
  selectForReview,
  splitDiff,
  JUDGE_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT,
  type Finding,
} from "./review";

// Fireworks ids MUST be the `accounts/...` form — the catalog-style
// "openai/gpt-oss-120b" 404s on the Fireworks endpoint (proven live, see
// apps/extension/src/config/model-config.ts).
const REVIEWER_MODEL =
  process.env.AI_REVIEW_MODEL ?? "accounts/fireworks/models/glm-5p2";
const JUDGE_MODEL =
  process.env.AI_REVIEW_JUDGE_MODEL ?? "accounts/fireworks/models/gpt-oss-120b";

const FIREWORKS_URL = "https://api.fireworks.ai/inference/v1/chat/completions";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const token = required("GITHUB_TOKEN");
const repo = required("GITHUB_REPOSITORY");
const prNumber = required("PR_NUMBER");
const fireworksKey = required("FIREWORKS_API_KEY");

async function github(path: string, accept: string): Promise<Response> {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub ${path} → ${res.status} ${await res.text()}`);
  }
  return res;
}

/** One Fireworks completion. Retries transient 429/5xx — the qwen/GLM pools
 *  return 503 under load often enough that a single blip must not fail a run. */
async function complete(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string> {
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(FIREWORKS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${fireworksKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0,
        // NO json_object mode on purpose. It gets parseable output by
        // suppressing deliberation — the same diff returns `{"findings":[]}`
        // instantly, an answer with no analysis behind it. These are reasoning
        // models: let them think and give them room. Fireworks returns the
        // chain of thought in a separate `reasoning_content` field and leaves
        // `content` as clean JSON, so thinking costs nothing at parse time.
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        choices?: Array<{
          finish_reason?: string;
          message?: { content?: string; reasoning_content?: string };
        }>;
        usage?: { completion_tokens?: number };
      };
      const choice = json.choices?.[0];
      // Truncation is the failure that looks like success: the model is cut off
      // mid-thought, `content` holds prose or nothing, and a naive parse yields
      // "no findings". Detect it here rather than inferring it downstream.
      if (choice?.finish_reason === "length") {
        throw new Error(
          `${model} hit the ${maxTokens}-token budget while thinking ` +
            `(reasoning ${choice.message?.reasoning_content?.length ?? 0} chars) — ` +
            "raise max_tokens; it never reached its answer",
        );
      }
      console.log(
        `${model}: ${json.usage?.completion_tokens ?? "?"} completion tokens, ` +
          `${choice?.message?.reasoning_content?.length ?? 0} chars reasoning`,
      );
      return choice?.message?.content ?? "";
    }
    lastError = `${res.status} ${await res.text()}`;
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error(`Fireworks ${model} failed: ${lastError}`);
}

const pr = (await (
  await github(`/pulls/${prNumber}`, "application/vnd.github+json")
).json()) as { title: string; body: string | null };

const diff = await (
  await github(`/pulls/${prNumber}`, "application/vnd.github.v3.diff")
).text();

const { selected, skipped, truncated } = selectForReview(splitDiff(diff));
if (selected.length === 0) {
  console.log("nothing reviewable in this diff; skipping");
  process.exit(0);
}
console.log(
  `reviewing ${selected.length} file(s); ${skipped.length} skipped, ${truncated.length} too large`,
);

const reviewRaw = await complete(
  REVIEWER_MODEL,
  REVIEW_SYSTEM_PROMPT,
  buildReviewPrompt(pr.title, pr.body ?? "", selected),
  32_000,
);
const reviewJson = extractJson(reviewRaw);
// Never post a clean bill of health we did not earn. An unanswered review must
// fail the run loudly — a silent [] here reads as "reviewed, nothing found".
if (!isWellFormedReview(reviewJson)) {
  console.error(`reviewer raw response (${reviewRaw.length} chars):`);
  console.error(reviewRaw.slice(0, 2000));
  throw new Error(
    "reviewer did not return a findings object — refusing to report a clean review",
  );
}
const proposed = parseFindings(reviewJson);
console.log(`reviewer proposed ${proposed.length} finding(s)`);

// Adjudicate independently and concurrently — one finding's verdict must not
// be able to influence another's.
const verdicts = await Promise.all(
  proposed.map(async (finding: Finding) => {
    const raw = await complete(
      JUDGE_MODEL,
      JUDGE_SYSTEM_PROMPT,
      buildJudgePrompt(finding, selected),
      2_048,
    );
    const verdict = parseVerdict(extractJson(raw));
    console.log(
      `judge: ${verdict.keep ? "KEEP  " : "REJECT"} ${finding.file} — ${finding.title} (${verdict.reason})`,
    );
    return { finding, verdict };
  }),
);

const kept = verdicts.filter((v) => v.verdict.keep).map((v) => v.finding);
const body = renderComment({
  findings: kept,
  reviewerModel: REVIEWER_MODEL,
  judgeModel: JUDGE_MODEL,
  rejectedCount: verdicts.length - kept.length,
  skipped,
  truncated,
});

const post = await fetch(
  `https://api.github.com/repos/${repo}/issues/${prNumber}/comments`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ body }),
  },
);
if (!post.ok) {
  throw new Error(`posting comment failed: ${post.status} ${await post.text()}`);
}
console.log(`posted review: ${kept.length} kept, ${verdicts.length - kept.length} rejected`);
