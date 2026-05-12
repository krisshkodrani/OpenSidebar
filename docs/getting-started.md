# Getting Started

Get OpenSidebar running in a few minutes.

## Prerequisites

- Node.js 18+
- Google Chrome
- A supported provider API key

## Install

```bash
git clone https://github.com/krisshkodrani/OpenSidebar.git
cd OpenSidebar
npm install
npm run dist
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

Supported agent provider keys include Fireworks AI, OpenRouter, Moonshot/Kimi, and Xiaomi MiMo. For Xiaomi MiMo E2E runs, set `E2E_PROVIDER=xiaomi` and provide `XIAOMI_API_KEY` in your shell or repo-local `.env`.

## First Task

Try one of these:

- "Summarize this page"
- "Find the pricing page and tell me the monthly cost"
- "Fill in the contact form with John Smith and john@example.com"

## Development Mode

```bash
npm run dev
```

This starts:

- the local server/backend/log server
- the trace viewer at `http://127.0.0.1:7589/viewer`
- the Vite/CRXJS dev process
- a loadable dev extension under `dist-dev/`

When the shell prints the CRXJS instruction, load `dist-dev/` in `chrome://extensions/` and keep `npm run dev` running. For a standalone build that does not depend on the dev server, run `npm run dist` and load `dist/`.

## Trace Maintenance

The trace viewer reads `.artifacts/trace-index.sqlite`. Recent raw JSONL,
screenshots, and session logs stay in `traces/` and `logs/` for local debugging,
with a default 7-day raw-file window.

```bash
npm run traces:index                # backfill or repair SQLite
npm run traces:delete-old           # dry run; raw files older than 7 days
npm run traces:delete-old -- --apply # delete old raw files after SQLite coverage check
npm run traces:compact              # index, then delete old raw files
```

## Next Steps

- [Architecture Overview](./architecture/overview.md)
- [Tools Reference](./features/tools.md)
- [Developer Guide](./developer-guide.md)
