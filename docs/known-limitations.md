# Known Limitations

OpenSidebar is launchable as an OSS BYOK preview, but it is still a supervised
browser agent rather than guaranteed production automation.

## Agent Reliability

- The agent can misread page state, especially on heavily dynamic pages, hidden
  forms, custom widgets, cross-origin frames, and pages with delayed re-rendering.
- Canvas-style editors can use the `type_text` native-editor path after the agent
  identifies a visible editor surface. This path passed a local browser test;
  [Google Docs text entry](https://github.com/krisshkodrani/OpenSidebar/issues/139)
  remains unverified on a real document.
- The verifier and `DONE` hardening reduce premature completion, but they depend
  on available page evidence. Users should review sensitive results before acting
  on them.
- Long tasks can still omit requested facts from the final response. The
  [fact-retention](https://github.com/krisshkodrani/OpenSidebar/issues/156)
  and [sports-workflow](https://github.com/krisshkodrani/OpenSidebar/issues/163)
  fixes await live model confirmation.
- Long workflows can be affected by provider latency, rate limits, model outages,
  Chrome service-worker lifecycle behavior, and site-specific anti-automation.

## Safety And Permissions

- Broad host access is required so the agent can work on user-selected sites, but
  users should start on trusted, low-risk pages and keep approval gates enabled
  for sensitive tasks.
- Native editor input requires Chrome's `debugger` permission. Chrome shows a
  warning bar during the brief attachment; dismissing it cancels that input.
  The agent detaches immediately after the insertion attempt.
- Cookie, history, tab, download, screenshot, and JavaScript capabilities are
  powerful browser-agent tools. High-risk actions may still require user review
  depending on interaction settings.
- `execute_js` is guarded against common navigation, storage, cookie, network,
  and injection patterns, but users should still treat custom page scripting as a
  sensitive capability.

## BYOK Providers

- Provider pricing, quotas, logging, retention, model availability, and rate
  limits are governed by the configured provider, not by OpenSidebar.
- Some provider modes require multiple keys. If one lane is misconfigured, the
  agent may fail during planning, execution, perception, or verification.
- Model behavior can change without an OpenSidebar release.

## Local Data And Traces

- API keys are encrypted before being stored in Chrome extension local storage
  and are never synced by OpenSidebar. The encryption key is also local, so an
  attacker with access to both can still recover the provider keys.
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
  one supported provider key. Cloud accounts remain an allowlisted test feature.
