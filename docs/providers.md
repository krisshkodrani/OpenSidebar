# Providers

OpenSidebar is bring-your-own-key: you configure one (or two) provider API
keys in Settings and all model traffic goes directly from your browser to that
provider. Provider behavior, pricing, quotas, data retention, and rate limits
are governed by the provider you select.

## Provider matrix

This table stays aligned with `UserSettings["providerMode"]` and the Settings
UI.

| Provider mode | Required key(s) | Role | Status | Notes |
| --- | --- | --- | --- | --- |
| `fireworks` | Fireworks key | Executor and planner | Recommended default | Current docs and E2E default use Fireworks. |
| `openrouter` | OpenRouter key | Executor and planner | Supported | Model availability depends on OpenRouter. |
| `moonshot` | Kimi key | Executor and planner | Supported | Direct Moonshot/Kimi provider mode. |
| `xiaomi` | Xiaomi key | Executor and planner | Supported | Xiaomi MiMo support is scoped to the agent provider stack. |
| `fireworks-deepseek` | Fireworks + DeepSeek keys | Fireworks executor, DeepSeek planner/verifier | Advanced | Requires two configured keys. |
| `openrouter-groq` | OpenRouter + Groq keys | OpenRouter executor, Groq planner | Advanced | Two keys; faster planning inference. |
| `openai-groq` | OpenAI-compatible + Groq keys | OpenAI-compatible executor, Groq planner | Advanced | Two keys. |

## What gets sent to the provider

When a task needs it, page context (element lists, extracted text) and
screenshots may be sent to the selected model provider. Nothing is sent
anywhere else: there is no telemetry, no hosted relay, and no backend.

## Failure expectations

- **Invalid key** — requests fail immediately; the side panel surfaces the
  provider error.
- **Quota exhausted / rate limit** — the client retries with backoff and fails
  over between configured pools where possible; persistent 429s surface as a
  task error.
- **Model unavailable / provider outage** — the executor falls back to its
  configured fallback model; if the provider is fully down the task fails with
  the provider's error message.
