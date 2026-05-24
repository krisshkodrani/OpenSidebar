# Release Checklist

Use this checklist when preparing a new OpenSidebar release.

## Current RC Status - 2026-05-24

Goal: prepare OpenSidebar for a broad GitHub-first OSS BYOK release candidate.

| Gate | Status | Evidence / next action |
| --- | --- | --- |
| Working tree checkpoint | Pass | Completion-kernel, loop, loop-helper, and skill-ranking hardening fixes are committed. Verify `git status --short` is clean immediately before tagging the final RC. |
| BYOK setup docs | Pass | README, Getting Started, Privacy Policy, Security Policy, and OSS BYOK Launch Roadmap document local keys, provider traffic, and supported provider modes. |
| Runtime default docs | Pass | Fireworks is the default provider mode; default executor/planner model is `accounts/fireworks/routers/kimi-k2p6-turbo`. |
| Manifest/version alignment | Pass | `package.json` and `apps/extension/manifest.json` both declare `0.9.1`. |
| Permission/privacy alignment | Pass | Broad host access plus tabs, cookies, history, downloads, and tab capture are documented in `PRIVACY_POLICY.md`, `SECURITY.md`, `docs/features/security.md`, and `docs/known-limitations.md`. |
| Focused unit regression | Pass | `corepack pnpm exec vitest run --config vitest.config.ts --reporter=basic --silent=true tests/background/agent.test.ts` passed: 168 tests. |
| Focused UI/overlay regression | Pass | Sidepanel/overlay Doing Now HUD test group passed before this checklist update. |
| Production build / dist validation / typecheck | Pass | Covered by `corepack pnpm run release:verify`; `corepack pnpm run release:package` also rebuilt `dist/` and passed `ci:dist`. |
| Focused real-browser smoke | Pass | Local mock login E2E passed with `E2E_LOCAL_MOCK_PROVIDER=1` after verifier hardening, with the earlier retry caveat documented in `.artifacts/e2e/e2e-report-2026-05-24.md`. The newer staged smoke login completed in one trace with accepted authenticated-state evidence. |
| Full release verification | Pass | `corepack pnpm run release:verify` passed on 2026-05-24 after verifier hardening fixes. Existing lint warnings remain in `apps/extension/tests/e2e/multi-turn-workflows.test.ts`. |
| Staged E2E release gate | Pass | `E2E_PROFILE=ci corepack pnpm run test:e2e:smoke` passed on 2026-05-24: 8 files, 9 tests. The run logged browser-close timeout warnings after several completed files; the harness killed those browser processes and the suite exited green. See `.artifacts/e2e/e2e-report-2026-05-24.md`. |
| Native side-panel smoke | Pending | `corepack pnpm run release:smoke:native-panel -- --timeoutMs=240000 --holdMs=1000` was attempted on 2026-05-24 for commit `5ea9af9afa9890ea3ad8dee372869c790c6cd349`, but timed out waiting for the manual toolbar click. Evidence: `.artifacts/e2e/native-sidepanel/2026-05-24/native-sidepanel-smoke-2026-05-24_11-34-23-161.json`. Rerun on the final commit, click the OpenSidebar toolbar icon in the launched Chrome window, then run `corepack pnpm run release:preflight -- --require-native-smoke`. |
| Release package/preflight | Partial | `corepack pnpm run release:package` refreshed `.artifacts/releases/opensidebar-v0.9.1.zip` (`sha256: 83a00fd694fab308eea03bb2185ee283f164d8aa97a51bdf4838a5ee4964c068`); the artifact manifest records the exact packaged commit. Non-native `corepack pnpm run release:preflight` reaches the tag gate and fails because local tag `v0.9.1` still points to `4979f9f34909866f1b8e50c3aef6c2e721f109ed`. |

Open cleanup before calling the RC broad-release ready:

- Run the native side-panel smoke gate on the exact release-candidate commit.
- Move or recreate local tag `v0.9.1` on the final release-candidate commit after the native side-panel smoke passes.
- Rerun `corepack pnpm run release:package`, then rerun strict `corepack pnpm run release:preflight -- --require-native-smoke`.

## 1. Freeze The Release Candidate

- Ensure the working tree only contains intended release changes.
- Confirm `package.json` and `apps/extension/manifest.json` have the target version.
- Update `CHANGELOG.md` with the release notes for that version.

## 2. Run Release Verification

From the repo root:

```bash
corepack pnpm run release:verify
```

