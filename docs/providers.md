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

| Provider mode | Environment key      | Executor default                              | Planner default                    | Status              |
| ------------- | -------------------- | --------------------------------------------- | ---------------------------------- | ------------------- |
| `openrouter`  | `OPENROUTER_API_KEY` | `openai/gpt-6-luna`                           | `openai/gpt-6-luna`               | Recommended default |
| `fireworks`   | `FIREWORKS_API_KEY`  | `accounts/fireworks/models/kimi-k2p7-code`   | `accounts/fireworks/models/glm-5p2` | Supported           |

The default OpenRouter seats in `apps/extension/src/config/model-config.ts` are
`openai/gpt-6-luna` for executor and planner, and `typesafe/jev-1.13` for
typed judge decisions. Fireworks uses `accounts/fireworks/models/gpt-oss-120b`
for its judge. There is no separate perception model seat: the executor receives
screenshots when the task needs vision. Settings may override the models. The internal E2E
harness has its own provider default (`fireworks`), so a test run's model
attribution must come from its recorded configuration and provider responses.

To make one small completion request per configured provider, run
`pnpm providers:smoke` or select one with
`pnpm providers:smoke -- --provider=openrouter`. Missing environment keys are
skipped. The command prints provider-reported token counts and cost when supplied;
it creates no report file. It makes a paid API call for each provider with a key.

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
