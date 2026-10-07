# Getting Started

Get OpenSidebar running in a few minutes.

## Prerequisites

- Node.js 22+
- Google Chrome
- An OpenRouter API key with available credit

## Install

```bash
git clone https://github.com/krisshkodrani/OpenSidebar.git
cd OpenSidebar
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm run dist
```

## Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist/` folder

## Configure

1. Open the side panel and **Settings**.
2. Under **Advanced → Connections**, enter your OpenRouter API key and save
   the settings. New installations use direct inference by default. If you
   previously enabled Cloud mode, switch **Account → Connection method** to
   **Direct from this browser**. This path does not require an
   OpenSidebar account or a local backend.
3. Keep the default models initially. All model calls use OpenRouter; vendor
   model names do not require separate vendor keys.
4. Alternatively, sign in under **Account**, connect OpenRouter through the
   account website, and explicitly select account-backed inference. Cloud mode
   requires the hosted service and processes requests through its relay.

The extension does not read your repository `.env` for normal tasks. The
`OPENROUTER_API_KEY` environment variable is for local test/development tools.
Do not commit a key. Set a spending limit on the key in OpenRouter.

Only OpenRouter is supported. Old Fireworks and mixed-provider setup instructions
apply to historical releases, not this source tree. Provider pricing, quotas,
and retention are governed by OpenRouter and the selected upstream model provider.
See [Providers](providers.md) and [Privacy](../PRIVACY_POLICY.md).

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
