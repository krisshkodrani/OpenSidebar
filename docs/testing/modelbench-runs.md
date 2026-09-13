# Running and interpreting ModelBench diagnostics

Use the extension driver to exercise the production agent against the scenario
target. The driver configures and observes the run; task behavior remains in the
runtime. Diagnostic passes are not a published benchmark score.

## Configuration and execution

Provide a version-1 matrix with named configurations and explicit model/provider
pins for executor, planner, and judge. The OpenRouter extension driver enables
strict routing: no cross-model/provider fallback, no Nitro model suffix, and no
image-stripping retry. Normal production fallback defaults are unchanged.
An unconfigured writer reuses the executor model and pin. A separately configured,
unpinned writer is not silently admitted to a strict run.

Run an isolated case before a larger suite:

```sh
pnpm modelbench:run --case <case-id> --matrix <matrix.json> \
  --driver scripts/modelbench-extension-driver.ts \
  --output .artifacts/modelbench/<unique-run-name>
```

Use `--suite full-100` for the complete suite. The driver builds the target and
extension before execution. Do not rebuild or edit runtime artifacts during a
run. Only use `MODEL_BENCH_SKIP_TARGET_BUILD=1` and
`MODEL_BENCH_SKIP_EXTENSION_BUILD=1` when reusing the same verified artifacts.
Use a new output directory for each diagnostic; preserve failed attempts.

Record the configuration and source revision, including uncommitted changes.
Do not pool results across case versions, code changes, provider routes, or model
quantizations as though they were one fixed baseline.

## Evidence and interpretation

- Use `attempts.json`, not the generic E2E helper's summary line, for the
  deterministic verdict and attempt classification.
- `valid_model_failure` means the evaluated agent system did not meet the case
  contract. It does **not** prove that the underlying model alone caused failure;
  planner, runtime, perception, and interaction behavior can contribute.
- Provider and harness failures are technical exclusions. The runner permits one
  technical retry and retains both attempts. An activated seat receiving only
  unsuccessful HTTP responses is a provider failure, even if the runtime proceeds
  using a local fallback plan.
- Served model/provider identity comes from API responses, never from the requested
  pin. Reported provider display names are mapped to routing slugs only through
  OpenRouter's public provider catalog, retained in the attempt diagnostics.
  Current role attribution requires distinct requested models per seat;
  ambiguous same-model seat configurations are indeterminate rather than guessed.
- Costs are the sum of API-reported usage, not an independently audited invoice.
  Missing usage on an error response does not establish a zero charge. Observed
  costs remain attached when a later driver operation throws.
- A missing agent trace is a harness failure. Terminal interaction evidence is
  retained independently, including clarification questions and suggestions.
  The presence of a trace file alone does not prove every turn was captured.
- Only completed task summaries supply answer text. Failed summaries may quote a
  rejected answer and must not accidentally satisfy an answer validator.
- State assertions remain authoritative for state-changing objectives. A case can
  achieve its requested state before the observation deadline even if the agent
  never emits a terminal message. Report that timeout explicitly; it is not a
  clean terminal completion or an uncensored completion-time measurement.

The local log server retains its SQLite writer for its lifetime so trace requests
do not repeatedly close/checkpoint the database. One-shot indexing utilities keep
their original connection lifecycle. The E2E harness owns the actual server
process and releases it during teardown.

Before publishing headline claims or removing legacy infrastructure, complete the
separate gates in [the acceptance record](../engineering/modelbench-100-acceptance.md).
