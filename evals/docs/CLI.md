# CLI Reference

Complete reference for the `bun evals` command-line interface.

## Quick Reference

```bash
# Basic usage
bun evals                              # Run all evaluations
bun evals --tag search                 # Run only search tests
bun evals --difficulty easy            # Run only easy tests
bun evals --format json --output results.json

# Analysis
bun evals --analyze                    # Analyze failures
bun evals --suggest                    # Get prompt suggestions
bun evals --stats                      # Show dataset statistics

# Comparison
bun evals --compare baseline           # Compare with baseline
bun evals --fail-on-regression         # Fail if regressions found
```

## Commands

### `--run` (Default)

Run evaluations against golden dataset.

```bash
bun evals
bun evals --run
```

### `--analyze`

Analyze failures from recent run.

```bash
bun evals --analyze
```

Output includes:

- Failure types breakdown
- Root cause analysis
- Common issues

### `--suggest`

Generate prompt improvement suggestions.

```bash
bun evals --suggest
bun evals --analyze --suggest  # Analyze first, then suggest
```

Requires `OPENAI_API_KEY` environment variable.

### `--stats`

Show golden dataset statistics.

```bash
bun evals --stats
```

Output:

```
Golden Dataset Statistics
============================================================

Total Cases: 50

By Difficulty:
  easy: 30
  medium: 15
  hard: 5

By Tag:
  navigation: 20
  forms: 15
  search: 10
```

### `--history`

Show prompt improvement history.

```bash
bun evals --history
```

### `--compare <id>`

Compare current results with baseline.

```bash
bun evals --compare baseline
bun evals --compare 2024-01-15-run
```

## Filtering Options

### `--tag <tags>`

Filter by tags (comma-separated).

```bash
bun evals --tag search
bun evals --tag navigation,forms
bun evals --tag "search,click"
```

### `--difficulty <levels>`

Filter by difficulty (comma-separated).

```bash
bun evals --difficulty easy
bun evals --difficulty easy,medium
bun evals --difficulty hard
```

### `--category <categories>`

Filter by category (comma-separated).

```bash
bun evals --category navigation
bun evals --category forms,data-extraction
```

### `--id <ids>`

Run specific case(s) by ID.

```bash
bun evals --id search-google-001
bun evals --id search-google-001,login-form-001
```

## Output Options

### `--format <format>`

Output format (default: console).

```bash
bun evals --format console    # Human-readable console output
bun evals --format json       # JSON format
bun evals --format markdown   # Markdown report
bun evals --format html       # HTML report
bun evals --format csv        # CSV format
```

### `--output <path>`

Save output to file.

```bash
bun evals --output report.md
bun evals --format json --output results.json
```

If not specified, output goes to stdout.

## Execution Options

### `--mock`

Use mock mode (no real LLM calls).

```bash
bun evals --mock
```

Useful for:

- Testing the evaluation system itself
- Fast feedback during development
- CI/CD pipelines without API keys

### `--timeout <ms>`

Set timeout per case in milliseconds.

```bash
bun evals --timeout 30000     # 30 seconds
bun evals --timeout 120000    # 2 minutes
```

Default: 60000 (60 seconds)

### `--fail-on-regression`

Exit with error code if regressions found.

```bash
bun evals --compare baseline --fail-on-regression
```

Useful for CI/CD integration.

## Examples

### Run Specific Tests

```bash
# Run only search tests
bun evals --tag search

# Run easy and medium tests
bun evals --difficulty easy,medium

# Run a specific case
bun evals --id login-form-001
```

### Generate Reports

```bash
# JSON report
bun evals --format json --output results.json

# Markdown report
bun evals --format markdown --output report.md

# HTML report
bun evals --format html --output report.html
```

### Development Workflow

```bash
# Quick test with mock mode
bun evals --mock --tag smoke-test

# Full test suite
bun evals

# Analyze failures
bun evals --analyze

# Get suggestions
bun evals --analyze --suggest --output suggestions.md

# Compare with baseline
bun evals --compare baseline --fail-on-regression
```

### CI/CD Integration

```yaml
# .github/workflows/evals.yml
name: Evaluations

on: [push, pull_request]

jobs:
  evals:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Bun
        uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: bun install

      - name: Run evaluations
        run: bun evals --compare baseline --fail-on-regression
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
```

## Exit Codes

| Code | Meaning                              |
| ---- | ------------------------------------ |
| 0    | All tests passed                     |
| 1    | Some tests failed or errors occurred |
| 2    | Invalid arguments or configuration   |

## Environment Variables

### `OPENAI_API_KEY`

Required for `--suggest` to generate prompt improvements.

```bash
export OPENAI_API_KEY=sk-...
bun evals --suggest
```

### `OPENROUTER_API_KEY`

Required for running evaluations with real LLM.

```bash
export OPENROUTER_API_KEY=...
bun evals
```

### `EVAL_TIMEOUT`

Default timeout in milliseconds.

```bash
export EVAL_TIMEOUT=120000
bun evals
```

## Output Examples

### Console Output

```
============================================================
QSidebar Evaluation Results
============================================================

Total Cases: 10
Passed: 8 (80.0%)
Failed: 2 (20.0%)
Errors: 0
Avg Duration: 2450ms
Avg Tool Accuracy: 85.0%

------------------------------------------------------------

Failed Cases:
  ❌ login-form-001
     Error: Missing required step: click submit button
  ❌ search-google-002
     Error: Wrong element selected: clicked tag 3 instead of tag 1

============================================================
```

### JSON Output

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "summary": {
    "total_cases": 10,
    "passed": 8,
    "failed": 2,
    "errors": 0,
    "avg_duration_ms": 2450,
    "avg_tool_accuracy": 0.85
  },
  "results": [
    {
      "case_id": "search-google-001",
      "status": "passed",
      "duration_ms": 2300,
      "metrics": {
        "tool_accuracy": 1.0,
        "steps_taken": 3
      }
    }
  ]
}
```

### Markdown Output

```markdown
# QSidebar Evaluation Report

Generated: 1/15/2024, 10:30:00 AM

## Summary

- **Total Cases**: 10
- **Passed**: 8 (80.0%)
- **Failed**: 2 (20.0%)
- **Errors**: 0
- **Average Duration**: 2450ms

## Detailed Results

### ✅ search-google-001

- **Status**: passed
- **Duration**: 2300ms
- **Tool Accuracy**: 100.0%
```

## Tips

1. **Use `--mock` for development** - Fast feedback without API costs
2. **Filter by tags** - Focus on specific functionality
3. **Compare with baseline** - Catch regressions early
4. **Use `--fail-on-regression`** - Prevent shipping broken prompts
5. **Save reports** - Track performance over time

## Troubleshooting

### "No golden cases found"

Create cases in `evals/golden/cases/`:

```bash
mkdir -p evals/golden/cases
echo "id: test-001" > evals/golden/cases/test.yaml
```

### "API key required"

Set the required API key:

```bash
export OPENROUTER_API_KEY=...
# or
export OPENAI_API_KEY=...
```

### "Timeout errors"

Increase timeout:

```bash
bun evals --timeout 120000
```

### "Out of memory"

Run fewer cases at once:

```bash
bun evals --tag smoke-test  # Run critical tests only
```
