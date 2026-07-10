# Chrome Web Store Listing - OpenSidebar

Copy-ready reference for the CWS "Store listing" tab. The privacy-tab answers
(single purpose, permission justifications, data disclosures) live in
[store-privacy-answers.md](./store-privacy-answers.md).

## Listing Metadata

| Field | Value |
| --- | --- |
| Name | OpenSidebar |
| Category | Productivity → Tools |
| Language | English |
| Homepage URL | https://github.com/krisshkodrani/OpenSidebar |
| Support URL | https://github.com/krisshkodrani/OpenSidebar/issues |
| Privacy policy URL | https://github.com/krisshkodrani/OpenSidebar/blob/main/PRIVACY_POLICY.md |
| Pricing | Free |
| Graphics | icon 128×128 (shipped in package) · screenshots 1280×800 · small promo tile 440×280 · marquee 1400×560 — generate with `node scripts/build-store-assets.mjs` → `.artifacts/store/` |

## Short Description

Must stay ≤ 132 characters and should match the manifest `description`.

```text
Open-source AI browser agent. Navigate, click, type, and automate web tasks from a side panel with your own provider key.
```

## Full Description

```text
OpenSidebar puts an autonomous AI agent in your Chrome side panel. Describe a task in plain English and it sees the page, clicks, types, and carries multi-step work across tabs to done.

Bring your own API key. No subscription, no telemetry, no backend — everything runs in your browser.

WHAT IT CAN DO

- Complete real tasks end to end: shopping checkouts, job applications, multi-step wizards, reading data on one page to write on another
- See the page like you do: the agent works from the live screenshot plus the page structure, so it reads charts, zooms into fine print, and handles pages that defeat text-only bots
- Use 52 browser tools: clicking, typing, and scrolling, but also file upload and download, tab and window management, and structured table, chart, and filter extraction
- Plan, execute, and verify: a planner breaks hard tasks into steps, an executor drives each one, and a verifier confirms completion before moving on

YOU STAY IN CONTROL

- Four approval modes, from ask-before-every-action to fully autonomous
- Consequential actions pause for your approval; form submits are dry-run first so you approve the exact field values before anything is sent
- Pause, guide, or stop the agent at any time
- See each step, decision, and token usage as the agent works; for developers, the open-source repo adds a full observability workspace

PRIVATE BY DESIGN

- Bring your own key: Fireworks (recommended), OpenRouter, Moonshot/Kimi, or Xiaomi MiMo
- Your API key stays in Chrome storage; page context goes only to the provider you configure
- No analytics, no tracking, no hosted relay, no OpenSidebar servers
- Optional local memory: a personal profile you review yourself, with sensitive fields consent-gated and encrypted

SAFETY NOTES

Browser AI can still make mistakes or misread page state. Start with trusted sites, review sensitive actions, and use the approval modes for anything consequential.

Open source (MIT). Audit every claim: https://github.com/krisshkodrani/OpenSidebar
```
