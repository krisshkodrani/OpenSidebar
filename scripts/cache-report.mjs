/**
 * Prompt-cache report — RFC LP-21 §7.
 *
 * Turns a population of recorded runs into a verdict about prompt-cache
 * efficiency. Reads `traces/*.jsonl` locally; no API calls, no cost.
 *
 * Run with tsx (so the real pricing table can be imported rather than copied —
 * duplicating rates here is exactly the drift the RFC warns about):
 *
 *   pnpm run cache:report
 *   pnpm run cache:report -- --since 2d --json --out .artifacts/cache/run-a.json
 *   pnpm run cache:report -- --baseline .artifacts/cache/run-a.json
 *
 * ## What it will and will not claim
 *
 * The RFC is explicit that percentage points are not interpretable as savings
 * and that populations must never be mixed. So this report:
 *
 *   - groups by (tier, provider, model) AND run-length bin, never pooling them;
 *   - separates turn 1 (cold by construction) from warm turns;
 *   - reports absolute cached tokens and USD alongside every percentage;
 *   - reports instrumentation COVERAGE, so traces recorded before the §9
 *     telemetry landed are never silently read as "0% divergence";
 *   - refuses to print a verdict when the sample is too small to support one.
 *
 * ## The acceptance criterion
 *
 * Compaction has to discard the cached prefix; that cost is one-time and
 * expected. What is NOT expected is a prefix break on a turn where no
 * compaction ran. So the headline number is the UNEXPLAINED divergence rate:
 * warm turns whose prompt diverged in `system` or `history` while carrying no
 * `prefixReset`. Issue #103 is the claim that this rate is high. The step-3 fix
 * is done when it reaches ~0 and each compaction accounts for exactly one reset.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  estimateCostBreakdownUsd,
  findModelPricing,
} from "../apps/extension/src/background/llm/pricing.ts";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TRACE_DIR = join(PROJECT_ROOT, "traces");

/**
 * Chars-per-token divisor, matching `ContextManager.estimateMessageTokens`.
 *
 * The §9 prefix metrics are measured in CHARACTERS while realized cache hit is
 * measured in TOKENS. The RFC calls out that comparing the two without
 * converting is a mistake, so every char-based figure is converted here and
 * labelled `_est`. It is an estimate, not a tokenizer.
 */
const CHARS_PER_TOKEN = 4;

/** Run-length bins. Cache behaviour differs sharply with conversation length. */
const RUN_LENGTH_BINS = [
  { label: "1-9", min: 1, max: 9 },
  { label: "10-24", min: 10, max: 24 },
  { label: "25-49", min: 25, max: 49 },
  { label: "50+", min: 50, max: Infinity },
];

/** Below this many warm turns, a group's rates are noise. */
const MIN_WARM_TURNS_FOR_VERDICT = 20;

function parseArgs(argv) {
  const args = {
    since: null,
    session: null,
    json: false,
    out: null,
    baseline: null,
    minTurns: MIN_WARM_TURNS_FOR_VERDICT,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--since") args.since = next();
    else if (arg === "--session") args.session = next();
    else if (arg === "--json") args.json = true;
    else if (arg === "--out") args.out = next();
    else if (arg === "--baseline") args.baseline = next();
    else if (arg === "--min-turns") args.minTurns = Number(next());
    else if (arg === "--help" || arg === "-h") args.help = true;
    // `pnpm run x -- --flag` forwards the bare separator too.
    else if (arg === "--") continue;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

/** `--since` accepts an ISO date or a relative `7d` / `36h`. */
function resolveSince(since) {
  if (!since) return null;
  const relative = /^(\d+)([dh])$/.exec(since);
  if (relative) {
    const amount = Number(relative[1]);
    const ms = relative[2] === "d" ? 86_400_000 : 3_600_000;
    return Date.now() - amount * ms;
  }
  const parsed = Date.parse(since);
  if (Number.isNaN(parsed)) throw new Error(`Cannot parse --since: ${since}`);
  return parsed;
}

function readJsonl(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const rows = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // A partially-flushed final line is normal while a run is in flight.
    }
  }
  return rows;
}

/** Session outcome by id, so cache can be reported against task success. */
function loadSessionOutcomes() {
  const outcomes = new Map();
  for (const session of readJsonl(join(TRACE_DIR, "index.jsonl"))) {
    if (session?.sessionId) outcomes.set(session.sessionId, session);
  }
  return outcomes;
}