This runs:

- lint across maintained app source, shared packages, active tests, and TypeScript tooling scripts
- TypeScript project references typecheck
- extension tests
- backend tests
- production build
- extension artifact verification for the generated `dist/` manifest, side panel, trace viewer, service worker import, icons, content scripts, web-accessible resources, and Vite manifest
- production dependency audit for known advisories

## 3. Run Final E2E Validation

Run at least one real-browser E2E validation against the release candidate after the build is green.

Recommended smoke gate:

```bash
pnpm run test:e2e:smoke
```

If the release changes are concentrated in a different area, run the relevant purpose suite in addition to smoke:

| Change area | Recommended command |
| ----------- | ------------------- |
| Page actions, navigation, overlays, forms, shopping | `pnpm run test:e2e:interactions` |
| Planner, continuation, recovery, backend durability | `pnpm run test:e2e:runtime` |
| WorkArena setup, reporting, or ServiceNow handoff changes | `pnpm exec tsx scripts/workarena-doctor.ts` and `pnpm exec tsx scripts/workarena-validate-reports.ts` |
| Real WorkArena confidence after intentional ServiceNow reset approval | `pnpm exec tsx scripts/workarena-handoff.ts --task workarena.servicenow.all-menu --seed 0 --allow-servicenow-reset --no-build` |

Real WorkArena handoff commands may mutate a remote ServiceNow benchmark instance and spend LLM tokens. Run them deliberately, and keep generated reports under `.artifacts/e2e/`.

When you run the E2E suite or prepare the summary, write the dated report to:

- `.artifacts/e2e/e2e-report-YYYY-MM-DD.md`

## 4. Validate Release Artifacts

- Confirm `corepack pnpm run ci:dist` passes.
- Confirm `dist/manifest.json` has the expected version.
- Confirm `corepack pnpm run ci:audit` reports no production vulnerabilities.
- Run `corepack pnpm run release:package` and confirm it builds `dist/`, then writes a release zip, `.sha256`, release notes, and artifact manifest under `.artifacts/releases/`.
- While iterating on release changes, `corepack pnpm run release:preflight -- --allow-dirty` can validate the generated artifacts.
- Before tagging, commit the release candidate, rerun `corepack pnpm run release:package`, then run the strict `corepack pnpm run release:preflight` and resolve any failed artifact, version, commit, checksum, or clean-tree check.
- Spot-check the loaded extension from `dist/` in Chrome. Use `corepack pnpm run release:smoke:native-panel` for the assisted native side-panel smoke, then click the OpenSidebar toolbar icon in the launched Chrome window.
- After the native smoke passes, run `corepack pnpm run release:preflight -- --require-native-smoke` to ensure the current commit has matching pass evidence.

## 5. GitHub OSS BYOK Gate

For a broad GitHub-first BYOK release, also confirm:

- `package.json`, `apps/extension/manifest.json`, `CHANGELOG.md`, and release notes agree on the release version.
- README and Getting Started install steps work from a fresh clone with Node.js 22+.
- The BYOK provider matrix documents required keys and supported provider modes.
- Privacy, security, permissions, and safety-gate claims are consistent across public docs.
- A recommended provider completes one safe first-task smoke from the built `dist/` extension.
- The assisted native side-panel smoke records evidence under `.artifacts/e2e/native-sidepanel/`.
- [Known limitations](./known-limitations.md) are reviewed and linked from the release notes.
- The release artifact zip and checksum from `corepack pnpm run release:package` are attached to the GitHub release.

## 6. Publish

- Commit the release candidate changes
- Rerun `corepack pnpm run release:package` and `corepack pnpm run release:preflight -- --require-native-smoke` on the exact commit being tagged
- Tag the release commit
- Attach the generated release notes from `.artifacts/releases/`
- Upload the built `dist/` package or release zip to the intended distribution channel

GitHub CLI draft command after final manual spot-check:

```bash
gh release create v0.9.1 \
  --draft \
  --title "OpenSidebar v0.9.1 OSS BYOK Preview" \
  --notes-file .artifacts/releases/opensidebar-v0.9.1-release-notes.md \
  .artifacts/releases/opensidebar-v0.9.1.zip \
  .artifacts/releases/opensidebar-v0.9.1.zip.sha256
```

## Current Known Caveat

- Real-browser E2E and WorkArena handoff runs are not part of `pnpm run verify`; run the relevant E2E gate explicitly for risky runtime changes.
