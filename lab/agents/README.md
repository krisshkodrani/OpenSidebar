# Lab Agents

Two agents power the OpenSidebar laboratory.

## Quick Start

```bash
# 1. API keys are in the project root .env file (FIREWORKS_API_KEY, OPENROUTER_API_KEY)
#    The setup script sources .env automatically.

# 2. Install Hermes Agent
cd lab/agents/hermes/repo
pip install -e .
hermes model set fireworks/accounts/fireworks/models/kimi-k2.5

# 3. Install GBrain
cd lab/agents/gbrain/repo
bun install
bun run build

# 4. Initialize knowledge base
cd ../..  # back to lab/agents/gbrain/
bun run repo/dist/cli.js init --data-dir ../../data/gbrain

# 5. Index lab content
bun run repo/dist/cli.js import ../../rfcs/
bun run repo/dist/cli.js import ../../research/
bun run repo/dist/cli.js import ../../reports/
bun run repo/dist/cli.js import ../../books/notes/
bun run repo/dist/cli.js import ../../knowledge/

# 6. Start GBrain MCP server (for Claude Code)
bun run repo/dist/cli.js mcp --port 3847
```

## Architecture

```
                  +------------------+
                  |  Claude Code     |
                  |  (you are here)  |
                  +--------+---------+
                           |
                    MCP protocol
                           |
              +------------+------------+
              |                         |
     +--------v--------+     +---------v--------+
     |  Hermes Agent   |     |  GBrain          |
     |  (orchestrator) |     |  (knowledge DB)  |
     +--------+--------+     +---------+--------+
              |                         |
     Kimi K2.5 / Fireworks     PGLite + embeddings
              |                         |
     +--------v--------+     +---------v--------+
     | Scheduled tasks: |     | Indexed content: |
     | - lit review     |     | - RFCs           |
     | - trace analysis |     | - research       |
     | - upstream watch |     | - reports        |
     +------------------+     | - book notes     |
                              +------------------+
```

## Model: Kimi K2.5 via Fireworks

Both agents use **Kimi K2.5** on Fireworks as their default model:

- **Cost**: ~$0.40/M input, ~$1.60/M output (Fireworks pricing)
- **Speed**: 200+ tokens/sec on Fireworks infrastructure
- **Context**: 128K tokens
- **Strengths**: Strong reasoning, good at structured output, multilingual

This is the same model used for E2E test execution in the main project,
so lab operations stay within the same model family for consistency.

## Hermes Agent

Research orchestrator. Maintains persistent memory, spawns parallel
subagents, and runs scheduled tasks for automated research.

Config: `hermes/config.yaml`

### Scheduled Tasks (disabled by default)

| Task              | Schedule        | What it does                                    |
|-------------------|-----------------|-------------------------------------------------|
| literature-review | Mon 9am         | Scan new lab content, cross-ref upstream         |
| trace-analysis    | Wed 10am        | Sample recent traces, update failure taxonomy    |
| upstream-monitor  | Fri 8am         | Check competitor repos for relevant changes      |

## GBrain

Knowledge persistence layer. Indexes all lab Markdown into a searchable
database with hybrid search (keyword + vector + reciprocal rank fusion).

Config: `gbrain/config.yaml`

### MCP Integration

When running as an MCP server, GBrain exposes ~30 tools that Claude Code
can use to query the knowledge base mid-conversation:

```jsonc
// Add to .claude/settings.local.json
{
  "mcpServers": {
    "gbrain": {
      "command": "bun",
      "args": ["run", "lab/agents/gbrain/repo/dist/cli.js", "mcp"],
      "env": { "FIREWORKS_API_KEY": "${FIREWORKS_API_KEY}" }
    }
  }
}
```
