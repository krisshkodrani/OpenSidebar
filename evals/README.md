# OpenSidebar Evaluation System

Headless evaluation system with golden dataset support and automated prompt optimization for OpenSidebar's agent loop.

## Overview

This evaluation system allows you to:

- **Test agent decision-making** against known scenarios
- **Validate tool execution** correctness
- **Run end-to-end task evaluations**
- **Track prompt performance** over time
- **Automatically suggest prompt improvements** based on failures

## Quick Start

```bash
# Run all golden dataset evaluations
bun evals

# Run specific categories
bun evals --category decision
bun evals --category tools
bun evals --category e2e
bun evals --category memory-integration  # Memory-enabled scenarios

# Run memory-specific tests
bun evals --tag memory

# Analyze failures and get prompt suggestions
bun evals --analyze --suggest

# Compare current results with baseline
bun evals --compare baseline
```

## Architecture

```
evals/
├── core/                    # Core evaluation infrastructure
│   ├── types.ts            # Type definitions
│   ├── runner.ts           # Evaluation orchestrator
│   ├── metrics.ts          # Metrics calculation
│   └── reporter.ts         # Results reporting
├── golden/                 # Golden dataset
│   ├── cases/              # Individual test cases (YAML)
│   ├── prompts/            # System prompt versions
│   └── history/            # Evaluation run history
├── optimizer/              # Prompt optimization engine
│   ├── analyzer.ts         # Failure analysis
│   ├── suggester.ts        # Prompt suggestions
│   └── tracker.ts          # Improvement tracking
└── cli.ts                  # CLI entry point
```

## Golden Dataset

Golden cases define expected behavior for specific scenarios:

```yaml
# evals/golden/cases/search-google.yaml
id: search-google-001
input:
  url: https://google.com
  dom_snapshot: |
    <html>
      <input name="q" id="search-input"/>
      <button id="search-btn">Google Search</button>
    </html>
  user_query: "Search for flights to Paris"

expected:
  tool_calls:
    - tool: click_element
      params:
        tag: 1
      reasoning: "Focus the search input"
  assistant_text_pattern: "I'll search for flights"
  outcome:
    success: true

tags: [search, navigation]
difficulty: easy
```

### Memory-Enabled Evaluations

Test complex scenarios with pre-populated memory context:

```bash
# Run all memory tests
bun evals --tag memory

# Run specific memory scenario
bun evals --id memory-restaurant-preferences-001
```

Example memory-enabled golden case:

```yaml
id: memory-restaurant-preferences-001
input:
  url: https://google.com
  dom_snapshot: |
    <html>...</html>
  user_query: "Find me Italian restaurants in Boston"

# Pre-populate memory for this test
mock_memory:
  - id: "mem-001"
    content: "User is vegetarian and prefers gluten-free options"
    category: "dietary_preferences"
    sourceUrl: "https://example.com/past-conversation"
    createdAt: 1704067200000

expected:
  tool_calls:
    - tool: memory_search
      params:
        query: "dietary preferences vegetarian"
    - tool: type_text
      params:
        text: "vegetarian gluten-free Italian restaurants Boston"
```

See [Memory Evaluations Guide](docs/MEMORY_EVALUATIONS.md) for details.

## Prompt Optimization

The system can automatically analyze failures and suggest prompt improvements:

```bash
# Analyze recent failures
bun evals --analyze

# Get LLM-powered suggestions
bun evals --analyze --suggest --output suggestions.md

# Apply a suggestion
bun evals prompt --apply suggestion-1
```

## CI/CD Integration

Run evaluations in CI to catch regressions:

```yaml
# .github/workflows/evals.yml
- name: Run Evaluations
  run: bun evals --compare baseline --fail-on-regression
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) - System design details
- [Golden Dataset Guide](docs/GOLDEN_DATASET.md) - Creating and managing golden cases
- [Memory Evaluations](docs/MEMORY_EVALUATIONS.md) - Testing memory-dependent scenarios
- [Prompt Optimization](docs/PROMPT_OPTIMIZATION.md) - Automated prompt improvement
- [CLI Reference](docs/CLI.md) - Complete command reference
- [API Reference](docs/API.md) - Programmatic usage

## License

MIT
