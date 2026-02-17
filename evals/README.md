# OpenSidebar Evals (Manual Workflow)

This eval stack is intentionally manual-first. It is designed for prompt iteration, golden-dataset growth, and AI-assisted critique without CI gates.

## Why Manual-First

- Prompt work is exploratory and high-variance.
- You want human judgment before promoting prompt changes.
- You want AI to synthesize failures into concrete improvement proposals.

## Core Loop

1. Record real traces.
2. Convert traces into eval cases.
3. Run baseline prompt.
4. Run candidate prompt.
5. Compare A/B.
6. Generate critique artifacts.
7. Update prompts and golden dataset.

## Commands

### 1) Convert trace to cases

```bash
bun run evals convert <session-id> --strategy all
```

Important: keep `bun run logs` running while collecting sessions.
This now captures both:
- agent turn traces: `traces/<session-id>.jsonl`
- orchestrator run traces: `traces/runs/<run-id>.jsonl`

### 2) Run baseline

```bash
bun run evals run --all --prompt-variant baseline
```

Or use the shared production prompt registry directly (no copy/paste):

```bash
bun run evals run --all --prompt-id orchestrator.verifier.system --prompt-variant baseline
```

### 3) Run candidate prompt

```bash
bun run evals run --all --prompt-file prompts/candidate.txt --prompt-variant candidate
```

### 4) A/B comparison

```bash
bun run evals ab --prompt-a prompts/baseline.txt --prompt-b prompts/candidate.txt --all
```

You can also compare a shared production prompt against a file variant:

```bash
bun run evals ab --prompt-id-a orchestrator.verifier.system --prompt-b prompts/candidate.txt --all
```

### 5) Human-readable analysis

```bash
bun run evals analyze
```

### 6) AI-consumable critique artifacts

```bash
bun run evals critique
```

Optional:

```bash
bun run evals critique --session <session-prefix> --out evals/reports
bun run evals critique --run <run-id-prefix> --out evals/reports
```

This writes:

- `evals/reports/critique-<timestamp>.json`
- `evals/reports/critique-<timestamp>.md`

The JSON is structured for direct LLM ingestion.

## Golden Dataset Program

Use the `promptQuality.track` field in eval cases to keep coverage balanced:

1. `orchestrator_lane_isolation`
2. `verifier_critic`
3. `human_escalation`
4. `budget_and_termination`
5. `checkpoint_resume`
6. `core_task_success`

After each prompt cycle:

1. Add at least 1 new case in the weakest track.
2. Add `mustNot` constraints for newly observed bad behaviors.
3. Re-run A/B and confirm no regressions on critical tracks.

## AI Critique Prompt (Copy/Paste)

Use this with the generated critique JSON:

```text
You are reviewing eval data for an agentic browser orchestrator.
Given this critique JSON, propose:
1) top 3 prompt edits (exact wording changes),
2) expected impact by track,
3) risks/regressions to watch,
4) 5 new golden cases to add (with track labels and mustNot constraints).
Keep changes minimal and testable.
```

## What The Books Recommend For Your Situation

This workflow aligns with the direction in:

- `Designing-Multi-Agent-Systems.pdf`
- `Agentic_Design_Patterns.pdf`

Key principles to follow in prompt evals:

1. Evaluate by behavior contracts, not vibes.
2. Keep role boundaries explicit (planner/executor/verifier).
3. Use failure-taxonomy-driven datasets (not random samples).
4. Run controlled A/B prompt experiments on the same case set.
5. Use critique loops (judge/critic) to propose focused prompt edits.
6. Track regressions by track so gains in one area do not silently break another.

In practice for OpenSidebar: keep the loop manual, but make artifacts machine-readable (`critique-*.json`) so AI can reliably draft the next prompt revision and golden-case additions.

## Prompt Source Of Truth

Production prompt templates live in `src/prompts/` and are versioned/hashable.
Use `--prompt-id` / `--prompt-id-a` / `--prompt-id-b` to run evals against the exact same prompt artifacts used in production.
