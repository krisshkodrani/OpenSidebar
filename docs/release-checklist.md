# Release Checklist

Use this checklist when preparing a new OpenSidebar release.

Check the source version in `package.json` and `apps/extension/manifest.json`,
then compare it with the latest published [GitHub release](https://github.com/krisshkodrani/OpenSidebar/releases).
A source version or an earlier candidate's evidence does not certify a release.
Run the gates below on the exact commit to be tagged.

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
- production build
- extension artifact verification for the generated `dist/` manifest, side panel, trace viewer, service worker import, icons, content scripts, web-accessible resources, and Vite manifest
- production dependency audit for known advisories

For cloud-service changes, also run `corepack pnpm run cloud:test`; it is not
part of `release:verify`.

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

ServiceNow support was removed by owner decision (2026-09-28). Validate
changes with local checks and generic browser tests; keep generated outputs
under `.artifacts/e2e/`.

Keep generated E2E diagnostics under `.artifacts/e2e/` and summarize the result
in the CLI or pull request. Do not commit traces or generated reports.

## 4. Validate Release Artifacts

- Confirm `corepack pnpm run ci:dist` passes.
- Confirm `dist/manifest.json` has the expected version.
- Compare the built `dist/manifest.json` security fields with `apps/extension/manifest.json` before Chrome Web Store submission: permissions, content scripts, `web_accessible_resources`, and absence of `externally_connectable`.
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

GitHub CLI draft command after final manual spot-check (replace `0.7.7` with
the release version):

```bash
gh release create v0.7.7 \
  --draft \
  --title "OpenSidebar v0.7.7 OSS BYOK Preview" \
  --notes-file .artifacts/releases/opensidebar-v0.7.7-release-notes.md \
  .artifacts/releases/opensidebar-v0.7.7.zip \
  .artifacts/releases/opensidebar-v0.7.7.zip.sha256
```

## Current Known Caveat

- Real-browser E2E runs are not part of `pnpm run verify`; run the relevant E2E gate explicitly for risky runtime changes.
