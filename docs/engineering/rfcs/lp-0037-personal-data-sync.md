# LP-37 — Optional E2EE personal-data sync and unified Sync center

Status: Decision stamped; implementation in progress.

## Context

Saved prompts, recorded website skills, and Profile Notes currently live only in
the extension's local storage. Account preferences already have a revisioned
backend sync path, while cloud sessions and trace sync have separate consent and
storage models. Users need one understandable place to control these behaviors
without making the backend authoritative for browser safety or exposing their
personal content to the service.

## Chosen design

- Add a dedicated Settings → Sync tab covering preferences, personal content,
  and capability-gated task-session and trace controls.
- Preserve local-first operation. Preferences remain enabled for existing
  linked users but become independently optional. Saved Prompts and Website
  Skills are opt-in. Profile Sync is staged behind an additional activation
  gate and appears as Coming soon until that gate passes.
- End-to-end encrypt all synced user-authored content in the extension. The
  backend stores only ciphertext, authenticated metadata, public device keys,
  and wrapped personal-data keys.
- Bootstrap the first browser as the encrypted-data authority. Additional
  browsers receive the account personal-data key only through an expiring,
  matching-code, existing-device approval flow. There is no recovery key or
  support backdoor.
- If every approved browser is lost, the user may delete the unrecoverable
  ciphertext and initialize a new key epoch from current local data.
- Synchronize automatically after edits, startup/sign-in, and reconnect, with a
  manual Sync now action. Pull before push, merge independent prompt/skill
  records, and require explicit review for same-record or singleton Profile
  conflicts. Never silently discard the losing version.
- Turning a category off stops transfer and retains its encrypted cloud copy.
  Cloud deletion is a separate confirmed action and retains local data.

## Boundaries

- Built-in prompts and skill bodies remain versioned extension assets.
- Approvals, navigation/site-access policy, browser permissions, credentials,
  local traces, and other local-safety state never enter personal-data sync.
- Preference sync retains its closed server-readable schema. Cloud session
  checkpoints retain their existing cloud encryption contract. Detailed trace
  sync retains its own explicit consent and E2EE implementation.
- The extension is the only content editor. The web account surface may show
  devices, encrypted byte counts, and deletion controls but cannot decrypt or
  edit personal content.

## Delivery

1. Land default-off contracts, storage, APIs, crypto/runtime ports, capability
   reporting, and kill switches.
2. Prove first-device initialization, verified device approval, reset, and key
   rotation with synthetic documents for named testers.
3. Enable Saved Prompts and Website Skills with reconciliation and Sync UX.
4. Enable Profile only after plaintext-leak, tamper, two-browser transfer,
   conflict, deletion, loss/reset, and restart acceptance passes.

## Decision

Status: Approved

Chosen path:

- Implement the unified Sync center and staged E2EE personal-data sync described
  in this RFC, using existing-device approval and no server-held recovery secret.

Required edits before implementation:

- None.

Non-blocking follow-ups:

- Add browser-to-browser push delivery if polling latency becomes material.
- Add a browser-neutral web metadata view after extension acceptance passes.

Do not do:

- Do not upload plaintext saved prompts, website skills, Profile Notes, or
  Profile Digest content.
- Do not make cloud state authoritative for local safety settings.
- Do not enable Profile Sync before its separate security and recovery gate.
- Do not silently resolve same-record or Profile conflicts with last-write-wins.
- Do not add a backend, support, or analytics path capable of recovering the
  personal-data key.

Evidence required before merge:

- Crypto round-trip, associated-data tamper, wrong-account, wrong-epoch, and
  backend-plaintext-exclusion tests.
- Ownership, optimistic-revision, quota, deletion, reset, expiry, and disabled-
  capability backend tests.
- Two-browser initialization/approval, offline edit, merge/conflict, deletion,
  revocation/rotation, service-worker restart, and lost-device reset tests.
- Settings UX accessibility and narrow-layout tests, plus the repository's full
  verification command.

Next action:

- Implement
