# Release Checklist

Use this checklist when preparing a new OpenSidebar release.

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
- Run `corepack pnpm run release:package` and confirm it writes a release zip, `.sha256`, release notes, and artifact manifest under `.artifacts/releases/`.
- Spot-check the loaded extension from `dist/` in Chrome.

## 5. GitHub OSS BYOK Gate

For a broad GitHub-first BYOK release, also confirm:

- `package.json`, `apps/extension/manifest.json`, `CHANGELOG.md`, and release notes agree on the release version.
- README and Getting Started install steps work from a fresh clone with Node.js 22+.
- The BYOK provider matrix documents required keys and supported provider modes.
- Privacy, security, permissions, and safety-gate claims are consistent across public docs.
- A recommended provider completes one safe first-task smoke from the built `dist/` extension.
- [Known limitations](./known-limitations.md) are reviewed and linked from the release notes.
- The release artifact zip and checksum from `corepack pnpm run release:package` are attached to the GitHub release.

## 6. Publish

- Commit the release candidate changes
- Tag the release commit
- Attach release notes derived from `CHANGELOG.md`
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
