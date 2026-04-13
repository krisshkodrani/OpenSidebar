# Lab Agents

Two agents power the OpenSidebar laboratory.

## Quick Start

```bash
# 1. Put keys in the project root .env file.
#    Hermes uses FIREWORKS_API_KEY by default.
#    The pinned GBrain build uses OPENAI_API_KEY.

# 2. Bootstrap the lab
npm run lab:setup

# 3. Verify the environment
npm run lab:doctor

# 4. Start the GBrain MCP server used by Claude Code
bun run lab/bin/gbrain-mcp.ts

# 5. Re-index after adding new lab material
npm run lab:index

# 6. Generate a trace-analysis knowledge entry
npm run lab:analyze-traces -- --days 7 --limit 200

# 7. Capture a development question or pathology
npm run lab:question -- "Why does the executor over-commit before verification in transactional workflows?"

# 8. Run an ad hoc research task through Hermes
npm run lab:research -- "Compare our workflow-skills pipeline to Hermes skills"

# 9. Save the note into lab/research/ and re-index it
npm run lab:research -- --save skills-vs-hermes "Compare our workflow-skills pipeline to Hermes skills"

# 10. Generate a prioritized list of new skill candidates from recent traces
npm run lab:skill-candidates -- --days 7 --limit 200
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

Hermes uses the same model family as the E2E executor in the main project,
so most lab orchestration stays close to production conditions.

The `lab:research` wrapper prefers the lab's Fireworks-backed Hermes profile and
falls back to other configured providers only when needed.

GBrain is different: the pinned version in this repo currently relies on
`OPENAI_API_KEY` for embeddings/query expansion and is wrapped by
OpenSidebar-owned lab scripts.

## Hermes Agent

Research orchestrator. Maintains persistent memory, spawns parallel
subagents, and runs scheduled tasks for automated research.

One of the lab's core jobs is to take questions from active development,
read traces and reports, generalize recurring failures, and turn those into
actionable harness ideas worth testing.

That includes explicitly asking things like:

- investigate the latest traces for possible new skills
- identify repeated workflow pathologies that deserve a contract
- separate skill candidates from issues that should stay harness-side

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
can use to query the knowledge base mid-conversation. The supported way to
run it from this repo is through the lab wrapper:

```jsonc
// Already wired in .mcp.json at the repo root
{
  "mcpServers": {
    "gbrain": {
      "command": "bun",
      "args": ["run", "lab/bin/gbrain-mcp.ts"],
      "env": { "OPENAI_API_KEY": "${OPENAI_API_KEY}" }
    }
  }
}
```
