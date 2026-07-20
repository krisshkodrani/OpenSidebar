# Roadmap

A living, high-level view of where OpenSidebar is headed. It is intentionally
short and honest — dates are deliberately omitted, and nothing here is a
promise. For day-to-day work, see the open [issues](https://github.com/krisshkodrani/OpenSidebar/issues)
and the RFCs under [`docs/engineering/`](docs/engineering/).

## Near term

- **Chrome Web Store listing.** A signed, one-click install so you don't have to
  build from source. Until it lands, the [Quick Start](README.md#quick-start) is
  the way in.
- **Benchmarks, with receipts.** Neutral, reproducible numbers published
  alongside the per-task judge output that produced them — not a headline figure
  on its own.
- **Wider provider coverage.** More presets in the BYOK matrix and clearer
  per-provider expectations. See [`docs/providers.md`](docs/providers.md).

## In progress

- **Perception depth.** Better handling of the pages that still trip up browser
  agents — cross-origin iframes and heavier canvas/shadow-DOM widgets.
- **More site skills and adapters.** The ServiceNow adapter is the template; the
  goal is to make teaching the agent a new app (yours included) a smaller lift.
- **Observability.** Continued work on the trace viewer — aggregate success and
  cost views across runs, and human adjudication of judged completions.

## Exploring

- **PDF and document understanding** inside the agent loop (currently parked).
- **Deeper external-agent integration** via the optional browser bridge
  (default-off today): pi drives it directly; MCP clients connect via the
  browser MCP host.

## Contributing

Good first issues are labeled
[`good first issue`](https://github.com/krisshkodrani/OpenSidebar/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.
