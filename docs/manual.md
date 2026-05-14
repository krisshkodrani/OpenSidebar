# User Manual

This manual covers the active OpenSidebar product surface.

## Side Panel

The side panel is the main interface.

- Enter a task in plain language
- Review streamed progress and intermediate steps
- Send feedback while the agent is running
- Stop the run at any time

## Settings

The Settings drawer controls:

- provider keys
- model routing
- unified vision
- voice input and output
- safety and interaction mode

## Interaction Modes

OpenSidebar supports configurable confirmation behavior:

- ask before acting
- ask for risky actions
- confirm plans only
- act without asking

## Agent Flow

For each task, the runtime can:

1. inspect the current page
2. decide whether to execute directly or plan
3. run browser tools
4. verify progress
5. continue, retry, reroute, or finish

## Logs and Traces

If you run the local dev stack, OpenSidebar records traces and structured logs for debugging.

```bash
pnpm run dev
```

Open the trace viewer at `http://127.0.0.1:7589/viewer`.

## E2E and Development

For development workflows, see:

- [Getting Started](./getting-started.md)
- [Developer Guide](./developer-guide.md)
- [Architecture Overview](./architecture/overview.md)
