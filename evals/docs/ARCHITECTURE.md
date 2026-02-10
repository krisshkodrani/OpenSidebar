# Architecture Overview

The OpenSidebar Evaluation System is a comprehensive headless testing framework with golden dataset support and automated prompt optimization.

## System Components

```
evals/
├── core/                      # Core evaluation infrastructure
│   ├── types.ts              # Type definitions
│   ├── loader.ts             # Golden dataset loading
│   ├── runner.ts             # Evaluation orchestration
│   ├── metrics.ts            # Metrics calculation
│   └── reporter.ts           # Results reporting
│
├── optimizer/                 # Prompt optimization engine
│   ├── analyzer.ts           # Failure analysis
│   ├── suggester.ts          # LLM-powered suggestions
│   └── tracker.ts            # Improvement tracking
│
├── golden/                    # Golden dataset storage
│   ├── cases/                # Individual test cases (YAML)
│   ├── prompts/              # System prompt versions
│   └── history/              # Evaluation history
│
├── cli.ts                     # CLI entry point
└── index.ts                   # Public API exports
```

## Evaluation Flow

```
1. Load Golden Cases
   ↓
2. Filter by criteria (tags, difficulty, etc.)
   ↓
3. Run Evaluation
   ├─ Set up mock DOM
   ├─ Initialize AgentLoop
   ├─ Execute agent with timeout
   └─ Capture tool calls & responses
   ↓
4. Calculate Metrics
   ├─ Tool call accuracy
   ├─ Text similarity
   ├─ Outcome validation
   └─ Step efficiency
   ↓
5. Compare with Expected
   ↓
6. Generate Report
   ↓
7. If failed: Analyze & Suggest Improvements
```

## Key Design Decisions

### 1. Mock DOM Environment

The evaluation system uses Happy DOM to simulate browser environments without requiring actual browser automation. This provides:

- **Speed**: ~100ms per test vs ~5s with real browser
- **Determinism**: Exact control over DOM state
- **Isolation**: No side effects between tests
- **CI/CD Friendly**: No browser dependencies

### 2. Golden Dataset Format

Golden cases use YAML for human readability and version control:

```yaml
id: unique-identifier
input:
  url: page URL
  dom_snapshot: HTML content
  user_query: what to do
expected:
  tool_calls: [...]
  assistant_text: "..."
  outcome: { ... }
metadata:
  tags: [...]
  difficulty: easy|medium|hard
```

### 3. Flexible Metrics

Multiple metrics are calculated:

- **Tool Accuracy**: Exact match or sequence similarity
- **Text Similarity**: Jaccard similarity (can use embeddings)
- **Outcome Match**: Boolean success criteria
- **Step Efficiency**: Expected vs actual steps

Metrics can be weighted to produce overall scores.

### 4. Automated Prompt Optimization

When tests fail, the system:

1. **Analyzes** the failure type and root cause
2. **Clusters** similar failures to find patterns
3. **Generates** LLM-powered suggestions
4. **Tracks** improvements over time
5. **Prevents** regressions by comparing baselines

## Failure Analysis

The analyzer categorizes failures:

| Failure Type  | Description                | Example                                     |
| ------------- | -------------------------- | ------------------------------------------- |
| wrong_tool    | Wrong tool selected        | Used `type_text` instead of `click_element` |
| wrong_params  | Correct tool, wrong params | Clicked tag 2 instead of tag 1              |
| missing_step  | Skipped required step      | Forgot to click submit button               |
| extra_step    | Unnecessary step           | Extra click before search                   |
| wrong_order   | Steps in wrong sequence    | Submitted before typing                     |
| wrong_text    | Response text differs      | Different explanation                       |
| wrong_outcome | Final state incorrect      | Wrong page loaded                           |

## Prompt Suggestion System

The suggester uses a structured prompt to get actionable improvements:

```
You are an expert prompt engineer...

Current System Prompt:
{current_prompt}

Recent Failures:
{failures}

Analysis:
{analysis}

Suggest 3-5 specific improvements...
```

Suggestions include:

- Title and description
- Current excerpt and proposed change
- Affected cases
- Expected improvement percentage
- Confidence level

## Comparison & Regression Detection

The system can compare runs:

```typescript
interface ComparisonResult {
  overall_change: {
    success_rate_delta: number;
    avg_duration_delta_ms: number;
  };
  regressions: Regression[];
  improvements: Improvement[];
  unchanged: string[];
}
```

This enables:

- **CI/CD Integration**: Fail builds on regressions
- **A/B Testing**: Compare prompt versions
- **Trend Analysis**: Track improvement over time

## Extension Points

### Custom Metrics

Add new metrics by extending the `METRICS` object in `core/metrics.ts`:

```typescript
export const METRICS: Record<string, MetricDefinition> = {
  my_custom_metric: {
    name: "Custom Metric",
    description: "...",
    type: "percentage",
    higher_is_better: true,
  },
};
```

### Custom Tool Executors

For testing tools, create mock executors in the runner:

```typescript
private createMockToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register(ToolName.CLICK_ELEMENT, def, async (args) => {
    // Mock DOM manipulation
    return "success";
  });

  return registry;
}
```

### Custom Reporters

Add new output formats by extending `generateReport()`:

```typescript
case "xml":
  return generateXMLReport(results, summary, config);
```

## Performance Considerations

### Memory Usage

- DOM snapshots are loaded per test
- No persistent browser context
- Automatic cleanup between tests

### Parallel Execution

Currently sequential to avoid conflicts. Future enhancements:

- Worker threads for parallel execution
- Isolated VM contexts
- Parallel test categories

### Caching

Future enhancements:

- Cache LLM responses for deterministic tests
- Cache embeddings for text similarity
- Incremental evaluation (only changed cases)

## Security

- No real browser network requests
- Mocked Chrome APIs
- Isolated evaluation context
- No persistence of sensitive data

## Future Roadmap

### Phase 1: Foundation ✅

- [x] Golden dataset format
- [x] Basic evaluation runner
- [x] Metrics calculation
- [x] Simple reporting

### Phase 2: Analysis ✅

- [x] Failure analysis
- [x] Prompt suggestions
- [x] Improvement tracking

### Phase 3: Real LLM Integration 🔄

- [ ] Full AgentLoop integration
- [ ] Live LLM API calls
- [ ] Cost/usage tracking
- [ ] Streaming response handling

### Phase 4: Advanced Features 📋

- [ ] Parallel execution
- [ ] CI/CD integration
- [ ] Web dashboard
- [ ] Automatic golden case generation
- [ ] A/B testing framework

## Contributing

When adding new features:

1. Add types to `core/types.ts`
2. Implement in appropriate module
3. Add CLI commands in `cli.ts`
4. Update documentation
5. Add example cases to `golden/cases/`
6. Run `bun evals` to verify
