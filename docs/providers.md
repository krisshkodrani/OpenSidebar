# OpenRouter inference

OpenSidebar uses OpenRouter exclusively for model calls, including browser-agent
seats, profile-note analysis and development/review tools. Model vendor names
identify models; they do not select a direct vendor API or a separate billing key.

In local mode the OpenRouter key stays in Chrome local storage, never sync storage.
In cloud mode the account explicitly saves an OpenRouter key in its KMS-encrypted
vault. Requests stream through the account-scoped relay. Other accounts cannot use
that credential. Request content is transient; aggregate usage is retained.

Audio input, tab-audio transcription and text-to-speech are removed. No Groq
credential or audio capture permission is required.

## Migration

Old direct-provider preferences reset to OpenRouter defaults, including model
seats and upstream pins. Valid OpenRouter selections remain. Old LLM credentials
are removed from active browser and cloud storage; they are never reused as an
OpenRouter key. Missing keys stop tasks with setup guidance. Older cloud clients
requesting a retired provider must update. Historical traces and billing records
retain their original provider identity.

## Spending and development

Use one OpenSidebar OpenRouter key across your development tools and your own
account connection. Configure a monthly limit at OpenRouter; reaching the limit
must not switch keys or providers. Development runners default to OpenRouter and
reject direct-provider selections. `pnpm models:check -- --provider=openrouter`
checks catalog compatibility; `--probe` explicitly enables paid test requests.
