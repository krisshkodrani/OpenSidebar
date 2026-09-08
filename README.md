<p align="center">
  <img src="OpenSidebar.png" alt="OpenSidebar" width="128" />
</p>

<h1 align="center">OpenSidebar</h1>

<p align="center">
  An open-source AI agent in your Chrome side panel.<br />
  Describe a task; it sees the page, clicks, types, and carries work across tabs.
</p>

<p align="center">
  <a href="https://opensidebar.com"><img src="https://img.shields.io/badge/site-opensidebar.com-4FC3F7" alt="Website" /></a>
  <a href="https://github.com/krisshkodrani/OpenSidebar/actions/workflows/ci.yml"><img src="https://github.com/krisshkodrani/OpenSidebar/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen" alt="Node.js" /></a>
</p>

<p align="center">
  <a href="https://opensidebar.com/#showcase"><b>Customer tour</b></a> ·
  <a href="https://opensidebar.com/#developers"><b>Developer tour</b></a> ·
  <a href="#install-from-source">Install</a> ·
  <a href="docs/getting-started.md">Docs</a> ·
  <a href="CONTRIBUTING.md">Contribute</a>
</p>

<p align="center">
  <img src="docs/assets/opensidebar-1.png" alt="OpenSidebar side panel running a browser task" width="820" />
</p>

## For people who want work done

OpenSidebar can:

- complete multi-step browser tasks such as forms, checkouts, and cross-page research;
- read information on one page and use it on another;
- watch a page and report when something changes;
- pause before consequential actions so you can review them;
- use OpenRouter by default, or the supported Fireworks stack.

It is bring-your-own-key software: there is no OpenSidebar subscription,
hosted model relay, analytics client, or first-party telemetry upload endpoint
in the published build. Optional reliability summaries stay local in Chrome.
Page context goes only to the model provider you configure. See
[Privacy](PRIVACY_POLICY.md), [Security](SECURITY.md), and
[Known limitations](docs/known-limitations.md) before using it on sensitive
sites.

Watch the concise [customer tour](https://opensidebar.com/#showcase).

## Install

Install the signed release from the
[Chrome Web Store](https://chromewebstore.google.com/detail/opensidebar/hakbnbbkiehiofnafdkcibbnkbdmjiha),
or build the current source locally:

```bash
git clone https://github.com/krisshkodrani/OpenSidebar.git
cd OpenSidebar
corepack enable
corepack pnpm install
corepack pnpm run dist
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load
unpacked**, and select `dist/`. Open the side panel and add an OpenRouter key
in Settings (recommended), or use the supported Fireworks stack. The current
provider matrix is maintained in [docs/providers.md](docs/providers.md).

## For developers

OpenSidebar is a Manifest V3 extension with a boundary-first runtime:

- `apps/extension/src/background` contains orchestration, the agent loop,
  browser tools, checkpoints, skills, and model clients.
- `apps/extension/src/content` contains the page bridge and content script.
- `apps/extension/src/sidepanel` contains the environment-agnostic React UI.
- `apps/extension/src/overlay` provides the reusable in-page test harness.
- `apps/extension/src/trace-viewer` provides local run replay and analysis.
- `apps/extension/tests` contains focused runtime tests and browser E2E coverage.

The planner, executor, verifier, and optional judge have distinct roles. Runs
produce inspectable evidence: plans, actions, verification, approvals, and cost
remain attached to the task. Watch the
[developer tour](https://opensidebar.com/#developers), then read the
[architecture overview](docs/architecture/overview.md) and
[runtime boundaries](docs/architecture/runtime-boundaries.md).

The release-verified BYOK modes are OpenRouter (recommended and default) and
Fireworks.

### Development

Use the Corepack-managed pnpm version pinned by the repository:

```bash
corepack enable
corepack pnpm install
pnpm run dev
```

`pnpm run dev` keeps a loadable development extension in `dist-dev/` and serves
the local trace viewer at `http://127.0.0.1:7589/viewer`. Reload the unpacked
extension after a build; use `pnpm run dev:hmr` when you only need fast
side-panel UI iteration.

Common checks:

```bash
pnpm test
pnpm run lint
pnpm run typecheck
pnpm run verify
pnpm run release:verify
pnpm run release:package
```

Browser E2E runs are staged from cheaper, high-signal checks to harder runtime
work:

```bash
pnpm run test:e2e:smoke
pnpm run test:e2e:interactions
pnpm run test:e2e:runtime
pnpm run test:e2e
```

Generated reports and release media belong under `.artifacts/`; stable product
and engineering documentation belongs under `docs/`.

## Contributing

Start with the [contributing guide](CONTRIBUTING.md). It explains the preferred
change seams, owner- and RFC-gated areas, testing expectations, and pull request
template. Before opening a PR, run:

```bash
pnpm run verify
```

Normal CI runs on pull requests with read-only repository permissions and no
provider API keys. AI review is never automatic; only a maintainer can request
it. For vulnerabilities, follow the private-reporting guidance in
[SECURITY.md](SECURITY.md) rather than publishing sensitive details in an issue
or pull request.

## Observability

Every agent session can be inspected locally:

```bash
pnpm run dev
```

Open `http://127.0.0.1:7589/viewer`. The viewer replays the plan, turns, browser
actions, verification, judge evidence, and cost. Read the
[trace viewer architecture](docs/architecture/trace-viewer.md) for storage,
retention, adjudication, and maintenance commands.

## Documentation

- [Getting started](docs/getting-started.md)
- [Contributing](CONTRIBUTING.md)
- [Developer guide](docs/developer-guide.md)
- [Architecture overview](docs/architecture/overview.md)
- [Runtime boundaries](docs/architecture/runtime-boundaries.md)
- [Agent loop](docs/architecture/agent-loop.md)
- [Tools reference](docs/features/tools.md)
- [Personal profile](docs/personal-profile.md)
- [Providers](docs/providers.md)
- [Release checklist](docs/release-checklist.md)
- [Roadmap](docs/roadmap.md)
- [Engineering RFCs](docs/engineering/rfcs/README.md)
- [Security policy](SECURITY.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)

## License

MIT. See [LICENSE](LICENSE).
