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

### API Key Storage

- API keys are stored locally in `chrome.storage.local` and are not synced by OpenSidebar.
- Treat the browser profile and operating-system account as part of the trust boundary; extension storage is not a dedicated secrets vault.
- Keys are only sent to configured model providers over HTTPS for authentication.
- OpenSidebar does not operate a hosted relay, telemetry endpoint, or crash reporter.

### Data Privacy

- Settings, keys, and local diagnostics stay in browser storage unless you run the optional local development log server.
- Page context and screenshots may be sent directly to the model provider you configure when you run a task.
- No OpenSidebar-hosted analytics or tracking is used.

### URL Sanitization

- Only `http` and `https` protocols are allowed for navigation.
- URLs are validated before navigation.
- Tool risk classifications are used for display and configurable approval behavior.

### Safety Gates

- Interaction settings can require plan confirmation and approval for high-risk actions.
- The Stop control lets users abort active runs.
- Tool calls are logged in the UI and local traces for review.
