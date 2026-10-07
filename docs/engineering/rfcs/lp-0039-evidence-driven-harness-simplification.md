# LP-39 — Evidence-driven harness simplification

Status: Decision stamped; baseline environment and cumulative $20 pilot approved.

Date: 2026-10-05

## Goal

Determine which OpenSidebar runtime interventions improve real browser-task
outcomes, then remove or simplify interventions that do not earn their complexity.
Use the existing ModelBench production-extension driver. Compare model choices
separately from harness choices so model improvements cannot be mistaken for
harness improvements.

Success requires a reproducible baseline, a recorded keep/remove/inconclusive
decision for every tested intervention, and at least one independently verified
behavioral simplification. A small pilot can identify candidates; it cannot prove
that the system can perform arbitrary internet tasks. An inconclusive experiment
retains the baseline and states what evidence is still needed.

## Current evidence

The runtime has one completion authority, not competing independent pipelines.
Its internal checks and recovery policies are candidates for measurement, not
presumed redundant. File extraction alone does not count as behavioral simplification.

On 2026-10-05, local non-model checks passed:

- Catalog: 100 headline cases, MB-101, 50 role probes, 120 migration entries.
- Full oracle: 100 gold paths passed, 300 near misses rejected, 892 assertions.
- Target-quality audit: 100/100 cases passed all executable checks.

These validate the evaluator's declared scenarios, not model performance or
browser-driver readiness. LP-36's blinded target review and full baseline
acceptance remain required before headline claims or legacy cutover.

The current worktree contains verified but uncommitted routing changes. A Git
revision alone therefore cannot identify the baseline. The local source snapshot,
file hashes, and preflight evidence are under
`.artifacts/harness-simplification/2026-10-05/`; they exclude credentials and are
not repository deliverables.

## Experiment environment

Use the existing local target service, scenario engine, browser harness, and
`modelbench-extension-driver.ts`. Do not introduce another agent runtime or
replace deterministic validators with an experimental model judge.

Each campaign needs an immutable manifest identifying:

- Source revision plus dirty-source content digest, actual extension and target
  build hashes, lockfile, browser version, and toolchain versions.
- Case/validator versions, seeds, prompts, model seats, provider preferences,
  resolved models/providers, routing policy, perception mode, page-state mode,
  turn/token/time limits, and authorized spending cap.
- One baseline configuration and one candidate configuration per comparison;
  exact intervention, execution order, repetitions, and frozen evaluation cases.
- Attempts, errors, cancellation, usage by seat, prices, and artifact references.

Use isolated temporary Chrome profiles with synthetic accounts and a freshly
seeded local target for every attempt. No personal browser profiles, production
accounts, production cloud writes, or live consequential actions. Freeze the
built artifacts throughout a comparison; separate output directories prevent a
candidate build from overwriting a baseline build. Credentials stay outside the
manifest and source archive.

The runner currently groups configurations and records Git HEAD. It does not
have a campaign spending ceiling. A campaign must add actual source/build
provenance and balanced paired execution before its results are used for a
removal decision. Alternate baseline/candidate order by case and repetition;
keep the case's initial state and execution limits identical.

A time/turn limit is not a dollar limit. Reserve a conservative maximum request
cost before dispatch, charge retries and judge calls to the same ledger, and
reconcile with returned usage. Missing price/usage evidence prevents additional
paid dispatch until accounted for. One request at a time simplifies the pilot's
accounting. If a provider-enforced dedicated key limit is available, use it as
an additional bound, not as a substitute for request accounting.

## Models and causal separation

The recommended first comparison keeps the existing executor and planner fixed
and compares GPT-OSS-120B, `openai/gpt-6-luna`, and `typesafe/jev-1.13` on identical
text evidence and independently labeled judge cases. Include completed,
incomplete, contradicted, unsupported, adversarial, and ambiguous outcomes.
Split development cases from held-out cases before prompt or threshold tuning.

Jev needs a typed decision adapter; a model-ID substitution in Chat Completions
is insufficient. Map criteria and entailment labels explicitly, validate every
required answer, and preserve timeout/cancellation and human escalation. Do not
fabricate rationales or treat Jev probabilities as interchangeable with the
current judge's self-reported confidence. Calibrate decision/abstention thresholds
on development data, then freeze them before held-out evaluation.

After the judge comparison, evaluate Luna execution with the harness unchanged.
Then freeze the selected model stack for every harness ablation. A Jev-to-Luna
cascade is a later, separately measured candidate if the single-model results
justify it, not an assumed winner.

