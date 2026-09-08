# OpenSidebar 0.7.5 release candidate

Date: 2026-08-15

Status: historical release candidate; reconciled integration verified on 2026-09-08.

## September 8 integration

`integration/modelbench-release-20260908` reconciles ModelBench head `837f02bb`
with release head `1747c147`, including the five formerly unpushed release fixes.
The merge commit is `ea5840cc`. This is the current integration candidate;
the August PR #144 and the artifacts described below predate it.

Fresh verification on the merged source passed repository lint, all 11 project
typechecks, 570 extension test files / 5,599 tests, script tests, the production
extension build, and all 21 distribution checks. Cloud tests passed 124 cases
with two PostgreSQL-dependent tests skipped. Focused benchmark checks passed
34 tests, including every catalog gold oracle and declared near miss.
Local logs are under `.artifacts/branch-reconciliation/`.

The Windows environment required the pnpm `.cmd` entry point and a rebuild of
the missing `better-sqlite3` native binary. The complete verification rerun passed
after that repair. No test assertions or benchmark verdicts were bypassed.

This verification does not refresh the signed-in production-browser acceptance,
manual Settings persistence spot-check, production audit, release packaging,
or native sidepanel smoke against this new commit. Complete those gates before
publication; historical ZIP hashes and existing tags do not identify this merge.
ModelBench headline baselines/manual review and LP-38 production cutover remain
subject to their existing gates. The legacy suite remains present and LP-38
remains in shadow mode by default.

The Chakra UI migration is separately preserved on
`feat/cloud-ui-chakra-migration` at unverified checkpoint `11b070a9`.
Trace-viewer and telemetry rework are separate follow-ups to this integration.

## Purpose

`0.7.5` is the immutable patch successor to the already tagged `v0.7.4` release
candidate. It preserves the approved 0.7.4 feature boundary and adds the final
cancellation and revoked-session hardening found during acceptance. The existing
`v0.7.4` tag is not moved.

## Patch delta

- Explicit typed stop requests now use the real task-cancellation path instead
  of being appended as ordinary task feedback. Negated phrases such as
  "do not stop" do not trigger cancellation.
- Visible Delete and Trash browser actions require explicit approval even when
  the general approval bypass is enabled.
- Mounted sidepanels subscribe to cloud-session removal and re-read session
  state after authenticated account reload, so server-side revocation clears
  stale identity across extension contexts.
- The sidepanel keepalive port now has an explicit background receiver, and
  disconnect handlers consume Chrome's transient `runtime.lastError`. This
  removes the repeated "Receiving end does not exist" console error while
  preserving genuine service-worker disconnect recovery.
- Remote takeover, device-command execution, checkpoint restore, and Temporal
  coordination remain disabled.

## Verification already completed

- Focused cancellation, delete-approval, and session suites: 38 tests passed.
- Full sidepanel suite: 34 files and 232 tests passed.
- Affected background suites: 4 files and 202 tests passed.
- Extension TypeScript, changed-file lint, production build, and the 21-item
  distribution inspection passed.
- The keepalive receiver, sidepanel runtime wrapper, and existing reconnect
  behavior pass a focused 3-file, 57-test regression slice.
- The complete 0.7.4 acceptance evidence remains recorded in
  `docs/engineering/074-release-candidate-report.md`.

## MB-101 baseline

The fixed `7489dae0` head ran the non-rankable MB-101 acceptance case three
times with the checked-in release matrix. All three attempts were valid, with
no retries, provider or harness failures, model-resolution mismatch, validator
disagreement, or unexpected mutation.

| Result | Count | Browser acceptance evidence |
| --- | ---: | --- |
| `valid_pass` | 1 | Full state mutation, grounded answer, grouped linked tab, both panels enabled, and return to source |
| `valid_model_failure` | 1 | State mutation and all browser assertions passed; the model omitted the terminal answer |
| `valid_model_failure` | 1 | Linked tab was grouped and both panels were enabled; the model failed evidence verification before the save step |

Pass@1 is `1/3` (33.3 percent), valid coverage is `3/3` (100 percent), total
cost is `$0.072944`, and the run had zero retries. The valid model failures are
retained as measured; they were not rerun until green. The acceptance probe is
diagnostic and deliberately excluded from the frozen ModelBench-100 headline
score.

## Remaining release gates

1. Run the complete release verification on the versioned commit.
2. Build the deterministic `opensidebar-v0.7.5.zip` artifact and checksum.
3. Pass the native Chrome sidepanel smoke against that exact commit.
4. Run strict release preflight, then create and push the new immutable
   `v0.7.5` tag.
