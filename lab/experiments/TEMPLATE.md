# Experiment: exp-NNN-<slug>

## Metadata
- **Date**: YYYY-MM-DD
- **Researcher**: <name>
- **Status**: planned | running | completed | abandoned
- **Evidence Grade**: A | B | C | D

## Hypothesis

> We believe that [change X] will [improve Y] because [reason Z].
> If true, we expect [measurable outcome].

## Background

What prior observations or RFCs motivated this experiment?
Link to the relevant Notion RFC and any supporting `lab/knowledge/` entries.

## Method

1. **Baseline**: Describe the control condition (current state, existing E2E results)
2. **Treatment**: Describe what you will change
3. **Measurement**: What metrics will you compare? (pass rate, turn count, token cost, etc.)
4. **Run count**: How many E2E runs per condition? (minimum 3 for Grade A)

## Setup

```bash
# Commands to reproduce the experiment
```

## Results

| Metric       | Baseline | Treatment | Delta  |
|-------------|----------|-----------|--------|
| Pass rate   |          |           |        |
| Avg turns   |          |           |        |
| Token cost  |          |           |        |

## Raw Data

- Traces: `traces/<uuid>.jsonl`
- Reports: `lab/e2e-reports/<report>.md`

## Conclusion

What did we learn? Was the hypothesis supported?

## Follow-up

What should be investigated next? New Notion RFCs to open?