Retain the current strict OpenRouter planner gate. Testing Luna as planner is a
separate owner choice and requires compatibility checks; never silently relax
routing limits to admit a benchmark model. Preserve LP-38 shadow mode unless
LP-38's own adoption gate is satisfied. Changing page-state mode and removing a
behavioral rule in the same comparison confounds the experiment.

## Candidate interventions and protected behavior

Start by observing how often a rule is reached, what it decides, what action or
model request it adds, and whether the independently validated outcome changes.
A rule never reached in the evaluation is unmeasured, not proven unnecessary.

Candidates for investigation are planner revalidation at completion, heuristic
step-count/sequence requirements, overlapping semantic checks, and recovery
strategies that override the executor. Choose the first candidate from trace
frequency and outcome disagreements, not source-line count alone.

Use the existing runtime policy/controller seams and completion authority. An
experimental omission is a controlled build/configuration of product policy,
not task-specific behavior in a fixture. Bound controls to the internal experiment
build, default to current behavior, and record the selected variant in receipts.
Counterfactual observations do not cause tools to execute or become a second
completion authority. Remove temporary controls after a retained simplification
is accepted or an experiment is closed.

Never ablate authorization, site access, approval requirements, cancellation,
duplicate-effect prevention, browser-state freshness, durability, direct evidence
requirements, deterministic final-state validation, or user-visible uncertainty.
Do not inject case IDs, expected values, hidden validators, or fixture selectors
into runtime decisions.

## Measurement and acceptance

Report first-attempt task success and coverage separately. Provider, harness,
validator, and indeterminate failures remain visible; retries never replace the
first-attempt score. Pair comparisons by case/version/seed/repetition. Report
unmatched attempts and missing seat usage rather than silently dropping them.

For each candidate report:

- False completion, false rejection, unintended mutations, approval/cancellation
  violations, and model-versus-deterministic-validator disagreements.
- Success by workflow family and difficulty, plus paired case outcomes.
- Turns, tool calls, recovery/replanning counts, median and p95 duration, total
  spend including failures, and cost per successful task.
- Rules actually exercised, intervention counts, saved model calls, and removed
  behavioral branches. Moving the same logic between files is not a saving.

Use `core-20` for a cost-bounded pilot. Expand promising candidates to repeated
`standard-50` and then `full-100` confirmation with at least three repetitions
per configuration if the separately authorized budget permits. Freeze selection
before candidate tuning; retain an untouched confirmation set. Add a held-out
workflow from another app/domain before making transferability claims.

The recommended retention gate is:

- At least 98% valid coverage per configuration and no unexplained model mismatch.
- No confirmed new false completion, unintended consequential effect, permission
  bypass, cancellation regression, or stale-action execution.
- No observed aggregate or workflow-family first-attempt success regression;
  review every paired disagreement and disclose uncertainty from finite samples.
- A real reduction in runtime behavioral complexity, with latency/turn/cost
  effects reported even when they do not improve. Do not claim an efficiency win
  based on runtime alone if success or safety worsens.
- Focused regression tests, existing completion-corpus review for intentional
  semantic changes, full repository verification, and appropriate real-browser
  acceptance. A passing unit suite is insufficient for a behavioral removal.

A pilot below these confirmation gates can support a next experiment, not a
production default change. No deployment or deletion of the legacy evaluator is
included. LP-36 and LP-38 retain their independent acceptance boundaries.

## Owner decision — 2026-10-05

The owner approved LP-39 with the recommended $10 pilot cap in this thread,
then explicitly instructed: "approved run". The first milestone is baseline-first
setup with separate judge and Luna-executor comparisons. The current planner
routing gate and LP-38 shadow default remain unchanged. The $10 ceiling covers
all paid calls in this pilot, including probes, retries, and failed requests.
Freeze the experiment manifest and judge development/held-out split before the
first paid comparison. Broader confirmation runs require available authorized
budget; the pilot does not authorize a default change without the evidence gates.

## Current milestone — trace-backed harness repairs

The owner requested continued issue repair and testing on 2026-10-05. The
immediate goal is trustworthy completion: preserve real browser state, retain
criterion identity and requirement-sensitive judge caching, carry missing evidence
into recovery, and require the evaluator to verify the actual user objective.

Complete this milestone with focused regressions, full repository verification,
a paid judge-contract regression, and an isolated production-extension run of the
corrected CRM note case, all within the existing cumulative $10 cap. Treat the
case-version change as a new evaluation, not a paired improvement score. Keep
failures and costs from intermediate candidates. Audit other synthetic success
markers before using their scores to justify removing runtime safeguards.

