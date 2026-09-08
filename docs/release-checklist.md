# Release Checklist

Use this checklist when preparing a new OpenSidebar release.

## Current RC Status - 2026-08-08

The `0.7.2` update is submitted for Chrome Web Store review under the stable ID
`hakbnbbkiehiofnafdkcibbnkbdmjiha`; existing users remain on the previously
published version until Google approves the update.

| Gate                       | Status               | Evidence / next action                                                                                                                                                                              |
| -------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code and UI                | Passed               | Compact task rail, OpenRouter default/recommendation, provider migration, local reliability summaries, recovery paths, and the staged composer/workspace fixes are present; focused tests passed.   |
| Listing material           | Passed               | Rebuilt the four customer-only screenshots, promo tile, and marquee under `.artifacts/store/`; OpenRouter is selected in the provider capture and developer-only viewer images are excluded.        |
| Audience videos            | Passed               | Revalidated both British-female films under `.artifacts/publish/`; rebuilt the customer film with OpenRouter attribution and retained the already accurate developer film.                          |
| Manifest/version alignment | Passed               | `package.json`, source manifest, and built `dist/manifest.json` declare `0.7.2`; the build contains the exact production Cognito domain/client.                                                     |
| Site material              | Passed               | Rebuilt and verified both tours and posters from the cache-immutable `v8` media path; the production site build passed with no failed media requests.                                               |
| Full release verification  | Passed               | RFC validation, lint, typecheck, 5,286 extension tests, production build, dist validation, and production audit passed on the reconciled candidate.                                                 |
| Native task completion     | Pending              | Re-run deterministic native login/navigation and the native side-panel smoke on the exact release commit.                                                                                           |
| Release package/preflight  | Pending exact commit | The `0.7.2` zip, checksum, notes, and manifest pass `release:preflight --allow-dirty`; regenerate and run the strict native/preflight gate after committing.                                        |
| Chrome Web Store upload    | Submitted for review | Package 0.7.2 plus the Cloud-mode privacy and listing disclosures are saved and submitted on the existing item; wait for Published or reviewer feedback.                                            |
| Production activation      | Blocked on approval  | Follow [cloud-production-activation-runbook.md](engineering/cloud-production-activation-runbook.md); keep credential, preference, relay, session, checkpoint, command, and Temporal flags disabled. |

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

| Change area                                                           | Recommended command                                                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Page actions, navigation, overlays, forms, shopping                   | `pnpm run test:e2e:interactions`                                                                                               |
| Planner, continuation, recovery, backend durability                   | `pnpm run test:e2e:runtime`                                                                                                    |
| WorkArena setup, reporting, or ServiceNow handoff changes             | `pnpm exec tsx scripts/workarena-doctor.ts` and `pnpm exec tsx scripts/workarena-validate-reports.ts`                          |
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
gh release create v0.7.0 \
  --draft \
  --title "OpenSidebar v0.7.0 OSS BYOK Preview" \
  --notes-file .artifacts/releases/opensidebar-v0.7.0-release-notes.md \
  .artifacts/releases/opensidebar-v0.7.0.zip \
  .artifacts/releases/opensidebar-v0.7.0.zip.sha256
```

## Current Known Caveat

- Real-browser E2E and WorkArena handoff runs are not part of `pnpm run verify`; run the relevant E2E gate explicitly for risky runtime changes.
