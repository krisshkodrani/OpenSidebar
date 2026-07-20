/**
 * AI PR review — the IO half. Runs in GitHub Actions (see
 * .github/workflows/ai-review.yml), on demand only.
 *
 * Flow: fetch the PR + its unified diff → reviewer model proposes findings →
 * judge model adjudicates each one independently → post ONE comment with the
 * survivors. Fails loudly: a broken review must not look like a clean review,
 * so any unrecoverable error exits non-zero and the check goes red.
 *
 * Env: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER, plus a key for each seat's
 *      provider (DEEPSEEK_API_KEY reviewer, FIREWORKS_API_KEY judge by
 *      default). Optional AI_REVIEW_MODEL / AI_REVIEW_JUDGE_MODEL — a key is
 *      only demanded for the providers actually used.
 */

import {
  isWellFormedReview,
  buildJudgePrompt,
  buildReviewPrompt,
  extractJson,
  parseFindings,
  parseVerdict,
  renderComment,
  planReviewBatches,
  splitDiff,
  JUDGE_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT,
  TS_REVIEW_SYSTEM_PROMPT,
  type Finding,
} from "./review";

/**
 * Reviewer and judge are deliberately from DIFFERENT model families: an
 * adjudicator that shares the reviewer's blind spots is decoration. DeepSeek
 * reviews, Fireworks-served GPT-OSS judges.
 *
 * deepseek-v4-pro over glm-5p2 for the reviewer seat: measured on the same
 * planted bug, both found it with a correct repro, but DeepSeek's output is
 * $0.87/M against GLM's $2.19/M — and output dominates, since a review spends
 * ~12K reasoning tokens. Fireworks ids MUST be the `accounts/...` form; the
 * catalog-style "openai/gpt-oss-120b" 404s there (proven live, see
 * apps/extension/src/config/model-config.ts).
 */
const REVIEWER_MODEL = process.env.AI_REVIEW_MODEL ?? "deepseek-v4-pro";
const JUDGE_MODEL =
  process.env.AI_REVIEW_JUDGE_MODEL ?? "accounts/fireworks/models/gpt-oss-120b";

interface Provider {
  url: string;
  key: string;
}

/** Route by model id, so swapping a seat via env needs no other change. */
function providerFor(model: string): Provider {
  if (model.startsWith("accounts/fireworks/")) {
    return {
      url: "https://api.fireworks.ai/inference/v1/chat/completions",
      key: required("FIREWORKS_API_KEY"),
    };
  }
  if (model.startsWith("deepseek")) {
    return {
      url: "https://api.deepseek.com/chat/completions",
      key: required("DEEPSEEK_API_KEY"),
    };
  }
  throw new Error(
    `unknown model "${model}" — expected an accounts/fireworks/... or deepseek... id`,
  );
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const token = required("GITHUB_TOKEN");
const repo = required("GITHUB_REPOSITORY");
const prNumber = required("PR_NUMBER");

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

/** One completion from whichever provider serves `model`. Retries transient
 *  429/5xx — hosted pools return 503 under load often enough that a single
 *  blip must not fail a run. */
async function complete(
  model: string,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string> {
  const provider = providerFor(model);
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(provider.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.key}`,
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
        // `content` as clean JSON (DeepSeek does the same), so thinking costs
        // nothing at parse time.
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
  throw new Error(`${model} failed: ${lastError}`);
}

const pr = (await (
  await github(`/pulls/${prNumber}`, "application/vnd.github+json")
).json()) as { title: string; body: string | null };

const diff = await (
  await github(`/pulls/${prNumber}`, "application/vnd.github.v3.diff")
).text();

const { batches, skipped, oversized } = planReviewBatches(splitDiff(diff));
const allFiles = batches.flat();
if (allFiles.length === 0) {
  console.log("nothing reviewable in this diff; skipping");
  process.exit(0);
}
console.log(
  `reviewing ${allFiles.length} file(s) across ${batches.length} request(s); ` +
    `${skipped.length} skipped, ${oversized.length} reviewed alone`,
);

// Every reviewable file gets looked at. Batching (rather than truncating) is
// the whole point: a review that silently skips half a PR still prints a
// verdict, which is worse than no review at all.
// Two lenses per batch. Correctness asks "does this do the wrong thing?";
// TypeScript asks "do the types claim a guarantee the runtime does not?".
// They miss different things, so one pass leaves half the ground unread.
const LENSES = [
  { name: "correctness", prompt: REVIEW_SYSTEM_PROMPT },
  { name: "typescript", prompt: TS_REVIEW_SYSTEM_PROMPT },
];

const proposed: Finding[] = [];
for (const [index, batch] of batches.entries()) {
  console.log(
    `batch ${index + 1}/${batches.length}: ${batch.map((f) => f.path).join(", ")}`,
  );
  const perLens = await Promise.all(
    LENSES.map(async (lens) => {
      const raw = await complete(
        REVIEWER_MODEL,
        lens.prompt,
        buildReviewPrompt(pr.title, pr.body ?? "", batch),
        32_000,
      );
      const json = extractJson(raw);
      // Never post a clean bill of health we did not earn. An unanswered pass
      // must fail the run loudly — a silent [] reads as "reviewed, found none".
      if (!isWellFormedReview(json)) {
        console.error(`${lens.name} raw response (${raw.length} chars):`);
        console.error(raw.slice(0, 2000));
        throw new Error(
          `batch ${index + 1} ${lens.name} lens did not return a findings object — refusing to report a clean review`,
        );
      }
      const found = parseFindings(json);
      console.log(`  ${lens.name}: ${found.length} finding(s)`);
      return found;
    }),
  );
  proposed.push(...perLens.flat());
}

console.log(`reviewer proposed ${proposed.length} finding(s)`);

// Adjudicate independently and concurrently — one finding's verdict must not
// be able to influence another's. The judge is shown every reviewed file, so a
// finding is never rejected merely because its file sat in another batch.
const verdicts = await Promise.all(
  proposed.map(async (finding: Finding) => {
    const raw = await complete(
      JUDGE_MODEL,
      JUDGE_SYSTEM_PROMPT,
      buildJudgePrompt(finding, allFiles),
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
  oversized,
  batchCount: batches.length,
  reviewedCount: allFiles.length,
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
