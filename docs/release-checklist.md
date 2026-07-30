# Release Checklist

Use this checklist when preparing a new OpenSidebar release.

## Current RC Status - 2026-07-30

The version of record is `0.6.1`; `0.6.0` was the previous package.

| Gate | Status | Evidence / next action |
| --- | --- | --- |
| Code fixes | Pass | Composer-caret and workspace-grouping fixes are merged into `main`, with focused regression coverage. |
| Listing material | Pass | Customer-only store copy, four screenshots, promo tile, and marquee are generated under `.artifacts/store/`; developer-only viewer images are excluded. |
| Audience videos | Pass | Customer and developer films are rendered with British female narration under `.artifacts/publish/`. |
| Manifest/version alignment | Pass | `package.json` and `apps/extension/manifest.json` declare `0.6.1`; confirm `dist/manifest.json` matches after the release build. |
| Site material | Pass | The built site exposes one customer tour and one developer tour from the cache-immutable `v7` media path. |
| Full release verification | Pass | Lint, typecheck, 5,231 extension tests, production build, dist validation, and production audit passed on 2026-07-30. |
| Native task completion | Blocked | The fresh Watch capture passed, but online-shop, cross-page, and local-provider task runs ended partial or timed out after bridge reconnect/completion failures. Do not tag or upload until a clean native task run passes on the release commit. |
| Release package/preflight | Package pass | The `0.6.1` zip, checksum, notes, and manifest are generated; rebuild on the release commit and run `corepack pnpm run release:preflight` before tagging. |
| Chrome Web Store upload | Pending | Upload the verified zip, four screenshots, promo graphics, listing copy, and the public URL of the customer video. |

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
- While iterating on release changes, `corepack pnpm run release:preflight --allow-dirty` can validate the generated artifacts.
- Before tagging, commit the release candidate, rerun `corepack pnpm run release:package`, then run the strict `corepack pnpm run release:preflight` and resolve any failed artifact, version, commit, checksum, or clean-tree check.
- Spot-check the loaded extension from `dist/` in Chrome. Use `corepack pnpm run release:smoke:native-panel` for the assisted native side-panel smoke; the script opens the native panel through a Chrome extension user gesture and still allows manual toolbar fallback.
- After the native smoke passes, run `corepack pnpm run release:preflight --require-native-smoke` to ensure the current commit has matching pass evidence.

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
- Rerun `corepack pnpm run release:package` and `corepack pnpm run release:preflight --require-native-smoke` on the exact commit being tagged
- Tag the release commit
- Attach the generated release notes from `.artifacts/releases/`
- Upload the built `dist/` package or release zip to the intended distribution channel

GitHub CLI draft command after final manual spot-check:

```bash
gh release create v0.6.1 \
  --draft \
  --title "OpenSidebar v0.6.1 OSS BYOK Preview" \
  --notes-file .artifacts/releases/opensidebar-v0.6.1-release-notes.md \
  .artifacts/releases/opensidebar-v0.6.1.zip \
  .artifacts/releases/opensidebar-v0.6.1.zip.sha256
```

## Current Known Caveat

- Real-browser E2E and WorkArena handoff runs are not part of `pnpm run verify`; run the relevant E2E gate explicitly for risky runtime changes.
