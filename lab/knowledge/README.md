# Knowledge Base

Accumulated findings from lab operations. These files are indexed by GBrain
for semantic search and cross-referencing.

## Structure

- `failure-taxonomy.md` -- Recurring failure patterns from trace analysis
- `literature-digest.md` -- Weekly literature review summaries
- `upstream-changelog.md` -- Notable changes in competitor/upstream projects
- `model-observations.md` -- Empirical observations about model behavior

## Adding Knowledge

Write Markdown files here. GBrain will index them on next enrichment cycle,
or index manually:

```bash
cd lab/agents/gbrain
bun run repo/dist/cli.js import ../../knowledge/
```

## Evidence Grades

Tag observations with evidence grades (defined in lab/README.md):

- **A**: Replicated (>=3 runs)
- **B**: Single-run with trace
- **C**: Anecdotal
- **D**: Theoretical
