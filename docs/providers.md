# Providers

OpenSidebar is bring-your-own-key. In local mode, the configured key stays in
Chrome and model traffic goes directly from the browser to the provider. In
optional cloud mode, the user explicitly verifies and KMS-encrypts an OpenRouter
or Fireworks key on their OpenSidebar account; model traffic streams through a
non-retaining OpenSidebar relay to that provider. Provider behavior, pricing,
quotas, and downstream retention remain governed by the selected provider.

## Provider matrix

In local mode, Settings derives this list from keys stored locally. In cloud
mode, only the account's verified OpenRouter or Fireworks credential is usable,
and the relay enforces a reviewed model allowlist. Legacy hybrid stacks remain
local-only.

| Provider mode | Required key(s) | Role             | Status              | Notes                                   |
| ------------- | --------------- | ---------------- | ------------------- | --------------------------------------- |
| `openrouter`  | OpenRouter key  | Full agent stack | Recommended default | Live catalog with a verified allowlist. |
| `fireworks`   | Fireworks key   | Full agent stack | Supported           | Curated, compatibility-checked models.  |

Experimental and legacy provider modes remain understood by the runtime for
migrations and internal evaluation, but are not offered in Settings. A provider
or model is promoted only after `pnpm models:check` and the release smoke pass.

## What gets sent to the provider

When a task needs it, page context (element lists, extracted text) and
screenshots may be sent to the selected model provider. Local mode connects
directly. Cloud mode processes the request transiently through OpenSidebar's
streaming relay; request/response content is not retained, while aggregate
request and token counts are retained for quota enforcement. The optional
reliability-summary preview in Settings remains local-only and is not linked to
the cloud account.

## Failure expectations

- **Invalid key** — requests fail immediately; the side panel surfaces the
  provider error.
- **Quota exhausted / rate limit** — the client retries with backoff and fails
  over between configured pools where possible; persistent 429s surface as a
  task error.
- **Model unavailable / provider outage** — the executor falls back to its
  configured fallback model; if the provider is fully down the task fails with
  the provider's error message.
