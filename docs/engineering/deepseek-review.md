# Direct DeepSeek Review

OpenSidebar uses the direct DeepSeek review script for adversarial code review. Do not use a DeepSeek MCP reviewer.

## Setup

- Set `DEEPSEEK_API_KEY` in the environment or in `.env`.
- The script sends repository diffs to DeepSeek only when `--allow-remote` is passed.
- Review artifacts are written to `.artifacts/reviews/deepseek-review-*.md`.

## Commands

```sh
npm run review:deepseek -- --working --allow-remote
npm run review:deepseek -- --staged --allow-remote
npm run review:deepseek -- --last --allow-remote
```

Use `--allow-large` only after confirming the diff is intentionally large enough to exceed the default size gate.

## Goal Work

For `/goal` work, include the objective and concise evidence so DeepSeek reviews against the actual success criteria, not just the code shape:

```sh
npm run review:deepseek -- --working --allow-remote --objective "Complete the active /goal objective" --evidence .artifacts/e2e/example-report.md
```

Evidence files should be short reports or command outputs that prove the main verification gate. Prefer one or two high-signal files over large raw traces.

## Checkpoint Flow

1. Implement the change and run the relevant tests, build, lint, or E2E gates.
2. Run DeepSeek on the final working or staged diff.
3. Accept only concrete findings: correctness bugs, race conditions, TypeScript issues, security mistakes, browser automation brittleness, or missing verification.
4. Reject speculative, style-only, or complexity-increasing findings with a short reason.
5. Apply accepted fixes and rerun the affected gates.
6. Commit only after tests pass and DeepSeek findings are resolved or explicitly rejected.

If the script cannot run because the key is missing, the network is unavailable, DeepSeek is rate-limited, or no review content is returned, self-review against the same checklist and note the fallback in the summary.
