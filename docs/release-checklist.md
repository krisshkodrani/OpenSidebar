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
- extension tests
- backend tests
- production build

## 3. Run Final E2E Validation

Run at least one real-browser E2E validation against the release candidate after the build is green.

Recommended smoke case:

```bash
npx vitest run --config apps/extension/tests/e2e/vitest.e2e.config.ts apps/extension/tests/e2e/summarize.test.ts
```

If the release changes are concentrated in a different area, run a more relevant E2E in addition to the summarize smoke.

When you run the E2E suite or prepare the summary, write the dated report to:

- `docs/e2e-report-YYYY-MM-DD.md`

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
