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
3. Add the provider key or key combination you want to use
4. Choose one of the provider stacks unlocked by those keys
5. Save changes

Settings exposes the two release-verified provider modes: OpenRouter and
Fireworks AI. Experimental adapters may still be used by internal evaluation
commands, but are not part of the supported setup surface.

| Provider mode | Required key(s)                         | Notes                                    |
| ------------- | --------------------------------------- | ---------------------------------------- |
| OpenRouter    | `OPENROUTER_API_KEY` or key in Settings | Recommended; live verified model list    |
| Fireworks     | `FIREWORKS_API_KEY` or key in Settings  | Curated compatibility-checked model list |

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

| Symptom                     | Likely cause                                                                      |
| --------------------------- | --------------------------------------------------------------------------------- |
| Authentication error        | Missing, invalid, or revoked provider key                                         |
| Rate-limit or quota error   | Provider account limit, billing state, or model quota                             |
| Model unavailable           | Provider routing issue or unsupported configured model                            |
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
- the trace viewer at `http://127.0.0.1:7589/viewer` (works from the first run)
- a Vite watch build (`--mode e2e`) that keeps a complete `dist-dev/` on disk
- a loadable dev extension under `dist-dev/`

Once the first build finishes, load `dist-dev/` in `chrome://extensions/` and keep `pnpm run dev` running. There is no HMR — after a source change the watch build rebuilds `dist-dev/`; reload the unpacked extension and refresh the viewer. If you want fast sidepanel React hot-swap, use `pnpm run dev:hmr` instead (the trace viewer then stays static until the next `pnpm run build:e2e`). For a standalone build that does not depend on the dev stack, run `pnpm run dist` and load `dist/`.

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
