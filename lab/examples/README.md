# Lab Examples

This page collects a small set of lab prompts that are worth reusing.

The goal is not to provide dozens of prompts. The goal is to give a few examples
that map cleanly to how the lab is meant to be used.

## How To Use These

Pick the example that matches the job:

- use **local mode** when the answer should come from repo and lab material
- use **external mode** when the question is outward-facing and current
- use `--save` when the result should become a durable research artifact

If you are unsure, start with local mode.

## 1. Repo-Grounded Status Summary

Use this when you want a concise picture of what the repo already says about a
topic.

```bash
npm run lab:research -- --mode local "Summarize the current workflow-skills roadmap and the main problems it is trying to solve."
```

Why this works:

- it is grounded in local docs and lab notes
- it produces a useful briefing without pretending to do external research
- it is a good first step before changing prompts, skills, or orchestration

## 2. Trace-Driven Failure Synthesis

Use this when a class of failures keeps showing up and you need a hypothesis,
not just another anecdote.

```bash
npm run lab:research -- --mode local --save continuation-failure-patterns "What are the main recurring failure patterns in recent continuation-related traces, and what harness-level interventions do they suggest?"
```

Why this works:

- it turns trace pain into a durable note
- it nudges the output toward harness changes rather than generic commentary
- it is the right precursor to a Notion RFC or experiment

## 3. External State-Of-The-Art Scan

Use this when the answer depends on current external capabilities.

```bash
npm run lab:research -- --mode external --save browser-agent-memory-sota "What is the current state of the art in memory systems for browser agents? Focus on architecture patterns, retrieval design, and verification tradeoffs."
```

Why this works:

- it is clearly outward-facing
- it gives the model a real research target instead of a vague comparison
- it creates a dated artifact that can be revisited later

## 4. Vendor Capability Research

Use this when a product question depends on current vendor docs, plan limits, or
identity/admin capabilities.

```bash
npm run lab:research -- --mode external --save vendor-capability-note "What are the current documented admin and provisioning capabilities for [product]? Distinguish enterprise and non-enterprise paths, and state what a browser agent should or should not automate."
```

Why this works:

- it forces the answer into an operator-relevant shape
- it avoids vague product summaries
- it is a good template for SaaS admin or provisioning research

Replace `[product]` with the concrete target.

## 5. Skill-Candidate Framing Prompt

Use this after a cluster of E2E failures suggests a missing workflow contract.

```bash
npm run lab:research -- --mode local --save skill-candidate-note "Based on the current skills roadmap, trace analyses, and recent E2E pain points, what workflow pattern looks mature enough to become a first-class skill next?"
```

Why this works:

- it ties together roadmap, traces, and implementation pressure
- it is more actionable than a generic 'what skills should we add?' question
- it helps separate real skill candidates from one-off fixture issues

## Prompt Patterns That Tend To Work Well

Good patterns:

- "What are the recurring failure patterns in..."
- "What does the repo currently say about..."
- "What interventions does this suggest for..."
- "Distinguish enterprise and non-enterprise paths"
- "What should a browser agent automate, and what should it not automate?"

Patterns that tend to work poorly:

- "Tell me everything about..."
- "Give me a comprehensive report on AI agents"
- "What do you think about this topic?"
- "Research this" with no scope, no object, and no intended outcome

## Suggested Workflow

For a real research task:

1. run `npm run lab:doctor`
2. capture the question with `lab:question` if it comes from development pain
3. run one of the example prompts above
4. save the result if it is worth keeping
5. turn the useful part into a Notion RFC, test, or code change

## Related Files

- [../README.md](../README.md)
- [../agents/README.md](../agents/README.md)
- [../questions/README.md](../questions/README.md)
