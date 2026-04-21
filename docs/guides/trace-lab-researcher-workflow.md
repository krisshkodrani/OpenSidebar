# Trace Lab Researcher Workflow

Date: 2026-04-21

Scope: Recommended workflow for researchers, prompt designers, and reliability analysts using the Lab and the Trace Viewer

## Goal

This workflow is for people who need to move from:

- repeated trace evidence
- to a named pattern
- to a durable artifact or recommendation

The intended product split is:

- **Lab = pattern analysis, synthesis, and memory**
- **Viewer = raw evidence and replay**

The researcher should start in the lab and only return to the viewer when screenshots, turn replay, or exact runtime evidence are needed.

## Primary Research Workflow

### 1. Start In The Lab

Begin with the lab trace surface, not a single raw session.

Start from questions like:

- what failures are recurring
- which domains or fixtures are unstable
- which tools or events cluster with failure
- what has already been learned from prior traces

The lab is the right first stop for:

- `search_traces`
- `find_similar_failures`
- `list_trace_pathologies`
- `get_trace_session`

## 2. Define The Question Before Reading Evidence

Do not begin with open-ended trace browsing.

Write the research question in a narrow form such as:

- why does `turn_limit_reached` recur on this fixture
- what repeated event pattern appears before this failure
- which failures share the same tool breakdown
- is this a domain-specific issue or a general agent weakness

This keeps the research loop analytical instead of anecdotal.

## 3. Pull A Cohort, Not Just A Session

The default unit for researcher work should be a cohort.

Good cohorts include:

- same failure code
- same domain
- same fixture
- same repeated failed tool
- same repeated failed event pattern

At this stage, the goal is to understand:

- prevalence
- recurrence
- shape of the failure
- whether the issue is isolated, clustered, or systemic

## 4. Read Distilled Evidence First

Before opening raw replay, start with the imported lab evidence.

Read in this order:

1. pathology summary
2. similar failures
3. imported trace summary
4. trace session detail
5. raw viewer replay only if needed

The lab should answer:

- what pattern exists
- how often it appears
- which sessions best represent it
- what the likely failure family is

The viewer should only be used when the research needs:

- screenshots
- exact perception context
- full turn-by-turn replay
- low-level logs

## 5. Pick Representative Sessions

Do not inspect every session equally.

Select:

- one representative failure
- one nearby comparison case
- optionally one completed case from the same domain or fixture

The goal is to compare the shape of the pattern, not to read the entire corpus manually.

Good representative sets usually include:

- a median-looking failure
- an extreme failure
- a successful counterexample

## 6. Return To The Viewer For Evidence Validation

Once a likely pattern is identified, open the raw viewer only to validate it.

Use the viewer to confirm:

- the first divergence turn
- whether perception was stale, missing, or misleading
- whether the tool sequence repeated or stalled
- whether the session narrative matches the lab summary

As a rule:

- use the lab to hypothesize
- use the viewer to verify

## 7. Synthesize The Finding

Every research loop should produce a durable synthesis, not just a chat conclusion.

Recommended outputs:

- research seed
- pathology note
- RFC seed
- eval or harness idea
- prompt or skill recommendation

Each artifact should capture:

- the named pathology
- scope of affected sessions
- representative evidence
- likely root cause
- confidence level
- recommended next step

## 8. Operationalize The Result

A research conclusion is not finished until it can influence the system.

Typical handoffs:

- to engineering for a code or tooling fix
- to prompting or skills for behavior changes
- to evals for a new targeted test
- to roadmap or RFC work for larger design changes

Useful closing questions:

- should this become a regression test
- should Hermes remember this as a reusable trace pattern
- is this important enough to track as a named pathology

## Fast Path Recipes

### Repeated Failure Pattern

1. Search by failure code or domain.
2. Pull similar failures.
3. Review pathology summary.
4. Choose two or three representative sessions.
5. Validate one in the viewer.
6. Write a pathology note or research seed.

### Domain Instability Investigation

1. Filter the lab to one domain or fixture.
2. Review outcomes and repeated failure codes.
3. Check recurring failed tools and events.
4. Compare one failed session with one completed session.
5. Convert the finding into a prompt, tool, or eval recommendation.

### Unknown New Pathology

1. Start from a single suspicious session.
2. Use the lab to find whether the shape repeats elsewhere.
3. If it does, define the cohort.
4. If it does not, keep it provisional and avoid overgeneralizing.
5. Create a research seed only after checking raw evidence once.

## Team Conventions

Use these norms when doing trace research:

- do not treat one trace as a pattern
- prefer cohorts over anecdotes
- start with distilled evidence before raw replay
- return to the viewer only for validation
- convert meaningful findings into durable artifacts
- do not commit raw traces

## What Good Looks Like

A strong researcher loop should end with all of these true:

- the question was narrowly defined
- a cohort was inspected, not just one trace
- representative sessions were chosen intentionally
- raw replay was used for validation, not discovery
- a durable artifact or recommendation was created

## Recommended Next Product Steps

To make this workflow better for researchers, the next useful additions are:

1. a `trace_debug_brief` tool for compact analyst summaries
2. a lightweight lab trace dashboard for recurring cohorts
3. evidence grading attached to trace-derived findings
4. direct deep links from lab notes back to viewer replay
