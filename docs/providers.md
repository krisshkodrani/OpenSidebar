# Providers

OpenRouter is the only LLM provider. OpenSidebar is bring-your-own-key. In local
mode, the OpenRouter key stays in Chrome and model traffic goes directly from
the browser to OpenRouter. In optional cloud mode, the user explicitly verifies
and KMS-encrypts an OpenRouter key on their OpenSidebar account; model traffic
streams through a non-retaining OpenSidebar relay to OpenRouter. OpenRouter
behavior, pricing, quotas, and downstream retention remain governed by
OpenRouter and the upstream host that serves each model.

Groq is not an LLM provider here. An optional Groq key in Settings is used only
for speech-to-text.

## Models

Model ids use the OpenRouter catalog form (`vendor/model`). Settings shows the
live OpenRouter catalog. In cloud mode, the relay enforces a reviewed model
allowlist.

| Seat     | Environment key      | Default                | Notes                                  |
| -------- | -------------------- | ---------------------- | -------------------------------------- |
| Executor | `OPENROUTER_API_KEY` | `openai/gpt-6-luna`    | Must be image-capable; see below       |
| Planner  | `OPENROUTER_API_KEY` | `openai/gpt-6-luna`    | Any catalog model                      |
| Judge    | `OPENROUTER_API_KEY` | `typesafe/jev-1.13`    | Typed judge decisions                  |

The seat defaults live in `apps/extension/src/config/model-config.ts`. The
executor must be image-capable and reliable enough for action-taking; the
eligible ids live in `apps/extension/src/utils/executor-model-policy.ts`. There
is no separate perception model seat: the executor receives screenshots when
the task needs vision. Settings may override the models. A test run's model
attribution must come from its recorded configuration and provider responses.

To make one small completion request, run `pnpm providers:smoke`. A missing
`OPENROUTER_API_KEY` is skipped. The command prints the token counts and cost
that OpenRouter reports; it creates no report file. It makes a paid API call.

A model is promoted only after `pnpm models:check` and the release smoke pass.

## What gets sent to OpenRouter

When a task needs it, page context (element lists, extracted text) and
screenshots may be sent to the selected model. Local mode connects directly.
Cloud mode processes the request transiently through OpenSidebar's streaming
relay; request/response content is not retained, while aggregate request and
token counts are retained for quota enforcement. The optional
reliability-summary preview in Settings remains local-only and is not linked to
the cloud account.

## Failure expectations

- **Invalid key** — requests fail immediately; the side panel surfaces the
  provider error.
- **Out of credits (HTTP 402)** — the task ends with an error that links to
  <https://openrouter.ai/credits>.
- **Rate limit or transient error** — the client retries with backoff;
  persistent 429s surface as a task error.
- **Model unavailable / provider outage** — the executor falls back to its
  configured fallback model; if OpenRouter is fully down the task fails with
  the error message.
