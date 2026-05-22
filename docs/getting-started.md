# Getting Started

Get OpenSidebar running in a few minutes.

## Prerequisites

- Node.js 22+
- Google Chrome
- A supported provider API key

## Install

```bash
git clone https://github.com/krisshkodrani/OpenSidebar.git
cd OpenSidebar
corepack enable
corepack pnpm install
corepack pnpm run dist
```

## Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist/` folder

## Configure

1. Open the side panel
2. Open **Settings**
3. Add the provider key you want to use
4. Close Settings

Supported agent provider modes include Fireworks AI, OpenRouter, Moonshot/Kimi, Xiaomi MiMo, and advanced mixed-provider modes such as Fireworks+DeepSeek or OpenRouter+Groq. For Xiaomi MiMo E2E runs, set `E2E_PROVIDER=xiaomi` and provide `XIAOMI_API_KEY` in your shell or repo-local `.env`.

| Provider mode | Required key(s) | Notes |
| --- | --- | --- |
| Fireworks | `FIREWORKS_API_KEY` or Fireworks key in Settings | Recommended default |
| OpenRouter | `OPENROUTER_API_KEY` or OpenRouter key in Settings | Public BYOK option |
| Moonshot/Kimi | `KIMI_API_KEY` or Kimi key in Settings | Direct Moonshot provider mode |
| Xiaomi MiMo | `XIAOMI_API_KEY` or Xiaomi key in Settings | Agent traffic only |
| Fireworks + DeepSeek | Fireworks key plus `DEEPSEEK_API_KEY` or both keys in Settings | Fireworks executor, DeepSeek planner/verifier |
| OpenRouter + Groq | OpenRouter key plus Groq key in Settings | OpenRouter executor, Groq planner |
| OpenAI-compatible + Groq | OpenAI-compatible key plus Groq key in Settings | Advanced executor/planner split |

Provider pricing, quotas, data handling, and rate limits are governed by the provider you configure.

## First Safe Task

Start with a read-only task on a non-sensitive page:

- "Summarize this page"
- "Find the pricing page and tell me the monthly cost"

Watch the side panel while the agent works. Use **Stop** if it starts doing
something unexpected. After you trust the setup, move to low-impact interaction
tasks such as test forms or disposable demo accounts before using sensitive
websites.

Common provider setup failures:

| Symptom | Likely cause |
| --- | --- |
| Authentication error | Missing, invalid, or revoked provider key |
| Rate-limit or quota error | Provider account limit, billing state, or model quota |
| Model unavailable | Provider routing issue or unsupported configured model |
| Empty or degraded responses | Temporary provider outage or a model that does not support the requested modality |

## Development Mode

Most local development uses five commands:

```bash
pnpm run dev      # start the local app stack
pnpm run dist     # build the standalone unpacked extension
pnpm test         # run fast tests
pnpm run verify   # run the full local confidence gate
pnpm run doctor   # diagnose local setup
```

These commands assume `corepack enable` has activated the pnpm version pinned in `package.json`. Use `corepack pnpm ...` if pnpm is not on your shell path.

```bash
pnpm run dev
```

This starts:

- the local server/backend/log server
- the trace viewer at `http://127.0.0.1:7589/viewer`
- the Vite/CRXJS dev process
- a loadable dev extension under `dist-dev/`

When the shell prints the CRXJS instruction, load `dist-dev/` in `chrome://extensions/` and keep `pnpm run dev` running. For a standalone build that does not depend on the dev server, run `pnpm run dist` and load `dist/`.

## Trace Maintenance

The trace viewer reads `.artifacts/trace-index.sqlite`. Recent raw JSONL,
screenshots, and session logs stay in `traces/` and `logs/` for local debugging,
with a default 7-day raw-file window.

```bash
pnpm run traces:index                # backfill or repair SQLite
pnpm run traces:delete-old           # dry run; raw files older than 7 days
pnpm run traces:delete-old -- --apply # delete old raw files after SQLite coverage check
pnpm run traces:compact              # index, then delete old raw files
```

## Next Steps

- [Architecture Overview](./architecture/overview.md)
- [Tools Reference](./features/tools.md)
- [Developer Guide](./developer-guide.md)
