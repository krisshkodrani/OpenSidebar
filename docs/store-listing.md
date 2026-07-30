# Chrome Web Store listing

Copy-ready customer material for the Chrome Web Store listing. Privacy-tab
answers live in [store-privacy-answers.md](store-privacy-answers.md).

The store listing must show the shipping extension only. Developer tooling,
including the trace viewer, belongs in the repository and developer tour rather
than in store screenshots.

## Listing metadata

| Field | Value |
| --- | --- |
| Name | OpenSidebar |
| Category | Productivity → Tools |
| Language | English |
| Homepage URL | https://opensidebar.com |
| Support URL | https://github.com/krisshkodrani/OpenSidebar/issues |
| Privacy policy URL | https://github.com/krisshkodrani/OpenSidebar/blob/main/PRIVACY_POLICY.md |
| Pricing | Free |

## Short description

This must remain at or below 132 characters and match the extension manifest.

```text
Open-source AI browser agent. Navigate, click, type, and automate web tasks from a side panel with your own provider key.
```

## Full description

```text
Describe the result you want and OpenSidebar works through the browser task from
your Chrome side panel.

It can click, type, scroll, read information across pages, complete multi-step
forms, and watch a page for changes. You see the work as it happens and can pause
or stop it at any time.

WHAT IT CAN DO

- Complete multi-step tasks such as forms, checkouts, and cross-page research
- Read information on one page and use it on another
- Work from both the live screenshot and page structure
- Manage tabs and windows, upload and download files, and extract structured data
- Plan harder tasks step by step and verify the result
- Watch a page and tell you when something changes

YOU STAY IN CONTROL

- Choose how often OpenSidebar asks before acting
- Require approval for consequential actions
- Review the agent's progress and guide, pause, or stop it
- Keep drafts unsent and purchases unconfirmed until you approve

BRING YOUR OWN KEY

- Use a supported provider and models you configure
- Your key stays in Chrome storage
- Page context goes only to the provider you choose
- No analytics, tracking, hosted relay, or OpenSidebar backend

OpenSidebar is free and open source under the MIT licence.

Browser agents can make mistakes or misread page state. Start on trusted sites
and review consequential actions.
```

## Customer video

The store video is:

```text
.artifacts/publish/opensidebar-customer-60s-british-female.mp4
```

It is a 58-second customer overview with a British female voice. Publish it to
the project's video channel and add that public video URL to the store listing.
Do not use the developer tour for the store listing.

## Graphics

Generate the upload-ready images:

```bash
node scripts/build-store-assets.mjs
```

Output is written to `.artifacts/store/`:

- `screenshot-1.png` — the side-panel agent completing a task
- `screenshot-2.png` — reading one page and writing into another
- `screenshot-3.png` — provider and model settings
- `screenshot-4.png` — Watch Mode reporting a page change
- `promo-tile.png` — 440×280
- `marquee.png` — 1400×560

Each screenshot is 1280×800. Trace-viewer and run-analytics images are
deliberately excluded because they are developer tooling, not part of the
shipping store extension.
