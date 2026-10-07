/** LP-39 isolated judge compatibility pilot; never changes runtime defaults. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  runRubricJudge,
  type JudgeRubric,
} from "../apps/extension/src/background/agent/completion/judge.js";
import {
  jevRubricRequest,
  parseJevRubricResponse,
} from "../apps/extension/src/background/llm/jev-decision.js";
import { ModelBenchBudget } from "./modelbench-budget.js";

const directory = resolve(
  process.argv[2] ?? ".artifacts/harness-simplification/2026-10-05/judge-pilot",
);
const execute = process.argv.includes("--run");
const models = [
  "openai/gpt-oss-120b",
  "openai/gpt-6-luna",
  "typesafe/jev-1.13",
];
const fixture = "tests/fixtures/judge-benchmark/smoke-v1.json";
const sources = [
  fixture,
  "scripts/modelbench-judge-pilot.ts",
  "scripts/modelbench-budget.ts",
  "apps/extension/src/background/agent/completion/judge.ts",
  "apps/extension/src/background/llm/jev-decision.ts",
  "pnpm-lock.yaml",
];
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const hashes = Object.fromEntries(
  sources.map((path) => [path, digest(readFileSync(path, "utf8"))]),
);
const cases = JSON.parse(readFileSync(fixture, "utf8")) as Array<{
  id: string;
  split: string;
  kind: string;
  expectedPass: boolean;
  rubric: JudgeRubric;
}>;
mkdirSync(directory, { recursive: true });
const manifestPath = `${directory}/manifest.json`;
if (!existsSync(manifestPath)) {
  const endpoints: Record<string, unknown> = {};
  for (const model of models) {
    const response = await fetch(
      `https://openrouter.ai/api/v1/models/${model}/endpoints`,
    );
    if (!response.ok) throw new Error(`Metadata unavailable: ${model}`);
    endpoints[model] = await response.json();
  }
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        schemaVersion: 1,
        phase: "judge-compatibility-smoke",
        createdAt: new Date().toISOString(),
        revision: execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim(),
        node: process.version,
        hashes,
        models,
        cases,
        campaignCapUsd: 10,
        maxOutputTokens: 2048,
        timeoutMs: 25000,
        providerMaxPricePerMillion: { prompt: 1, completion: 1 },
        jevMaxInputPricePerToken: 0.000000042,
        jevThreshold: 0.9,
        thresholdTuning:
          "none; predeclared smoke threshold, not calibrated for production",
        executionOrder: cases.flatMap((item, index) =>
          models.map((_, offset) => ({
            caseId: item.id,
            model: models[(offset + index) % models.length],
          })),
        ),
        endpoints,
        browserBuild:
          "not applicable: pure rubric-judge seam; browser task comparison is separate",
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (JSON.stringify(manifest.hashes) !== JSON.stringify(hashes))
  throw new Error("Frozen pilot sources changed; do not reuse this manifest");
if (!execute) {
  console.log(`Frozen manifest: ${manifestPath}`);
  process.exit(0);
}
// Node's env loader does not print credentials and preserves already supplied values.
if (existsSync(".env")) process.loadEnvFile(".env");
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("OPENROUTER_API_KEY is required");
const budget = new ModelBenchBudget(resolve(directory, "../budget.json"), 10);
const resultsPath = `${directory}/results.json`;
const results: Array<Record<string, unknown>> = existsSync(resultsPath)
  ? JSON.parse(readFileSync(resultsPath, "utf8"))
  : [];

async function request(model: string, body: object, signal?: AbortSignal) {
  const jev = model === "typesafe/jev-1.13";
  // Reserve the entire model context at a capped price, not a token estimate.
  const metadata = manifest.endpoints[model].data.endpoints;
  const maxContext = Math.max(
    ...metadata.map(
      (endpoint: { context_length: number }) => endpoint.context_length,
    ),
  );
  if (!Number.isFinite(maxContext) || maxContext <= 0)
    throw new Error("Missing context bound");
  if (
    jev &&
    metadata.some(
      (endpoint: { pricing: { prompt: string; completion: string } }) =>
        Number(endpoint.pricing.prompt) > 0.000000042 ||
        Number(endpoint.pricing.completion) !== 0,
    )
  ) {
    throw new Error("Jev pricing exceeds frozen bound");
  }
  const id = budget.reserve(
    model,
    jev ? maxContext * 0.000000042 : (maxContext + 2048) / 1e6,
  );
  const response = await fetch(
    `https://openrouter.ai/api/${jev ? "alpha/decisions" : "v1/chat/completions"}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(25000)])
        : AbortSignal.timeout(25000),
    },
  );
  const raw = await response.json();
  writeFileSync(
    `${directory}/response-${id}.json`,
    JSON.stringify(raw, null, 2),
    { flag: "wx" },
  );
  // Even HTTP/provider failures remain reserved unless actual charge is known.
  budget.settle(id, raw.usage?.cost);
  if (!response.ok || raw.error)
    throw new Error(`Provider failure; inspect response-${id}.json`);
  return raw;
}
try {
  for (const entry of manifest.executionOrder) {
    if (
      results.some(
        (result) =>
          result.caseId === entry.caseId && result.model === entry.model,
      )
    )
      continue;
    const item = cases.find((candidate) => candidate.id === entry.caseId)!;
    const started = Date.now();
    let observedPass = false;
    let valid = false;
    let detail: unknown;
    if (entry.model === "typesafe/jev-1.13") {
      const raw = await request(entry.model, jevRubricRequest(item.rubric));
      const parsed = parseJevRubricResponse(item.rubric, raw);
      observedPass = parsed.criteria
        .filter((criterion) => criterion.required)
        .every(
          (criterion) =>
            criterion.choice === "entailed" &&
            criterion.probabilities.entailed >= manifest.jevThreshold,
        );
      valid = true;
      detail = { ...parsed, usage: raw.usage };
    } else {
      const verdict = await runRubricJudge(item.rubric, {
        timeoutMs: 26000,
        seat: {
          async runJudge(args) {
            const raw = await request(
              entry.model,
              {
                model: entry.model,
                messages: [
                  { role: "system", content: args.systemPrompt },
                  { role: "user", content: args.userPrompt },
                ],
                max_tokens: 2048,
                provider: { max_price: { prompt: 1, completion: 1 } },
              },
              args.signal,
            );
            if (
              raw.model !== entry.model &&
              !(
                entry.model === "openai/gpt-6-luna" &&
                raw.model === "openai/gpt-6-luna-20260922"
              )
            )
              throw new Error("Model identity mismatch");
            return {
              text: raw.choices?.[0]?.message?.content ?? "",
              model: raw.model,
              providerId: raw.provider,
              usage: {
                promptTokens: raw.usage.prompt_tokens,
                completionTokens: raw.usage.completion_tokens,
                totalTokens: raw.usage.total_tokens,
                costUsd: raw.usage.cost,
              },
            };
          },
        },
      });
      observedPass = verdict.pass;
      valid = verdict.source === "judge";
      detail = verdict;
    }
    results.push({
      caseId: item.id,
      split: item.split,
      kind: item.kind,
      model: entry.model,
      expectedPass: item.expectedPass,
      observedPass,
      valid,
      correct: valid && observedPass === item.expectedPass,
      durationMs: Date.now() - started,
      detail,
    });
    writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    console.log(
      `${item.id} ${entry.model}: ${valid ? (observedPass === item.expectedPass ? "correct" : "WRONG") : "invalid"}`,
    );
  }
} finally {
  budget.close();
}
console.log(`Results: ${resultsPath}`);
