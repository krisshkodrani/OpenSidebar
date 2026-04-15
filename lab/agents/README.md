# Lab Agents

The lab uses two agent systems with different jobs:

- **Hermes** is the research worker
- **GBrain** is the local knowledge store

If you remember one rule from this file, make it this:

> Use the OpenSidebar lab wrappers first. Do not reach into the vendored agent
> repos unless you are actively debugging the lab itself.

## Roles

### Hermes

Hermes is the research-side agent.

In this repo it is used for:

- ad hoc research notes
- summarization of existing lab material
- skill-candidate analysis
- trace-driven synthesis

OpenSidebar runs Hermes through `lab:research` and related wrappers. That is the
supported interface.

### GBrain

GBrain is the persistence layer.

In this repo it is used for:

- indexing lab markdown
- making prior notes searchable
- serving that knowledge through MCP

The key point is that Hermes produces findings, but GBrain is what makes those
findings reusable later.

## How They Fit Together

```text
Question or trace pathology
        ->
Hermes wrapper runs research
        ->
Result is saved as markdown
        ->
GBrain indexes the markdown
        ->
Later sessions can search and reuse it
```

That separation is intentional:

- Hermes is for generation and synthesis
- GBrain is for storage and retrieval

## Recommended Usage

You usually do not need more than these:

### Verify The Agent Environment

```bash
npm run lab:doctor
```

Use this first if anything feels off.

It verifies that:

- Hermes is callable
- GBrain is available
- required API keys exist
- the local brain is initialized

### Run A Research Pass Through Hermes

```bash
npm run lab:research -- "Compare the current workflow-skills roadmap to recent trace failures."
```

Use this when you want a one-off research answer in the terminal.

### Save And Index A Durable Research Note

```bash
npm run lab:research -- --save skills-vs-traces "Compare the current workflow-skills roadmap to recent trace failures."
```

Use this when the result should become a real lab artifact.

### Re-index The Knowledge Base

```bash
npm run lab:index
```

Use this after manually editing notes, RFCs, or other indexed content.

## Research Modes

`lab:research` supports two modes:

### `--mode local`

Repo-grounded synthesis.

Best for:

- summarizing existing lab material
- comparing current repo artifacts
- turning local notes into a clearer brief

### `--mode external`

Research questions that need outward-looking investigation.

Best for:

- state-of-the-art scans
- vendor capability research
- product or ecosystem comparisons

This distinction matters because local summarization and true external research
are not the same job.

## MCP Surface

GBrain is exposed through MCP and is already wired in the repo-level
[.mcp.json](../../.mcp.json).

That means the coding agent can query the indexed knowledge base without
re-parsing every markdown file by hand.

Current MCP wiring:

```json
{
  "mcpServers": {
    "gbrain": {
      "command": "bun",
      "args": ["run", "lab/bin/gbrain-mcp.ts"],
      "env": {
        "OPENAI_API_KEY": "${OPENAI_API_KEY}"
      }
    }
  }
}
```

## Model Notes

Hermes defaults to **Kimi K2.5 via Fireworks** when `FIREWORKS_API_KEY` is
available.

The lab wrapper can also fall back to other configured providers, but the
important thing for operators is simpler:

- do not assume every run uses the exact same provider
- do assume the wrapper chooses and configures the model profile

GBrain is different:

- it is not the research model
- it is the indexing and retrieval layer
- the pinned setup in this repo currently relies on `OPENAI_API_KEY` for parts
  of its embedding/query flow

## When To Open The Vendored Repos

Only go into:

- `lab/agents/hermes/repo/`
- `lab/agents/gbrain/repo/`

when you are doing one of these:

- debugging wrapper behavior
- updating the pinned integration
- checking upstream implementation details

Do not use those repos as the normal operator interface.

## Related Files

- [../README.md](../README.md)
- [../examples/README.md](../examples/README.md)
- [../questions/README.md](../questions/README.md)