function loadTurns({ since, session }) {
  let files;
  try {
    files = readdirSync(TRACE_DIR).filter(
      (name) => name.endsWith(".jsonl") && name !== "index.jsonl",
    );
  } catch {
    throw new Error(
      `No traces/ directory at ${TRACE_DIR}. Run the agent first, or check that the log server wrote here (see the port-7589 worktree trap in LP-21).`,
    );
  }

  const turns = [];
  for (const file of files) {
    const sessionId = file.replace(/\.jsonl$/, "");
    if (session && sessionId !== session) continue;
    for (const entry of readJsonl(join(TRACE_DIR, file))) {
      if (!entry?.llmResponse) continue;
      if (since && (entry.timestamp ?? 0) < since) continue;
      turns.push(entry);
    }
  }
  return turns;
}

function binFor(turnCount) {
  return (
    RUN_LENGTH_BINS.find((b) => turnCount >= b.min && turnCount <= b.max)
      ?.label ?? "unknown"
  );
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  const index = Math.min(
    sortedValues.length - 1,
    Math.floor((p / 100) * sortedValues.length),
  );
  return sortedValues[index];
}

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 10000) / 100;
}

/**
 * Group digits with a fixed separator.
 *
 * NOT `toLocaleString()` — on a de-DE host that renders 722176 as "722.176",
 * which reads as a decimal and made the first draft of this report look like it
 * was counting fractional tokens.
 */
