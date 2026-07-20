# Documentation

This index lists stable repo documentation. Active RFCs live in [docs/engineering/rfcs/](./engineering/rfcs/README.md); archived trace-viewer RFCs in [docs/rfcs/](./rfcs/README.md).

## Getting Started

- [Getting Started](./getting-started.md)
- [User Manual](./manual.md)
- [Prompt Tips](./guides/prompt-tips.md)

## Architecture

- [Overview](./architecture/overview.md)
- [AI Architecture Overview](./architecture/ai-architecture-overview.html)
- [Agent Loop](./architecture/agent-loop.md)
- [Orchestrator](./architecture/orchestrator.md)
- [First-Class Parallel Work Roadmap](./architecture/parallel-work-roadmap.md)
- [Skill Routing Without Prompt Bloat](./architecture/skill-routing-without-prompt-bloat.md)
- [Content Script](./architecture/content-script.md)
- [Runtime Boundaries](./architecture/runtime-boundaries.md)
- [Perception Layer](./architecture/perception-layer.md)
- [Message Protocol](./architecture/message-protocol.md)
- [Navigation Bridge](./architecture/navigation-bridge.md)
- [Side Panel UI](./architecture/sidepanel-ui.md)
- [Tools](./architecture/tools.md)
- [Trace Viewer](./architecture/trace-viewer.md)
- [Types Reference](./architecture/types-reference.md)
- [Project Setup](./architecture/project-setup.md)

## Features

- [Agent Capabilities](./features/agent-capabilities.md)
- [Browser Automation](./features/browser-automation.md)
- [Tools Reference](./features/tools.md)
- [Workspace Management](./features/workspace-management.md)
- [Security](./features/security.md)
- [Streaming UI](./features/streaming-ui.md)

## Observability & Trace Viewer

Every run leaves evidence: full-fidelity local traces you can replay, judge, and
adjudicate. Read in this order to learn the harness:

1. [Trace Viewer AI Concepts](./guides/trace-viewer-ai-concepts.md) — the agent concepts the viewer makes observable
2. [Trace Viewer Architecture](./architecture/trace-viewer.md) — how the harness is structured: pipeline, log-server API, app layout, adjudication flow
3. [Trace Viewer Developer Workflow](./guides/trace-viewer-developer-workflow.md) — debugging a failing run, from the Attention inbox to a verdict
4. [Metric Semantics](./architecture/trace-viewer-metric-semantics.md) — pinned definitions behind the investigation metrics
5. [Observability & Retention](./architecture/trace-viewer-observability.md) — storage tiers, SQLite index, retention commands

One-pagers: [Investigation Loop](./guides/trace-viewer-investigation-loop.html) · [Observability for Harness Engineering](./guides/trace-viewer-observability.html)

## Guides

- [Developer Guide](./developer-guide.md)
- [Personal Profile](./personal-profile.md)
- [Repo Structure](./repo-structure.md)
- [Release Checklist](./release-checklist.md)
- [OSS BYOK Launch Roadmap](./oss-byok-launch-roadmap.md)
- [Known Limitations](./known-limitations.md)
- [Browser Navigation Challenge](./guides/browser-navigation-challenge.md)
- [The Right Level Of Abstraction](./guides/right-level-of-abstraction.md)
- [WorkArena Generalized Harness Philosophy](./guides/workarena-generalized-harness-philosophy.md)

## Evaluations

- [WorkArena Setup](./evals/workarena.md)
- [WorkArena Roadmap](./evals/workarena-roadmap.md)
- [WorkArena First Smoke Test Checklist](./evals/workarena-smoke-test-checklist.md)
- [WorkArena Major Full Run Checklist](./evals/workarena-full-run-checklist.md)

## Other

- [Documentation Policy](./docs-policy.md)
- [Design System](./design-system.md)
- [Store Listing](./store-listing.md)
- [Privacy Policy](../PRIVACY_POLICY.md)
- [Security Policy](../SECURITY.md)

## Notes

- E2E reports are generated locally under `.artifacts/e2e/`.
- Active RFCs live in [docs/engineering/rfcs/](./engineering/rfcs/README.md) and follow the [RFC Decision Process](./engineering/rfc-decision-process.md).
