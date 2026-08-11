# LP-34 — Unified web app and end-to-end encrypted trace sync

Status: Decision stamped; implementation and named-tester verification in progress.

## Context

OpenSidebar's account, dashboard, sessions, Playground controls, and developer trace viewer evolved as separate surfaces. Signed-in users need one coherent application, while trace portability must not give the service access to page content, screenshots, prompts, or model output.

## Chosen design

- Authenticated routes live under `/app` in one Chakra UI shell. Marketing remains static and the agent-visible Playground target remains isolated on `play.opensidebar.com`.
- The website Viewer supports existing frozen JSON imports and encrypted `.ostrace` bundles.
- Trace sync is explicit opt-in and account-owner-only. The extension encrypts the complete frozen bundle with a random AES-256-GCM data key and wraps that key with a user recovery key using AES-KW.
- The recovery key stays on user devices. PostgreSQL stores ownership, lifecycle, quota, retention, and authenticated index metadata; S3 stores opaque ciphertext.
- Retention is 30 days and the initial quota is 500 MB per account. Upload, download, and the parent trace-sync capability have separate default-off kill switches and a dedicated named-tester allowlist.
- Completed traces enter a ciphertext-only IndexedDB queue with a 30-second local-only grace period. Users can pause, retry, or exclude an individual pending trace; transient failures use bounded exponential backoff and an MV3 alarm wake-up.
- PostgreSQL is authoritative. Temporal is not part of this feature.

## Security and recovery consequences

OpenSidebar cannot decrypt a trace or recover a lost recovery key. A new browser must be given the recovery key before it can open synced traces. The encrypted header is authenticated as AES-GCM associated data, so server-side metadata alteration makes decryption fail. Deletion first marks metadata, deletes the object, and then removes metadata; expired deletion candidates remain retryable after interruption.

## Decision

Status: Approved

Chosen path:

- Build the normalized `/app` portal and E2EE full-bundle trace sync described above.

Required edits before implementation:

- None.

Non-blocking follow-ups:

- Extract more of the existing developer viewer's advanced analysis panels into browser-neutral components after the first named-tester slice.
- Replace same-origin streamed trace transfer with presigned S3 transfer if measured bundle sizes or host memory justify it.

Do not do:

- Do not give the service a recovery key or plaintext trace content.
- Do not enable trace-sync flags for general users before named-tester acceptance.
- Do not expose the Playground control state to the target origin.
- Do not introduce Temporal as an authority or dependency.

Evidence required before merge:

- WebCrypto round-trip, wrong-key, and authenticated-metadata tamper tests.
- Ownership-scoped upload, digest commit, download, deletion, quota, retention-retry, and independent kill-switch tests.
- Portal and extension typechecks and production builds.
- Named-tester recovery-key transfer, restart, upload retry, deletion, and two-browser open tests.

Next action:

- Implement
