# Known Limitations

OpenSidebar is launchable as an OSS BYOK preview, but it is still a supervised
browser agent rather than guaranteed production automation.

## Agent Reliability

- The agent can misread page state, especially on heavily dynamic pages, hidden
  forms, custom widgets, cross-origin frames, and pages with delayed re-rendering.
- The verifier and `DONE` hardening reduce premature completion, but they depend
  on available page evidence. Users should review sensitive results before acting
  on them.
- Long workflows can be affected by provider latency, rate limits, model outages,
  Chrome service-worker lifecycle behavior, and site-specific anti-automation.

## Safety And Permissions

- Broad host access is required so the agent can work on user-selected sites, but
  users should start on trusted, low-risk pages and keep approval gates enabled
  for sensitive tasks.
- Cookie, history, tab, download, screenshot, and JavaScript capabilities are
  powerful browser-agent tools. High-risk actions may still require user review
  depending on interaction settings.
- `execute_js` is guarded against common navigation, storage, cookie, network,
  and injection patterns, but users should still treat custom page scripting as a
  sensitive capability.

## BYOK Providers

- Provider pricing, quotas, logging, retention, model availability, and rate
  limits are governed by the configured provider, not by OpenSidebar.
- OpenRouter is the only supported gateway. An unavailable model, invalid key,
  or exhausted quota can stop planning, execution, perception, or verification.
- Model behavior can change without an OpenSidebar release.

## Local Data And Traces

- Direct-mode keys stay in Chrome extension local storage. Optional Cloud mode
  stores an explicitly connected OpenRouter key in an encrypted account vault.
  See the [privacy policy](../PRIVACY_POLICY.md) for optional synchronization.
- The development log server and trace viewer are local-only tools. Running
  `pnpm run dev` or `pnpm run logs` can write page context, tool outputs, and
  screenshot artifacts under local `logs/`, `traces/`, and `.artifacts/` paths.
- Redact sensitive traces before sharing bug reports or release evidence.

## Distribution

- A signed Chrome Web Store build is published. The repository's reproducible
  `dist/` build remains available for development and audit; unpacked builds use
  a different extension identity unless the developer-dashboard public key is
  supplied.
- Source-build users need Node.js 22+, pnpm via Corepack, Chrome, and at least
  one supported provider key. Cloud and remote capabilities depend on account eligibility, server feature
  flags, and the installed extension build.

## Watch and remote work

- Watch reads the selected tab while Chrome and the extension are running. It
  does not provide an always-on server monitor or survive browser restarts.
- Screenshot input requires the watched tab to be active. Background tabs use
  DOM evidence; browser throttling, canvas-only changes, and model latency can
  delay detection. A model evaluates the condition, so notifications are not a
  deterministic guarantee.
- Read-only remote missions require explicit device enablement. Interactive
  remote work remains separately gated pending browser acceptance. Local Stop,
  Deny, site restrictions, and approvals cannot be overridden by a remote client.
- Cancelling a task cannot undo effects already performed. An uncertain result
  requires inspection before retrying a consequential action.
