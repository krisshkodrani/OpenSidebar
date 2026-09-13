# Roadmap

A living, high-level view of where OpenSidebar is headed. It is intentionally
short and honest — dates are deliberately omitted, and nothing here is a
promise. For day-to-day work, see the open [issues](https://github.com/krisshkodrani/OpenSidebar/issues)
and the RFCs under [`docs/engineering/`](docs/engineering/).

## Near term

- **Unified OpenSidebar web app and encrypted Viewer.** Account, settings,
  sessions, Playground controls, and Viewer are converging under one Chakra UI
  `/app` shell. Local frozen-trace import and the client-side E2EE contract are
  implemented; PostgreSQL/S3 trace retention and extension upload remain behind
  disabled, named-tester-only flags. A persistent ciphertext upload queue now
  supports pause, retry, and per-trace local-only exclusion; recovery/deletion
  acceptance remains before activation.

- **Cloud BYOK testing.** Roll out encrypted account-held provider credentials,
  safe preference sync, and the non-retaining relay to a few named testers
  before widening access.
- **PostgreSQL cloud durability.** Encrypted retention/export/deletion,
  portable restore, and reconnect/device-handoff durability now pass local,
  published-client reconnect/takeover UX, real two-profile Chrome, and
  exact-host PostgreSQL acceptance behind disabled flags. Bounded text and
  locally approved, postcondition-verified clicks now pass; staged named-tester
  activation and any future non-click sensitive actions remain.
  Temporal is parked research and has no active server or production role.
  Default-off staged activation and a dedicated named-tester allowlist are now
  implemented; the next step is an owner-approved internal activation and soak.
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
