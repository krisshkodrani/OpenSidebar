# Documentation

## Start Here

- [Getting Started](./getting-started.md) — install, configure, first task
- [Architecture Overview](./architecture/overview.md) — how the system works
- [Developer Guide](./developer-guide.md) — testing, debugging, prompt workflow
- [Evals Guide](./guides/evals-program.md) — golden cases and critique pipeline

## Reference

- [Tools Reference](./features/tools.md) — all 38 browser tools
- [Security](./features/security.md) — risk classification, URL sanitization, approvals
- [Store Listing](./store-listing.md) — Chrome Web Store copy

## Architecture Deep Dives

- [Agent Loop](./architecture/agent-loop.md) — LLM-tool cycle, escalation, stagnation
- [Content Script](./architecture/content-script.md) — DOM tagging, snapshots, actions
- [Perception Layer](./architecture/perception-layer.md) — VLM page interpretation
- [Message Protocol](./architecture/message-protocol.md) — cross-context messaging
- [Navigation Bridge](./architecture/navigation-bridge.md) — cross-page state persistence
- [Side Panel UI](./architecture/sidepanel-ui.md) — React components, Zustand store
- [Types Reference](./architecture/types-reference.md) — full type catalog

## Guides

- [Prompt Tips](./guides/prompt-tips.md) — writing effective agent prompts
- [Manual Evals Runbook](./guides/manual-evals-runbook.md) — hands-on evaluation

## Structure

```
docs/
  architecture/     System design and component ownership
  features/         User-facing capability docs
  guides/           Runbooks and operating guides
  rfc/              Design proposals (historical + active)
  articles/         Longer-form writeups
  assets/           Screenshots and media
  archive/          Historical plans, research, and superseded docs
```

## Release Notes

- [0.7.0 (2026-04-02)](./release-notes-2026-04-02.md)