The CRM trace revealed that its earlier validator pass checked only `note-added`,
not note text or internal visibility. That pass does not establish task success
or prove the judge was over-strict. Preserve the evidence check while correcting
the target and validator. Broader harness simplification remains gated on valid
paired evidence; this repair milestone does not authorize a model-default change.


### Repair milestone acceptance — 2026-10-05

The local repair milestone is verified. With Luna execution, the existing strict
DeepSeek planner route, and LP-38 shadow mode, the corrected CRM note case and an
independent project-update app each completed in three executor turns with one
write, correct saved text and visibility, and no completion rejection or bypass.
The generic app also retained the update after a page reload and left project
status unchanged. Raw traces, application state, and resolved model usage were
checked independently of terminal narration and display-only turn summaries.

Repairs ground initial planning in the current page, accept complete quoted
summaries, defer click-result evidence until a fresh observation, and retain the
submitted form's context when its editor disappears. Saved-form readback checks
requested values and record identity, including visible structural evidence
omitted by article extraction. Attempts without executor telemetry are classified
as indeterminate even when a completion event is present.

`pnpm run verify` passed with 5,598 extension tests and 56 script tests. Cumulative
pilot spending is $0.2290819116 of the $10 cap, with no unsettled requests. Frozen
builds and source are in `.artifacts/harness-simplification/2026-10-05/form-context-acceptance/`;
the generic run is in `generic-form-context/`, and the audited report is in
`milestone-report/report.json` under the same artifact root.

This completes the requested stopping milestone, not the broader LP-39
simplification campaign. The two workflows were used during development and do
not establish broad coverage or a paired intervention-removal result. No model
default changes follow from these results. Remaining follow-ups are evaluator
objective fidelity (#192), a wall-clock-sensitive overlay test (#195), and root
completion turn-count propagation (#196). The original retail workflow in #191
still needs its own faithful evaluator and regression run.

## Owner update — 2026-10-06

The owner explicitly requested `openai/gpt-6.1-sol` as the planner to help
separate planner limitations from harness failures. Run this as a diagnostic
pilot with Luna execution and Jev judging held fixed. Use high reasoning,
standard provider routes, observed model identity, and the existing cumulative
$10 cap. This supersedes the earlier restriction on selecting a different
planner for this pilot only; it does not change the general planner default.
A stronger planner is not an oracle: attribute failures from traces and actual
outcomes. Keep the previous DeepSeek evidence as a separate baseline.

## Owner budget update — 2026-10-06

The owner approved the proposed cumulative cap increase from $10 to $20 and
requested the clean 100-case baseline: “ok approved. run the 100 cases”. Run
each case once with Sol planning, Luna execution, and Jev judging. Preserve the
interrupted first run separately, including all actual charges and held maximum
charges. This supersedes the earlier $10 ceiling; all other scope boundaries
remain in force.

## Decision

Status: Approved

Chosen path:

- Reuse ModelBench for baseline-first, paired model comparisons and single-intervention harness experiments, with a cumulative $20 paid pilot cap.
- Compare GPT-OSS-120B, GPT-6 Luna, and Jev judges first; evaluate Luna execution separately; hold models fixed during harness comparisons.
- Preserve the protected runtime guarantees and independent deterministic evaluator.
- Run the owner-selected `openai/gpt-6.1-sol` planner diagnostic with high reasoning, Luna executor and Jev judge. Allow bounded standard routes for this explicitly selected model without speed-metric eligibility; retain the existing strict policy for other planners.

Required edits before implementation:

- None.

Non-blocking follow-ups:

- Consider a separately evaluated Jev/Luna cascade after single-judge results.

Do not do:

- Exceed $20 across pilot calls, probes, retries, or failed requests.
- Deploy, remove the legacy evaluator, change general planner defaults, or change LP-38 defaults as part of this campaign.
- Broaden the Sol route exception to other models or bypass the cumulative budget ledger. Bound its provider prices to input ≤$5/M and output ≤$15/M, including long-context/cache-write input reservations.
- Treat absent rule activations, successful model narration, or an unverified model override as evidence of success.

Evidence required before merge:

- Freeze source/build identity, judge evaluation split, model settings, and the experiment manifest before paid comparisons.
- Reproducible balanced paired results, bounded spending, and reviewed failure classifications.
- Confirmation and safety gates above, plus full verification and real-browser acceptance for any retained runtime simplification.

Next action:

- Implement
