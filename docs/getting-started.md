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
npm run build
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

- the extension build
- the local log server
- the trace viewer at `http://127.0.0.1:7589/viewer`

## Next Steps

- [Architecture Overview](./architecture/overview.md)
- [Tools Reference](./features/tools.md)
- [Developer Guide](./developer-guide.md)
