# Release Checklist

Use this checklist when preparing a new OpenSidebar release.

## 1. Freeze The Release Candidate

- Ensure the working tree only contains intended release changes.
- Confirm `package.json` and `apps/extension/manifest.json` have the target version.
- Update `CHANGELOG.md` with the release notes for that version.

## 2. Run Release Verification

From the repo root:

```bash
npm run release:verify
```

This runs:

- lint across maintained app source, shared packages, active tests, and TypeScript tooling scripts
- TypeScript project references typecheck
- extension tests
- backend tests
- production build
- extension artifact verification for the generated `dist/` manifest, side panel, trace viewer, service worker import, icons, content scripts, web-accessible resources, and Vite manifest

## 3. Run Final E2E Validation

Run at least one real-browser E2E validation against the release candidate after the build is green.

Recommended smoke gate:

```bash
npm run test:e2e:smoke
```

If the release changes are concentrated in a different area, run the relevant purpose suite in addition to smoke:

| Change area | Recommended command |
| ----------- | ------------------- |
| Page actions, navigation, overlays, forms, shopping | `npm run test:e2e:interactions` |
| Planner, continuation, recovery, backend durability | `npm run test:e2e:runtime` |
| WorkArena setup, reporting, or ServiceNow handoff changes | `npx tsx scripts/workarena-doctor.ts` and `npx tsx scripts/workarena-validate-reports.ts` |
| Real WorkArena confidence after intentional ServiceNow reset approval | `npx tsx scripts/workarena-handoff.ts --task workarena.servicenow.all-menu --seed 0 --allow-servicenow-reset --no-build` |

Real WorkArena handoff commands may mutate a remote ServiceNow benchmark instance and spend LLM tokens. Run them deliberately, and keep generated reports under `.artifacts/e2e/`.

When you run the E2E suite or prepare the summary, write the dated report to:

- `.artifacts/e2e/e2e-report-YYYY-MM-DD.md`

## 4. Validate Release Artifacts

- Confirm `npm run ci:dist` passes.
- Confirm `dist/manifest.json` has the expected version.
- Spot-check the loaded extension from `dist/` in Chrome.

## 5. Publish

- Commit the release candidate changes
- Tag the release commit
- Attach release notes derived from `CHANGELOG.md`
- Upload or submit the built `dist/` package to the intended distribution channel

## Current Known Caveat

- Real-browser E2E and WorkArena handoff runs are not part of `release:verify`; run the relevant E2E gate explicitly for risky runtime changes.