function num(value) {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function emptyGroup(key) {
  return {
    ...key,
    runs: new Set(),
    coldTurns: 0,
    warmTurns: 0,
    /** Warm turns carrying §9 prefix telemetry (post-#104 traces only). */
    instrumentedWarmTurns: 0,
    promptTokens: 0,
    cachedTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    costUsdIfNoCache: 0,
    pricedTurns: 0,
    pricingRowFound: false,
    cachedRateKnown: false,
    cachedTokenSamples: [],
    hitPctSamples: [],
    stablePrefixPctSamples: [],
    divergenceOffsetSamples: [],
    regionCounts: { tools: 0, system: 0, history: 0, volatile_tail: 0, none: 0 },
    resets: 0,
    resetCauses: {},
    unexplainedDivergences: 0,
    zeroHitDespiteStablePrefix: 0,
    outcomes: {},
  };
}

/**
 * Aggregate turns into non-mixed populations.
 *
 * Grouping key is (tier, provider, model, run-length bin). The RFC's "never mix
 * across populations" rule exists because seats and run lengths have genuinely
 * different cache behaviour — pooling them produces a number that describes no
 * real workload.
 */
function aggregate(turns, sessions) {
  const groups = new Map();
  const turnCountBySession = new Map();
  for (const turn of turns) {
    turnCountBySession.set(
      turn.sessionId,
      Math.max(turnCountBySession.get(turn.sessionId) ?? 0, turn.turnNumber ?? 0),
    );
  }

  for (const turn of turns) {
    const usage = turn.llmResponse?.usage;
    if (!usage) continue;

    const provider = turn.llmResponse.actualProviderId ?? "unknown";
    const model = turn.llmResponse.actualModel ?? turn.llmRequest?.model ?? "unknown";
    const tier = turn.llmRequest?.modelTier ?? "executor";
    const bin = binFor(turnCountBySession.get(turn.sessionId) ?? 0);
    // The template IS the cached prefix, so a prompt change makes two runs
    // incomparable. Hash, not just version — an edit that skips a version bump
    // still moves every byte after it. "unknown" = pre-#105 traces.
    const template = turn.llmRequest?.contextMetrics?.promptTemplate;
    const promptId = template
      ? `${template.version}@${String(template.hash).slice(0, 8)}`
      : "unknown";
    const keyString = `${tier}|${provider}|${model}|${bin}|${promptId}`;

    if (!groups.has(keyString)) {
      groups.set(
        keyString,
        emptyGroup({ tier, provider, model, runLengthBin: bin, prompt: promptId }),
      );
    }
    const group = groups.get(keyString);
    group.runs.add(turn.sessionId);

    const outcome = sessions.get(turn.sessionId)?.outcome ?? "unknown";
    group.outcomes[outcome] = (group.outcomes[outcome] ?? 0) + 1;

    // Turn 1 cannot hit cache — counting it as a miss depresses every rate.
    const isWarm = (turn.turnNumber ?? 1) > 1;
    if (!isWarm) {
      group.coldTurns++;
      continue;
    }
    group.warmTurns++;

    const promptTokens = usage.prompt_tokens ?? 0;
    const cachedTokens = Math.min(usage.cached_tokens ?? 0, promptTokens);
    group.promptTokens += promptTokens;
    group.cachedTokens += cachedTokens;
    group.completionTokens += usage.completion_tokens ?? 0;
    group.cachedTokenSamples.push(cachedTokens);
    if (promptTokens > 0) group.hitPctSamples.push(pct(cachedTokens, promptTokens));

    // Cost from the real pricing table, plus the counterfactual with no cache,
    // because "percentage points" are not money and the RFC says so.
    // A seat with no `cachedInputUsdPerMillion` bills cached tokens at the full
    // input rate, so its savings are genuinely $0 no matter how well it caches.
    // Without flagging that, "21% hit, saved $0" reads as a bug in this script.
    const pricing = findModelPricing(provider, model);
    if (pricing) {
      group.pricingRowFound = true;
      group.cachedRateKnown =
        typeof pricing.cachedInputUsdPerMillion === "number";
    }

    const breakdown = estimateCostBreakdownUsd(provider, model, usage);
    if (breakdown) {
      group.pricedTurns++;
      group.costUsd += breakdown.totalCostUsd;
      const noCache = estimateCostBreakdownUsd(provider, model, {
        ...usage,
        cached_tokens: 0,
      });
      if (noCache) group.costUsdIfNoCache += noCache.totalCostUsd;
    }

    const prefix = turn.llmRequest?.contextMetrics?.promptPrefix;
    if (!prefix) continue;
    group.instrumentedWarmTurns++;

    const region = prefix.firstDivergenceRegion ?? "none";
    if (region in group.regionCounts) group.regionCounts[region]++;
    group.stablePrefixPctSamples.push(prefix.stablePrefixPct ?? 0);
    if (typeof prefix.firstDivergenceOffset === "number") {
      group.divergenceOffsetSamples.push(prefix.firstDivergenceOffset);
    }

    if (prefix.prefixReset) {
      group.resets++;
      const cause = prefix.prefixReset.cause ?? "unknown";
      group.resetCauses[cause] = (group.resetCauses[cause] ?? 0) + 1;
    } else if (region === "system" || region === "history") {
      // The defect: prefix broke with no compaction to blame.
      group.unexplainedDivergences++;
    }

    // RFC open question 1 — a long shared prefix that cached nothing anyway.
    // If this is common it caps the achievable rate regardless of layout.
    if (cachedTokens === 0 && (prefix.stablePrefixPct ?? 0) > 50) {
      group.zeroHitDespiteStablePrefix++;
    }
  }

  return [...groups.values()].map(finalizeGroup);
}

function finalizeGroup(group) {
  const cachedSorted = [...group.cachedTokenSamples].sort((a, b) => a - b);
  const stableSorted = [...group.stablePrefixPctSamples].sort((a, b) => a - b);
  const offsetSorted = [...group.divergenceOffsetSamples].sort((a, b) => a - b);
  const instrumented = group.instrumentedWarmTurns;

  return {
    tier: group.tier,
    provider: group.provider,
    model: group.model,
    runLengthBin: group.runLengthBin,
    prompt: group.prompt,
    runs: group.runs.size,
    coldTurns: group.coldTurns,
    warmTurns: group.warmTurns,
    instrumentedWarmTurns: instrumented,
    /** Share of warm turns carrying §9 telemetry. <100% means mixed vintages. */
    instrumentationCoveragePct: pct(instrumented, group.warmTurns),

    // Realized hit — token-weighted, the only rate that maps to money.
    realizedHitPct: pct(group.cachedTokens, group.promptTokens),
    promptTokens: group.promptTokens,
    cachedTokens: group.cachedTokens,
    cachedTokensP50: percentile(cachedSorted, 50),
    cachedTokensP90: percentile(cachedSorted, 90),

    costUsd: Math.round(group.costUsd * 10000) / 10000,
    costUsdIfNoCache: Math.round(group.costUsdIfNoCache * 10000) / 10000,
    /**
     * The only cost figure comparable across populations. Absolute cost tracks
     * population SIZE, so an A/B between a 205-turn baseline and a 44-turn arm
     * shows a large "saving" that is purely fewer turns.
     */
    costPerWarmTurnUsd:
      group.warmTurns > 0
        ? Math.round((group.costUsd / group.warmTurns) * 1000000) / 1000000
        : 0,
    cacheSavingsUsd:
      Math.round((group.costUsdIfNoCache - group.costUsd) * 10000) / 10000,
    pricedTurns: group.pricedTurns,
    /** False when some turns had no pricing row — cost is then a lower bound. */
    costComplete: group.pricedTurns === group.warmTurns,
    pricingRowFound: group.pricingRowFound,
    /** False → this seat bills cached tokens at full rate; savings really are $0. */
    cachedRateKnown: group.cachedRateKnown,

    // Prefix stability. Char-based by construction; converted where compared.
    stablePrefixPctP50: percentile(stableSorted, 50),
    firstDivergenceOffsetP50: percentile(offsetSorted, 50),
    firstDivergenceTokenOffsetP50_est:
      percentile(offsetSorted, 50) == null
        ? null
        : Math.round(percentile(offsetSorted, 50) / CHARS_PER_TOKEN),
    divergenceRegions: group.regionCounts,

    // The acceptance criterion.
    prefixResets: group.resets,
    prefixResetCauses: group.resetCauses,
    unexplainedDivergences: group.unexplainedDivergences,
    unexplainedDivergencePct: pct(group.unexplainedDivergences, instrumented),

    zeroHitDespiteStablePrefix: group.zeroHitDespiteStablePrefix,
    zeroHitDespiteStablePrefixPct: pct(group.zeroHitDespiteStablePrefix, instrumented),

    outcomes: group.outcomes,
    taskSuccessPct: pct(
      group.outcomes.completed ?? 0,
      Object.values(group.outcomes).reduce((a, b) => a + b, 0),
    ),

    verdictEligible: group.warmTurns >= MIN_WARM_TURNS_FOR_VERDICT,
  };
}

function formatGroup(group) {
  const lines = [];
  lines.push(
    `\n── ${group.tier} · ${group.model} @ ${group.provider} · run length ${group.runLengthBin} · prompt ${group.prompt}`,
  );
  lines.push(
    `   ${group.runs} run(s), ${group.warmTurns} warm turn(s) (+${group.coldTurns} cold, excluded)`,
  );

  if (group.instrumentationCoveragePct < 100) {
    lines.push(
      `   ⚠ prefix telemetry on ${group.instrumentationCoveragePct}% of warm turns ` +
        `(${group.instrumentedWarmTurns}/${group.warmTurns}) — pre-#104 traces in this population`,
    );
  }

  lines.push(
    `   realized hit   ${group.realizedHitPct}%  ` +
      `(${num(group.cachedTokens)} / ${num(group.promptTokens)} tokens, ` +
      `p50 ${group.cachedTokensP50 ?? "—"} p90 ${group.cachedTokensP90 ?? "—"} cached/turn)`,
  );
  lines.push(
    `   cost           $${group.costUsd} vs $${group.costUsdIfNoCache} uncached ` +
      `→ saved $${group.cacheSavingsUsd}${group.costComplete ? "" : "  (partial: some turns unpriced)"}`,
  );
  if (!group.pricingRowFound) {
    lines.push(
      `   ⚠ no pricing row for this seat — cost figures are meaningless here`,
    );
  } else if (!group.cachedRateKnown) {
    lines.push(
      `   ⚠ no cached-input rate for this seat — cached tokens bill at FULL rate, ` +
        `so $0 saved is real, not a reporting gap`,
    );
  }

  if (group.instrumentedWarmTurns > 0) {
    const r = group.divergenceRegions;
    lines.push(
      `   diverges in    tools ${r.tools ?? 0} · system ${r.system} · history ${r.history} · ` +
        `volatile_tail ${r.volatile_tail} · none ${r.none}`,
    );
    lines.push(
      `   stable prefix  p50 ${group.stablePrefixPctP50}% of chars; ` +
        `first divergence p50 @ ${group.firstDivergenceOffsetP50 ?? "—"} chars ` +
        `(~${group.firstDivergenceTokenOffsetP50_est ?? "—"} tokens)`,
    );
    const causes = Object.entries(group.prefixResetCauses)
      .map(([cause, n]) => `${cause}×${n}`)
      .join(", ");
    lines.push(
      `   prefix resets  ${group.prefixResets}${causes ? ` (${causes})` : ""}`,
    );
    lines.push(
      `   UNEXPLAINED    ${group.unexplainedDivergences} turn(s) = ` +
        `${group.unexplainedDivergencePct}% ← the #103 defect`,
    );
    if (group.zeroHitDespiteStablePrefix > 0) {
      lines.push(
        `   0% despite prefix  ${group.zeroHitDespiteStablePrefix} turn(s) = ` +
          `${group.zeroHitDespiteStablePrefixPct}%  ← RFC open question 1`,
      );
    }
  } else {
    lines.push(
      `   (no §9 prefix telemetry — traces predate #104; cache cause not measurable)`,
    );
  }

  const outcomes = Object.entries(group.outcomes)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  lines.push(`   task outcomes  ${outcomes} → ${group.taskSuccessPct}% completed`);

  if (!group.verdictEligible) {
    lines.push(
      `   ⚠ ${group.warmTurns} warm turns < ${MIN_WARM_TURNS_FOR_VERDICT} — too few to support a verdict`,
    );
  }
  return lines.join("\n");
}

/** A/B two report files. Cache AND success, because the RFC requires both. */
function formatComparison(baseline, current) {
  const byKey = (report) => {
    const map = new Map();
    for (const g of report.groups) {
      map.set(`${g.tier}|${g.provider}|${g.model}|${g.runLengthBin}|${g.prompt}`, g);
    }
    return map;
  };
  const before = byKey(baseline);
  const lines = ["\n═══ A/B vs baseline ═══"];

  for (const group of current.groups) {
    const key = `${group.tier}|${group.provider}|${group.model}|${group.runLengthBin}|${group.prompt}`;
    const prev = before.get(key);
    if (!prev) {
      // Most often this means the prompt template changed between the two runs.
      // Refusing to compare is the point: the A/B would measure the edit.
      lines.push(
        `\n── ${key}\n   (no matching baseline population — not compared. ` +
          `If only the prompt segment differs, the template changed and the A/B is invalid.)`,
      );
      continue;
    }
    const delta = (a, b) => {
      const d = Math.round((a - b) * 100) / 100;
      return d > 0 ? `+${d}` : `${d}`;
    };
    lines.push(`\n── ${key}`);
    lines.push(
      `   realized hit   ${prev.realizedHitPct}% → ${group.realizedHitPct}%  (${delta(group.realizedHitPct, prev.realizedHitPct)}pp)`,
    );
    // Per-turn, not absolute: the two arms rarely have the same turn count, and
    // an absolute delta then reports the size difference as a saving.
    const perTurn = (g) => `$${g.costPerWarmTurnUsd.toFixed(6)}`;
    const perTurnDeltaPct = pct(
      group.costPerWarmTurnUsd - prev.costPerWarmTurnUsd,
      prev.costPerWarmTurnUsd,
    );
    lines.push(
      `   cost/warm turn ${perTurn(prev)} → ${perTurn(group)}  (${perTurnDeltaPct > 0 ? "+" : ""}${perTurnDeltaPct}%)` +
        `   [totals $${prev.costUsd} vs $${group.costUsd} over ${prev.warmTurns} vs ${group.warmTurns} turns — NOT comparable]`,
    );
    lines.push(
      `   UNEXPLAINED    ${prev.unexplainedDivergencePct}% → ${group.unexplainedDivergencePct}%  (${delta(group.unexplainedDivergencePct, prev.unexplainedDivergencePct)}pp)`,
    );
    lines.push(
      `   task success   ${prev.taskSuccessPct}% → ${group.taskSuccessPct}%  (${delta(group.taskSuccessPct, prev.taskSuccessPct)}pp)`,
    );
    if (group.taskSuccessPct < prev.taskSuccessPct) {
      lines.push(
        `   ⚠ task success FELL. Per the RFC, a cache win that costs success is not a win.`,
      );
    }
    if (!group.verdictEligible || !prev.verdictEligible) {
      lines.push(`   ⚠ one side is under the minimum warm-turn count — not decisive`);
    }
  }
  return lines.join("\n");
}

function formatVerdict(report) {
  const eligible = report.groups.filter((g) => g.verdictEligible);
  const lines = ["\n═══ Verdict ═══"];

  if (eligible.length === 0) {
    lines.push(
      `No population has ${MIN_WARM_TURNS_FOR_VERDICT}+ warm turns. Collect more runs before concluding anything.`,
    );
    return lines.join("\n");
  }

  const instrumented = eligible.filter((g) => g.instrumentedWarmTurns > 0);
  if (instrumented.length === 0) {
    lines.push(
      "No population carries §9 prefix telemetry. Cache RATE is measurable; the CAUSE is not.",
    );
    lines.push("Rebuild against #104 and re-run before drawing conclusions about #103.");
    return lines.join("\n");
  }

  const totalInstrumented = instrumented.reduce(
    (sum, g) => sum + g.instrumentedWarmTurns,
    0,
  );
  const totalUnexplained = instrumented.reduce(
    (sum, g) => sum + g.unexplainedDivergences,
    0,
  );
  const totalZeroHit = instrumented.reduce(
    (sum, g) => sum + g.zeroHitDespiteStablePrefix,
    0,
  );
  const unexplainedPct = pct(totalUnexplained, totalInstrumented);

  lines.push(
    `Unexplained prefix divergence: ${totalUnexplained}/${totalInstrumented} warm turns (${unexplainedPct}%).`,
  );
  if (unexplainedPct > 20) {
    lines.push(
      "→ #103 REPRODUCED. History is being rewritten on turns with no compaction to justify it.",
    );
  } else if (unexplainedPct > 0) {
    lines.push(
      "→ Partial. Some prefix breaks remain unexplained; inspect the region split per population.",
    );
  } else {
    lines.push(
      "→ Clean. Every prefix break is attributable to a deliberate compaction reset.",
    );
  }

  const zeroPct = pct(totalZeroHit, totalInstrumented);
  lines.push(
    `Zero-hit-despite-stable-prefix: ${totalZeroHit}/${totalInstrumented} (${zeroPct}%) — RFC open question 1.`,
  );
  if (zeroPct > 10) {
    lines.push(
      "→ Material. This caps the achievable rate regardless of prompt layout; investigate before more layout work.",
    );
  }

  lines.push(
    "\nNote: percentages are not savings. Compare the USD lines, and never across populations.",
  );
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      [
        "Usage: pnpm run cache:report -- [options]",
        "",
        "  --since <ISO|7d|36h>   only turns at or after this time",
        "  --session <id>         restrict to one session",
        "  --json                 print machine-readable JSON",
        "  --out <path>           write the JSON report to a file",
        "  --baseline <path>      A/B this report against a saved one",
        "  --min-turns <n>        warm turns needed for a verdict (default 20)",
      ].join("\n"),
    );
    return;
  }

  const since = resolveSince(args.since);
  const sessions = loadSessionOutcomes();
  const turns = loadTurns({ since, session: args.session });

  if (turns.length === 0) {
    console.error(
      "No turns matched. Check traces/ is populated and --since/--session are not over-filtering.",
    );
    process.exitCode = 1;
    return;
  }

  const groups = aggregate(turns, sessions).sort(
    (a, b) => b.warmTurns - a.warmTurns,
  );
  const report = {
    generatedAtMs: Date.now(),
    filters: { since: args.since ?? null, session: args.session ?? null },
    totals: {
      turns: turns.length,
      sessions: new Set(turns.map((t) => t.sessionId)).size,
      populations: groups.length,
    },
    groups,
  };

  if (args.out) {
    mkdirSync(dirname(resolve(args.out)), { recursive: true });
    writeFileSync(resolve(args.out), JSON.stringify(report, null, 2));
  }

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(
    `Prompt-cache report — ${report.totals.turns} turns, ${report.totals.sessions} session(s), ${report.totals.populations} population(s)`,
  );
  for (const group of groups) console.log(formatGroup(group));
  console.log(formatVerdict(report));

  if (args.baseline) {
    const baseline = JSON.parse(readFileSync(resolve(args.baseline), "utf8"));
    console.log(formatComparison(baseline, report));
  }
  if (args.out) console.log(`\nWrote ${args.out}`);
}

main();
