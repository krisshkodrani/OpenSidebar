# ModelBench perception benchmark

ModelBench perception isolates screenshot production from visual-model quality
and from the rest of browser-agent execution. It reuses the ten canonical
ModelBench cases whose primary role is `perception`; it does not introduce a
second scenario platform or agent runtime.

## What is measured

Each result has three lanes:

1. **Full extension** — the production extension executes the natural task on
   the deterministic local target.
2. **Capture integrity** — the benchmark audits the exact screenshot artifact
   recorded by that extension run: target URL, canvas presence, decoding,
   SHA-256, production resolution bounds, capture status, attachment count,
   and requested image detail.
3. **Direct model** — the configured executor model receives those exact image
   bytes with only the original user question. A deterministic answer matcher,
   not an LLM judge, scores the response.

The local target renders the decisive perception evidence into canvas pixels.
The answer is intentionally absent from the ordinary DOM and accessibility
text. Scenario control data remains server-side and is used only by the
deterministic validator.

The report classifies each result as one of:

- `capture_failure` — the target or screenshot artifact was missing, corrupt,
  unverifiable, or outside the production image profile.
- `delivery_failure` — an image was not attached to the executor, its hash did
  not match the artifact used by the direct lane, or the extension harness
  failed before a valid image-backed result.
- `model_perception_failure` — capture and delivery passed, but the direct
  model could not extract the expected visible fact.
- `grounding_action_failure` — the direct model passed on the same image while
  the full extension failed the task.
- `provider_failure`, `validator_disagreement`, `indeterminate`, or
  `valid_pass` as applicable.

## Running it

Run all ten perception cases through the production extension and direct lane:

```sh
pnpm modelbench:perception -- \
  --matrix scripts/modelbench-101.matrix.json \
  --driver scripts/modelbench-extension-driver.ts \
  --output .artifacts/modelbench/perception
```

Use `--case <case-id>` for one case and `--repeat <n>` for repeated trials. The
matrix must configure an executor seat. Direct calls currently support the
same OpenAI-compatible OpenRouter and Fireworks paths as ModelBench and read
`OPENROUTER_API_KEY` or `FIREWORKS_API_KEY` respectively.
For model comparisons, change the executor seat only and keep the target,
perception mode, planner, and judge configuration fixed.

An existing integrated attempt file can be audited without rerunning Chrome:

```sh
pnpm modelbench:perception -- \
  --attempts .artifacts/modelbench/run/attempts.json \
  --output .artifacts/modelbench/perception
```

Use `--skip-direct` when only capture and integrated diagnostics are wanted.
That mode deliberately reports the overall diagnosis as `indeterminate` unless
an earlier lane already proves a capture or delivery failure.

Outputs are local under the selected artifact directory:

- `integrated-attempts.json` — ordinary ModelBench attempts when this command
  ran the extension lane.
- `perception-report.json` — per-lane accuracy, diagnosis counts, resolved
  model identity, per-model screenshot and low/high/auto image-prompt totals,
  image hashes/dimensions/bytes/detail, usage, and artifact references.

Public websites may be used as non-scored canaries, but they must not enter the
canonical score because authentication, experiments, cookie banners, and page
drift prevent deterministic comparison.
