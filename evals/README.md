# OpenSidebar Evals

Trace-based evaluation system for the OpenSidebar browser agent. Replays recorded agent sessions offline, judges quality with a strong model, and produces actionable reports with specific prompt fix suggestions.

## Architecture

```
traces/*.jsonl          Real agent session recordings (DOM, LLM requests/responses, tool calls)
       |
  [extract]             Extract specific turns as golden cases with corrected expectations
       |
evals/golden/*.json     10 curated golden cases, 2 per pathology, with real system prompts
       |
  [critique]            Replay → Score → Judge (Claude Sonnet) → Report
       |
evals/reports/*.md      Actionable markdown with per-pathology breakdown + prompt fix suggestions
```

## Quick Start

```bash
# 1. Validate golden cases structurally (no API key needed)
npm run evals:validate

# 2. Run full critique (requires OPENROUTER_API_KEY in .env)
npm run evals:critique

# 3. Read the report
cat evals/reports/critique-*.md
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run evals:critique` | Replay all golden cases, judge with Claude Sonnet, generate report |
| `npm run evals:critique -- --tag <p>` | Critique filtered by pathology tag |
| `npm run evals:validate` | Structural validation of golden cases (offline, no API key) |
| `npm run evals -- extract <id> <turn>` | Extract a golden case from a trace turn |
| `npm run evals -- help` | Show all CLI subcommands |

### Make shortcuts

```bash
make evals-critique                         # Full critique
make evals-critique TAG=find_element_loop   # Filter by pathology
make evals-extract S=<id> T=<turn> TAG=<p>  # Extract golden case
make evals-validate                         # Structural validation
```

### Advanced CLI (not in npm scripts)

These legacy commands are still available via the CLI directly:

```bash
npx tsx evals/cli.ts convert <session-id>   # Convert trace to eval cases
npx tsx evals/cli.ts run --all              # Run eval cases against LLM
npx tsx evals/cli.ts stats                  # Aggregate statistics
npx tsx evals/cli.ts analyze                # Pattern analysis
npx tsx evals/cli.ts ab --prompt-a ... --prompt-b ...  # A/B prompt comparison
```

## Golden Dataset

10 golden cases extracted from real traces, organized by 5 recurring agent pathologies:

| Pathology | Cases | What Goes Wrong |
|-----------|-------|-----------------|
| `find_element_loop` | 2 | Agent calls `find_element` 5+ times when `[N]` tag IDs are already visible |
| `escalation_repeat` | 2 | After escalating to smart model, repeats the exact same failing tool call |
| `disabled_button` | 2 | Clicks disabled submit button repeatedly, ignores need to find correct input |
| `text_as_toolcall` | 2 | LLM outputs tool call JSON as plain text instead of using the `tool_calls` API |
| `marathon_no_done` | 2 | 100+ turns cycling without calling `done()` or `escalate()` |

Each golden case contains:
- Real system prompt (~12-21K chars with visible elements + perception output)
- Real conversation history from the trace
- **Corrected** expected tool calls (what the agent *should* have done)
- Pathology tag for filtering and reporting

### Adding Golden Cases

```bash
# 1. Find a problematic turn in a trace
npm run traces list
npm run traces -- show <session-id>

# 2. Extract with corrected expectations
npm run evals -- extract <session-id> <turn> \
  --tag <pathology> \
  --correct-tool click_element \
  --correct-args '{"id": 42}'

# 3. Validate
npm run evals:validate
```

## Judge Rubric

The judge (Claude Sonnet) scores each case on 5 dimensions (0-10):

| Dimension | What It Measures |
|-----------|-----------------|
| `toolSelection` | Right tool for what's visible on screen? |
| `parameterAccuracy` | Correct element ID, text, arguments? |
| `efficiency` | Minimal steps, no redundant actions? |
| `antiPatternAvoidance` | No repeating failed actions, no narrating without acting? |
| `reasoningQuality` | Think block shows correct observe-reason-act logic? |

The judge also outputs a `promptFixSuggestion` — a specific system prompt edit that would fix the observed failure. These suggestions are aggregated and ranked in the critique report.

## Critique Report Structure

The generated markdown report contains:

1. **Summary** — pass rate, avg scores, judge dimension averages
2. **Per-Pathology Breakdown** — pass/fail counts and avg scores per pathology (worst first)
3. **Failed Cases** — detailed analysis: expected vs actual, judge reasoning, prompt fix suggestion
4. **Prompt Improvement Recommendations** — ranked HIGH/MED/LOW, aggregated from judge suggestions

## Prompt Iteration Loop

```
Record traces  →  Extract golden cases  →  Run critique  →  Read report
                                                              |
                                              Apply prompt fixes from recommendations
                                                              |
                                              Re-run critique to verify improvement
```

## File Layout

```
evals/
  cli.ts                CLI entry point (extract, critique, regression, convert, run, stats, analyze)
  types.ts              EvalCase, EvalResult, JudgeScore interfaces
  converter.ts          Trace → eval case conversion (extracts real system prompts)
  extractor.ts          Golden case extraction from specific trace turns
  runner.ts             Offline replay against LLM via OpenRouter
  scorer.ts             Tool name match, param match, sequence match scoring
  judge.ts              Claude Sonnet judge with 5-dimension rubric
  report.ts             Actionable markdown report generator
  contract-compliance.ts  Contract violation analyzer
  utils.ts              Shared utilities (trace I/O, API key loading)
  golden/               Curated golden cases (10 files, ~40-60KB each)
  cases/                Auto-converted eval cases (generated)
  results/              Eval run results (generated)
  reports/              Critique reports (generated)
```
