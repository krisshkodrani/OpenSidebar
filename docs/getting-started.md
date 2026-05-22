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
pnpm install
pnpm run dist
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

Supported agent provider modes include Fireworks AI, OpenRouter, Moonshot/Kimi, Xiaomi MiMo, and advanced mixed-provider modes such as Fireworks+DeepSeek. For Xiaomi MiMo E2E runs, set `E2E_PROVIDER=xiaomi` and provide `XIAOMI_API_KEY` in your shell or repo-local `.env`.

| Provider mode | Required key(s) | Notes |
| --- | --- | --- |
| Fireworks | `FIREWORKS_API_KEY` or Fireworks key in Settings | Recommended default |
| OpenRouter | `OPENROUTER_API_KEY` or OpenRouter key in Settings | Public BYOK option |
| Moonshot/Kimi | `KIMI_API_KEY` or Kimi key in Settings | Direct Moonshot provider mode |
| Xiaomi MiMo | `XIAOMI_API_KEY` or Xiaomi key in Settings | Agent traffic only |
| Mixed advanced modes | Fireworks/OpenRouter/OpenAI-compatible key plus DeepSeek or Groq key | For advanced provider routing |

Provider pricing, quotas, data handling, and rate limits are governed by the provider you configure.

## First Task

Try one of these:

- "Summarize this page"
- "Find the pricing page and tell me the monthly cost"
- "Fill in the contact form with John Smith and john@example.com"

## Development Mode

Most local development uses five commands:

```bash
pnpm run dev      # start the local app stack
pnpm run dist     # build the standalone unpacked extension
pnpm test         # run fast tests
pnpm run verify   # run the full local confidence gate
pnpm run doctor   # diagnose local setup
```

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
