# Providers

OpenSidebar is bring-your-own-key: you configure one (or two) provider API
keys in Settings and all model traffic goes directly from your browser to that
provider. Provider behavior, pricing, quotas, data retention, and rate limits
are governed by the provider you select.

## Provider matrix

Settings derives this list from the keys stored locally. Single-provider
stacks appear when their key is present; hybrid stacks appear only when both
required keys are present. Removing a required key selects another usable
stack when possible and clears incompatible model overrides.

| Provider mode | Required key(s) | Role             | Status              | Notes                                   |
| ------------- | --------------- | ---------------- | ------------------- | --------------------------------------- |
| `openrouter`  | OpenRouter key  | Full agent stack | Recommended default | Live catalog with a verified allowlist. |
| `fireworks`   | Fireworks key   | Full agent stack | Supported           | Curated, compatibility-checked models.  |

Experimental and legacy provider modes remain understood by the runtime for
migrations and internal evaluation, but are not offered in Settings. A provider
or model is promoted only after `pnpm models:check` and the release smoke pass.

## What gets sent to the provider

When a task needs it, page context (element lists, extracted text) and
screenshots may be sent to the selected model provider. Model traffic is not
routed through OpenSidebar, and the published extension contains no
first-party telemetry upload endpoint. The optional reliability-summary
preview in Settings remains local-only in this release.

## Failure expectations

- **Invalid key** — requests fail immediately; the side panel surfaces the
  provider error.
- **Quota exhausted / rate limit** — the client retries with backoff and fails
  over between configured pools where possible; persistent 429s surface as a
  task error.
- **Model unavailable / provider outage** — the executor falls back to its
  configured fallback model; if the provider is fully down the task fails with
  the provider's error message.
