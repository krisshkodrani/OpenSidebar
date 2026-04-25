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
- dist artifact verification

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
| Planner, continuation, recovery, memory, backend durability | `npm run test:e2e:runtime` |
| Workflow-benchmark behavior or WorkArena-gap changes | `npm run test:e2e:workarena` |
| Release confidence on long workflow stability | `npm run test:e2e:workarena:variance` |

`npm run test:e2e:nightly` covers low-priority legacy primitives and is not required for every release candidate.

When you run the E2E suite or prepare the summary, write the dated report to:

- `.artifacts/e2e/e2e-report-YYYY-MM-DD.md`

## 4. Validate Release Artifacts

- Confirm the built extension exists under `dist/`
- Confirm `dist/manifest.json` exists and has the expected version
- Spot-check `dist/src/sidepanel/index.html`
- Spot-check `dist/src/trace-viewer/index.html`

## 5. Publish

- Commit the release candidate changes
- Tag the release commit
- Attach release notes derived from `CHANGELOG.md`
- Upload or submit the built `dist/` package to the intended distribution channel

## Current Known Caveat

- `npx tsc -b` is not yet a release gate because there is still pre-existing extension type debt in the background/orchestrator codepath. Release verification currently relies on lint, tests, and production build instead.
