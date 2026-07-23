# LP-21 observation window — run protocol

Step 2 of the plan on [#103](https://github.com/krisshkodrani/OpenSidebar/issues/103).
This run produces the baseline that the step-3 A/B is measured against, and is
the best shot at RFC LP-21 open question 1. Getting it wrong is expensive twice:
once in API budget, once because step 3 then has nothing to compare to.

## What this run has to answer

1. **Is #103 reproducible with direct measurement?** The issue inferred prefix
   breaks from turn-to-turn input-token deltas across 13 turns in one trace.
   With #104 merged, divergence is recorded directly. Expected signal: a
   material share of warm turns diverging in `system` or `history` while
   carrying no `prefixReset`.
2. **RFC open question 1 — do some turns return 0% despite a long shared
   prefix?** If a fifth of turns randomly cache nothing, that caps the
   achievable rate regardless of layout, and step 3 is worth less than it looks.
   The report counts these as `zeroHitDespiteStablePrefix`.
3. **What is the honest baseline?** Realized token-weighted hit, absolute cached
   tokens, and USD per seat and run-length bin — plus task success, so step 3's
   A/B can show it did not trade success for cache.

## Before launching

```
pnpm run cache:preflight
```

Must print **Ready to run**. It blocks on the failure mode that has already
happened once: `dist-dev` predating #104, which records every turn without
prefix metrics and is only discovered after the spend.

The remaining warning is not automatable and must be confirmed by hand:

- **Freeze the prompt template.** Prompt version is not recorded per turn, so
  the report cannot separate populations by it. If the template changes between
  this baseline and the step-3 A/B, the two populations are not comparable and
  the A/B proves nothing. This is also why RFC open question 2 (real seat
  differences) is still open.

Two more, from prior incidents:

- **Run from the main checkout, not a worktree.** A log server already holding
  port 7589 from another checkout silently writes traces into *that* repo. A
  baseline run in the worktree reproduces the symptom, so it reads as a
  pre-existing failure on main. The preflight probes the port but cannot tell
  whose it is.
- **Check process names before killing a port holder.** A Docker backend was
  killed by mistake this way once.

## Launching

Live agent runs need the owner's approval — do not launch autonomously.

Note the wall-clock start time; everything after is filtered on it.

```
pnpm run test:e2e:easy      # then :medium, then :hard
```

Staged order matters: `easy` before `medium` before `hard`, unless scoped to one
failing test.

### Sample size

The report refuses a verdict below **20 warm turns** in a population, and
populations are split by (tier, provider, model, run-length bin) — so a handful
of short runs spreads thin across bins and decides nothing. Prefer enough runs
that at least the executor seat clears the threshold in more than one bin.
Long runs are especially valuable: the `50+` bin is where compaction actually
fires, and compaction is the mechanism under investigation.

## Reporting

Filter to this run only. The repo already holds 2,000+ prior session files, all
predating #104.

```
pnpm run cache:report -- --since <ISO start time> \
  --out .artifacts/cache/baseline-<date>.json
```

Keep the JSON. It is the `--baseline` input for step 3:

```
pnpm run cache:report -- --since <A/B start> --baseline .artifacts/cache/baseline-<date>.json
```

### Reading the output

- **`instrumentationCoveragePct` below 100** means pre-#104 traces leaked into
  the window. Tighten `--since`; do not interpret the numbers until it is 100.
- **`UNEXPLAINED`** is the headline. It is warm turns that diverged in `system`
  or `history` with no compaction to blame — the #103 defect, stated directly
  rather than inferred.
- **`prefix resets`** should account for the rest. The step-3 acceptance
  criterion is exactly one reset per compaction boundary and ~0 unexplained
  divergences between them.
- **Percentages are not savings.** Compare the USD lines. A seat with no
  `cachedInputUsdPerMillion` bills cached tokens at full rate, so its `$0 saved`
  is real, not a reporting gap — the report flags that case.
- **Never compare across populations.** Different seats and run lengths have
  genuinely different cache behaviour; pooling them describes no real workload.

## After the run

- Record the answer to open question 1 on #103. If zero-hit-despite-prefix is
  material, say so before more layout work is planned on top of it.
- Keep #103 open. It closes at step 4, after the fix is measured — not when the
  measurement lands.
