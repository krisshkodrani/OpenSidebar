# AGENTS.md

This file provides guidance to coding agents working in this repository.

## E2E Report Format

When an agent runs the E2E suite or prepares an E2E summary report, create a dated markdown report in `docs/` using this filename pattern:

- `docs/e2e-report-YYYY-MM-DD.md`

Do not create or update an undated `docs/e2e-report.md` file.

The report should use this structure:

1. Title: `# E2E Final Report`
2. Date line
3. Scope line
4. Overall result line
5. A markdown table with these columns:
   - `Case`
   - `Success`
   - `Turns`
   - `Perceptions`
   - `Traces`
   - `Prompt used`
6. A short `Metric Definitions` section
7. A short `Stability Notes` section

Metric conventions:

- `Turns`: total recorded trace turns across the trace file(s) for that case.
- `Perceptions`: turns where the trace input included `Page Interpretation`.
- `Traces`: number of trace sessions produced for that case, including replans or retries.
- `Success`: whether the case completed successfully in the run.

Prefer concise prompts in the table: compact whitespace, preserve key literals, and keep the wording faithful to the actual test prompt.
