# OpenSidebar 0.7.3 release-candidate report

Date: 2026-08-11

Status: packaged and deployed; native side-panel smoke passed. Chrome Web Store upload and real signed-in two-profile acceptance remain pending because the Codex browser bridge exposes no connected browser profiles.

## Candidate

- Source and built manifest version: `0.7.3`.
- Package: `.artifacts/releases/opensidebar-v0.7.3.zip`.
- SHA-256: `52717c3b6e805e3533712ef2b7161d69ff2086be011e35ef7500f532f2ea9580`.
- Release preflight passed with native-smoke enforcement and dirty-tree allowance.
- Native Chrome side-panel smoke passed through the extension helper user gesture.

## Automated verification

- Extension and Sandbox TypeScript checks passed.
- All 195 side-panel tests passed.
- Focused affected-file lint passed without errors.
- Extension, Sandbox, and marketing-site production builds passed.
- Extension distribution verification passed.
- Playground target dependency isolation passed during deployment.

## Production website

- The normalized marketing copy and `/app/*` shell are deployed to `opensidebar.com`.
- Exact-host checks passed for the home page, Overview, Settings, Run Viewer, Playground, isolated target, and API readiness.
- The control bundle is `control-5WmSADL5.js`; `play.opensidebar.com` contains no control-bundle reference.
- The cloud API remains healthy with zero restarts.
- All trace-sync flags remain false and the trace tester allowlist remains empty.

## Remaining publication gates

1. Attach two Chrome profiles to the Codex browser bridge and load the exact `dist` build in both.
2. Review light/dark/narrow-width UI, sign-in, provider setup, Direct mode, settings save/sync recovery, and restart behavior.
3. Complete the two-profile encrypted-run recovery and handoff procedure before enabling trace flags.
4. Upload `opensidebar-v0.7.3.zip` to the existing Chrome Web Store item and submit only after the visual/product acceptance passes.

Do not tag or upload from the current dirty worktree as though it were an exact committed release. Repackage on the final release commit before tagging.
