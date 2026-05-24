# Release Checklist

Use this checklist when preparing a new OpenSidebar release.

## Current RC Status - 2026-05-24

Goal: prepare OpenSidebar for a broad GitHub-first OSS BYOK release candidate.

| Gate | Status | Evidence / next action |
| --- | --- | --- |
| Working tree checkpoint | Pending | Current tree contains intentional Doing Now UI and completion-verifier hardening changes that still need a final commit. |
| BYOK setup docs | Pass | README, Getting Started, Privacy Policy, Security Policy, and OSS BYOK Launch Roadmap document local keys, provider traffic, and supported provider modes. |
| Runtime default docs | Pass | Fireworks is the default provider mode; default executor/planner model is `accounts/fireworks/routers/kimi-k2p6-turbo`. |
| Manifest/version alignment | Pass | `package.json` and `apps/extension/manifest.json` both declare `0.9.1`. |
| Permission/privacy alignment | Pass | Broad host access plus tabs, cookies, history, downloads, and tab capture are documented in `PRIVACY_POLICY.md`, `SECURITY.md`, `docs/features/security.md`, and `docs/known-limitations.md`. |
| Focused unit regression | Pass | `npx vitest run apps\extension\tests\background\completion-kernel.form-fill.test.ts` passed: 25 tests. |
| Focused UI/overlay regression | Pass | Sidepanel/overlay Doing Now HUD test group passed before this checklist update. |
| Production build / dist validation / typecheck | Pass | `npm run build`, `npm run ci:dist`, and `npm run typecheck` passed after the Doing Now UI and completion-verifier changes. |
| Focused real-browser smoke | Pass with caveat | Local mock login E2E passed with `E2E_LOCAL_MOCK_PROVIDER=1`; it required a retry after first-run Done rejections while async login state settled. See `.artifacts/e2e/e2e-report-2026-05-24.md`. |
| Full release verification | Pending | Run `corepack pnpm run release:verify` on the release-candidate commit. |
| Staged E2E release gate | Pending | Run at least `pnpm run test:e2e:smoke`; broaden to interactions/runtime if release changes touch runtime behavior. |
| Native side-panel smoke | Pending | Run `corepack pnpm run release:smoke:native-panel` against `dist/`, then `corepack pnpm run release:preflight -- --require-native-smoke`. |
| Release package/preflight | Pending | After commit, run `corepack pnpm run release:package` and strict `corepack pnpm run release:preflight`. |

Open cleanup before calling the RC broad-release ready:

- Make the local mock login smoke a clean first-run pass instead of a recovered retry pass, or explicitly accept it as a preview caveat.
- Commit the Doing Now UI and completion-verifier changes after final diff review.
- Run the full release verification and staged E2E gates on the exact release-candidate commit.

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
