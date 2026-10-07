# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| `main` | Active development |
| Latest GitHub release | Supported |
| Older releases | Best effort only |

## Reporting A Vulnerability

For sensitive security reports, use GitHub private vulnerability reporting for this repository if it is available. If private reporting is unavailable, open a minimal GitHub issue asking for a private contact path and do not include exploit details, credentials, cookies, or API keys in the public issue.

## Security Measures

### Credentials and data paths

- In **Direct from this browser** mode, the OpenRouter key stays in
  `chrome.storage.local`; requests go directly to OpenRouter over HTTPS.
- Optional **Cloud** mode uses an account-linked, KMS-encrypted credential vault
  and an OpenSidebar-hosted model relay. The relay processes task content while
  forwarding it; its application does not persist request/response bodies.
- Browser storage is not a dedicated secrets vault. Local access tokens, keys,
  and diagnostics rely on the browser profile and operating-system boundary.
- Signing in, enabling remote work, and enabling personal-data synchronization
  are separate choices. Remote missions send bounded task instructions and
  evidence through the service to the authorized supervising client.
- Published builds do not upload local reliability summaries. Development logs
  and traces can contain sensitive page data; redact them before sharing.
- See [PRIVACY_POLICY.md](PRIVACY_POLICY.md) for Cloud, Watch, synchronization,
  retention, and permission details.

### URL Sanitization

- Only `http` and `https` protocols are allowed for navigation.
- URLs are validated before navigation.
- Tool risk classifications are used for display and configurable approval behavior.

### Safety Gates

- Interaction settings can require plan confirmation and approval for high-risk actions.
- The Stop control lets users abort active runs.
- Tool calls are logged in the UI and local traces for review.

### Remote supervision

MCP instructions tell the supervising client to preserve task scope, treat page
content as untrusted, obtain applicable action authorization, and report unknown
outcomes honestly. These instructions supplement runtime checks. Local site
policy, digest- and expiry-bound approvals, target grounding, and Stop/Deny
controls remain enforced in the browser. Cancellation is not rollback.

### Dependency and release checks

`pnpm run release:verify` includes the production dependency audit. CI exercises
cloud-service tests as well as extension tests, with a separate disposable
PostgreSQL integration job. A green test suite does not establish that every
browser task is safe or that every dependency advisory is unreachable.
