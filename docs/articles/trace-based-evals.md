# Trace-Based Evals: How We Built a Feedback Loop from Production Failures to Prompt Fixes

*Building an eval system that turns real agent mistakes into specific system prompt improvements.*

---

We had 23 recorded agent sessions — full-fidelity recordings of a browser agent doing real work. DOM snapshots, LLM requests and responses, tool calls, outcomes. Some sessions were clean completions. Others were disasters: the agent calling `find_element` five times for a button already tagged `[14]` on the screen, or cycling through 100+ turns without ever calling `done()`.

We also had an eval system. On paper it could convert traces to eval cases, replay them against the LLM, and score results. In practice it was useless. The converter was writing empty system prompts and empty conversation histories. The golden cases were orchestrator-level behavioral contracts with no real trace data. The judge was GPT-4o-mini with a one-sentence rubric. Everything was wired up and nothing worked.

The gap between "we have an eval pipeline" and "the eval pipeline tells us something useful" turned out to be enormous. Closing it required rethinking what we were evaluating, how we were curating test cases, and what the judge needed to know. This article is about what we built, why we built it that way, and what the research says about whether any of it makes sense.

---

## The Core Problem: Eval Cases Without Ground Truth

The original converter extracted turn data from traces, but the critical function — `buildCase()` — was producing this:

```typescript
input: {
  systemPrompt: "",
  conversationHistory: [],
  tools: [],
  model: "unknown",
}
```

Every field empty. The runner would dutifully send these empty inputs to the LLM and get back responses. The scorer would compare them against expected outputs. The results were meaningless.

The fix was straightforward — read the actual data from the trace:

```typescript
input: {
  systemPrompt: turn.llmRequest?.messages?.find(m => m.role === "system")?.content ?? "",
  conversationHistory: turn.llmRequest?.messages ?? [],
  tools: [],  // runner loads from registry at replay time
  model: turn.llmRequest?.model ?? "unknown",
}
```

But this raised a harder question. Auto-converted cases carry the agent's *actual* behavior as the expected output. If the agent called `find_element` five times in a loop, that's what the expected tool calls say. You can't evaluate whether the agent improved if your ground truth encodes the original failure.

We needed golden cases — manually curated, with *corrected* expected behavior. And we needed them to come from real traces, not from synthetic scenarios, because synthetic cases don't carry the complexity of real web pages. A real system prompt in our agent is 12,000–21,000 characters. It contains hundreds of tagged elements, a perception output with layout analysis, and conversation history from prior turns. You cannot reproduce this fidelity synthetically.

---

## Failure Taxonomy: Five Pathologies

Before curating cases, we needed to know what to test. We watched agent sessions fail and identified five recurring patterns — not through theoretical analysis, but by reading traces.

### 1. Find-element loops

The agent calls `find_element("Submit")` five or more times, even though the submit button is already visible as `[14] <button> "Submit"` in the tagged element list. The information is right there in the system prompt. The agent ignores it.

This is the most common failure mode. The agent has been trained on patterns where searching is the safe default — and it over-applies that pattern even when the answer is staring at it. The correct behavior is `click_element({id: 14})`. One call, not five.

### 2. Post-escalation repetition

When the executor model (GPT-4.1 Mini) fails, it escalates to the planner model (MiniMax M2.5). The planner model receives a distilled context summary of what happened. And then it repeats the exact same failing tool call. Same tool, same arguments, same result. The escalation bought a more capable model but the model didn't *read* the context telling it what already failed.

### 3. Disabled button clicking

The agent sees a submit button and clicks it. Nothing happens — the button is disabled because a required input field is empty. The agent clicks it again. And again. It never inspects the button's state, never looks at what preconditions might enable it. The correct behavior is to check the `disabled` attribute, find the missing input, fill it, and *then* click submit.

### 4. Tool calls as text

The LLM outputs something like `{"name": "click_element", "arguments": {"id": 7}}` as plain text in its response, instead of using the structured `tool_calls` API. The text looks like a tool call to a human reader, but the system doesn't execute it because it's not in the right format. The agent narrates its intent without acting.

### 5. Marathon sessions without termination

The agent runs for 100+ turns, cycling between reading the page, calling tools that don't advance the goal, and reading the page again. It never calls `done()` to declare completion or `escalate()` to ask for help. Token consumption compounds. Nothing useful happens after turn 15.

These five pathologies accounted for the majority of failures in our trace dataset. More importantly, each one suggests a specific system prompt fix — which is exactly what we wanted the eval system to produce.

---

## Golden Cases: Curating Ground Truth from Traces

We built an extractor that pulls a specific turn from a trace session and constructs an eval case with corrected expectations:

```bash
npm run evals extract <session-id> <turn> \
  --tag find_element_loop \
  --correct-tool click_element \
  --correct-args '{"id": 14}'
```

The extractor reads the turn's real system prompt (with all visible elements and perception output), the real conversation history, and the real LLM response. It then replaces the expected tool calls with what the agent *should* have done — specified via `--correct-tool` and `--correct-args`.

Each golden case is tagged with its pathology. We curated 10 cases — two per pathology — from six different trace sessions. The cases range from 32KB to 63KB each, mostly due to the system prompt, which faithfully reproduces the agent's full context at that turn: tagged elements, page interpretation, conversation history, tool results from prior turns.

The structure of a golden case:

```typescript
{
  id: "find-element-loop-001",
  sourceSessionId: "3f9dd628-...",
  sourceTurn: 7,
  strategy: "golden",
  input: {
    systemPrompt: "You are OpenSidebar, an autonomous browser agent...",  // 12K+ chars
    conversationHistory: [...],  // real messages from the trace
    model: "openai/gpt-4.1-mini",
  },
  expected: {
    toolCalls: [{ toolName: "click_element", args: { id: 14 } }],  // corrected
    text: null,
  },
  metadata: {
    pathology: "find_element_loop",
    tags: ["golden", "find_element_loop"],
    url: "https://example.com/checkout",
    query: "Complete the checkout process",
  },
}
```

This is the key insight: the inputs are real (from the trace), but the outputs are corrected (by a human). The eval measures whether the agent, given that exact context, produces the corrected behavior. If it doesn't, the judge explains why and suggests a prompt fix.

### Why two per pathology?

One case might succeed because the fix is trivial for that specific page. Two cases make a fluke pass less likely. It's not a statistically rigorous sample — at 10 cases total, it can't be — but it covers the failure surface well enough to be actionable. This follows the "golden dataset curation" practice established in evaluation research: a small, high-quality, manually reviewed set that serves as a regression suite, not a benchmark [Ribeiro et al., 2020].

---

## The Three-Layer Scoring System

When a golden case is replayed against the LLM, the result passes through three scoring layers.

### Layer 1: Mechanical scoring

Three automated metrics compare the expected and actual tool calls:

1. **Tool name match** — Set intersection. If the expected tools are `{click_element}` and the actual tools are `{find_element, click_element}`, the score is 1/1 = 1.0 (the expected tool was present). If the expected is `{click_element}` and the actual is `{find_element}`, the score is 0/1 = 0.0.

2. **Parameter match** — For each tool name that matches, fuzzy comparison of arguments. Integer IDs must match exactly. Strings are compared case-insensitively. Other numbers get 10% tolerance.

3. **Sequence match** — Levenshtein distance between the ordered list of tool names, normalized to 0–1. Catches cases where the right tools were called but in the wrong order, or with extra steps in between.

A composite score is computed with weights: 0.45 name + 0.25 params + 0.30 sequence. A case passes the mechanical check if tool name match >= 0.8 and sequence match >= 0.7.

These thresholds are deliberately generous. Mechanical scoring catches obvious failures — calling the completely wrong tool — but can't evaluate whether a different-but-reasonable tool choice was actually fine. That's what the judge is for.

### Layer 2: LLM-as-judge

Every case — not just failures — goes to a judge model. We use Claude Sonnet via OpenRouter with a structured rubric.

The rubric has five dimensions, each scored 0–10:

| Dimension | What It Measures |
|-----------|-----------------|
| **toolSelection** | Did the agent pick the right tool for what's visible on screen? |
| **parameterAccuracy** | Were element IDs, text values, and arguments correct? |
| **efficiency** | Minimal steps, no redundant actions? |
| **antiPatternAvoidance** | Did it avoid the known bad patterns (find_element loops, disabled button clicking, text-as-toolcall, etc.)? |
| **reasoningQuality** | Does the think block show correct observe-reason-act logic? |

The judge receives:
- The first 2,000 characters of the system prompt (enough to see the instructions and element list)
- The "Visible Elements" section extracted from the system prompt (capped at 1,500 characters)
- The pathology tag (so it knows what failure pattern to look for)
- Expected vs. actual tool calls
- Expected vs. actual text output

The critical output field is `promptFixSuggestion` — a specific system prompt edit that would prevent the observed failure. Not "improve the prompt" but something like: *"Add a rule: Before calling find_element, check if any visible [N] tag matches the target. If so, use click_element({id: N}) directly."*

A case passes the judge check if `toolSelection >= 6` AND `antiPatternAvoidance >= 6`. The judge can override a mechanical failure — if the agent chose a different-but-correct approach that the mechanical scorer missed, the judge recognizes it.

### Layer 3: The critique report

All results feed into a structured markdown report with four sections:

1. **Summary** — Pass rate, average scores, judge dimension averages across all cases.

2. **Per-pathology breakdown** — Sorted worst-first. If `find_element_loop` cases are failing at 0% while `marathon_no_done` cases pass at 100%, the pathology table tells you exactly where to focus.

3. **Failed case details** — For each failure: the expected vs. actual tool calls, the judge's reasoning, its scores, and its prompt fix suggestion. Up to 20 cases detailed.

4. **Prompt improvement recommendations** — This is the payoff. The judge's `promptFixSuggestion` values are aggregated across cases, deduplicated by pathology, and ranked:
   - **HIGH** priority: Suggestion appeared in 3+ failures
   - **MED** priority: Appeared in 2 failures
   - **LOW** priority: Appeared in 1 failure

The output is a ranked list of specific system prompt edits, ready to apply.

---

## The Feedback Loop

The eval system is designed to be a closed loop:

```
Record traces  →  Extract golden cases  →  Run critique  →  Read report
                                                              |
                                              Apply prompt fixes from recommendations
                                                              |
                                              Re-run critique to verify improvement
```

The loop works because each component produces inputs for the next:

- **Traces** produce raw data about agent behavior
- **Extraction** converts raw data into eval cases with corrected expectations
- **Critique** replays, scores, judges, and produces a report
- **The report** contains specific prompt edits ranked by priority
- **Applying the edits** changes the agent's behavior on the next run
- **Re-running critique** verifies the edits actually fixed the failures

This is eval-driven prompt optimization — a pattern that has emerged independently in several systems. DSPy [Khattab et al., 2023] automates prompt optimization using a training set and an objective function. GEPA [Guo et al., 2025] generates natural language critiques of agent failures and uses them to refine system prompts. Our system occupies a middle ground: the optimization isn't automated (a human reads the report and applies the fixes), but the critiques are generated by a strong judge model with access to the full context of each failure.

The manual step is intentional. Automated prompt optimization can introduce regressions — fixing one pathology while breaking another. By keeping a human in the loop, we can apply judgment about which suggestions to accept, how to phrase them, and whether they conflict with existing instructions.

---

## Grounding in the Literature

This system didn't emerge from reading papers — it emerged from staring at broken traces and asking "why does this keep happening?" But the patterns we converged on have theoretical backing.

### LLM-as-Judge (G-Eval)

Liu et al. [2023] introduced G-Eval: using LLMs with chain-of-thought and structured rubrics to evaluate text quality. The key finding was that LLM judges with explicit scoring criteria outperform traditional metrics and correlate more highly with human judgment. Our rubric follows this pattern — five named dimensions with specific scoring criteria, applied per-case rather than holistically.

The decision to judge *every* case (not just failures) also comes from the G-Eval pattern. You need judge scores on passing cases to establish baselines and detect false passes — cases that the mechanical scorer marks as passing but the judge identifies as low-quality.

### Failure Taxonomy (Microsoft AIFS)

Wang et al. [2025] built the Agent Introspection for Failure Sensemaking (AIFS) taxonomy for Microsoft Copilot, categorizing agent failures into specific, diagnosable types. Their taxonomy enabled targeted interventions: rather than trying to "improve the agent generally," you fix the specific failure class that's responsible for the most user impact.

Our pathology system is a simplified version of the same idea. Five named failure types, two test cases each, with the report's per-pathology breakdown showing exactly which types the agent still fails on. The taxonomy turns "the agent sometimes fails" into "the agent fails at find_element loops 100% of the time and marathon termination 50% of the time." The second statement is actionable; the first is not.

### Eval-Driven Prompt Optimization (DSPy/GEPA)

Khattab et al. [2023] demonstrated with DSPy that LLM programs can be optimized by evaluating them against a metric and adjusting prompts automatically. Guo et al. [2025] extended this with GEPA, which generates natural language critiques of agent failure trajectories and uses them to refine prompts.

Our `promptFixSuggestion` field is a lightweight version of GEPA's critique-to-fix pipeline. The judge analyzes what went wrong and proposes a specific system prompt edit. The aggregation in the report (ranking by frequency and priority) mirrors DSPy's approach of optimizing based on the most impactful failures first.

### Golden Dataset Curation

The practice of curating a small, high-quality evaluation set from production data — rather than generating synthetic test cases — is well-established. Ribeiro et al. [2020] with CheckList argued that targeted test suites organized by failure type outperform aggregate benchmarks. Our golden cases follow this principle: 10 cases organized by 5 failure types, each extracted from real production traces with manually corrected expectations.

The size (10 cases) is deliberately small. This is a regression suite, not a benchmark. It answers "did we break something?" and "did our fix work?" — not "what is the agent's aggregate capability?" For aggregate capability measurement, you'd use the full auto-converted case set. For prompt iteration, the golden cases are more useful because each one represents a specific, named failure with a known correct answer.

---

## The Judge Rubric in Detail

The five scoring dimensions aren't arbitrary. Each one targets a specific failure mode that appeared repeatedly in our traces.

### Tool Selection (targets: find-element loops, post-escalation repetition)

*"Did the agent pick the right tool for what's visible on screen?"*

This dimension catches the most common failure: the agent choosing `find_element` when `click_element` is the right call. The judge has access to the visible element list — it can see that `[14] <button> "Submit"` is right there. If the agent searched for "Submit" instead of clicking element 14, the tool selection score drops.

It also catches post-escalation repetition: if the expected behavior after escalation is to try a *different* tool (e.g., `inspect_hidden` instead of another `click_element`), and the agent repeats the same call, the judge scores tool selection low.

### Parameter Accuracy (targets: wrong element IDs)

*"Were element IDs, text values, and arguments correct?"*

A subtler failure mode: the agent picks the right tool but passes the wrong parameters. It calls `click_element({id: 7})` when the target is element 14. This often happens after a stale snapshot — the agent remembered an old element ID that no longer maps to the intended element.

### Efficiency (targets: marathon sessions, redundant steps)

*"Did the agent take the minimum steps needed?"*

Marathon sessions (100+ turns) score zero on efficiency. But this dimension also catches smaller inefficiencies: calling `read_page` before every action even when the page hasn't changed, or executing three tool calls when one would suffice.

### Anti-Pattern Avoidance (targets: all five pathologies)

*"Did the agent avoid known bad patterns?"*

This is the meta-dimension. The rubric explicitly lists the five pathologies:
- Repeating a failed tool call with the same args
- Calling `find_element` when the target has a visible tag
- Clicking disabled buttons without checking state
- Outputting tool call JSON as text
- Cycling without calling `done()` or `escalate()`

If the agent exhibits any of these patterns, this dimension drops to near-zero. Combined with the pass criterion (`antiPatternAvoidance >= 6`), this means any case exhibiting a known pathology will fail the judge — even if the mechanical scorer thinks it passed.

### Reasoning Quality (targets: narration without action, poor think blocks)

*"Does the agent's text output show correct observe-reason-act logic?"*

Some agents produce beautiful explanations of what they see and what they should do — then take the wrong action. Others take the right action with no reasoning, making it impossible to verify the decision was intentional. This dimension rewards think blocks that show the agent referencing visible elements, considering options, and arriving at a justified decision.

---

## Running the System

The entire flow is a single command:

```bash
# Full critique: replay → score → judge → report
npm run evals:critique

# Filter by pathology
npm run evals:critique -- --tag find_element_loop

# Structural validation (no API key needed)
make evals-validate
```

`evals:critique` loads all golden cases from `evals/golden/*.json`, replays each against the LLM via OpenRouter, scores with the three mechanical metrics, judges with Claude Sonnet, and writes a markdown report to `evals/reports/`.

For rapid iteration, you can filter by pathology tag. If you just pushed a prompt fix targeting `find_element_loop`, run `--tag find_element_loop` to check only those cases instead of the full suite.

Structural validation (`make evals-validate`) runs offline with no API key. It parses all golden files, checks for missing fields, validates tool names against the registry, and detects duplicate IDs. This is the CI gate — it runs on every commit to ensure the golden dataset isn't corrupted.

---

## What We Learned

### Empty inputs are invisible

The original converter was producing empty system prompts and nobody noticed for months. The tests passed (they tested the conversion logic, not the content). The runner ran (it sent whatever it was given). The scores were low but plausible ("the agent is bad at this case"). The failure was completely silent.

This is a general principle: eval pipelines that don't validate their inputs will produce results that look reasonable but mean nothing. Our first fix — before the judge upgrade, before golden cases, before pathology tags — was adding a check that `systemPrompt.length > 0` in the runner. One line of code that would have saved weeks of useless eval runs.

### Judge context matters more than judge capability

We upgraded from GPT-4o-mini to Claude Sonnet and the judge output improved significantly — but the bigger improvement came from giving the judge the right context. The original judge saw expected vs. actual tool calls and nothing else. The upgraded judge sees the system prompt excerpt, the visible element list, and the pathology tag.

With context, the judge can evaluate *reasoning*, not just outputs. It can say: "The agent called `find_element('Submit')` but element [14] is a button labeled 'Submit' — the agent should have used `click_element({id: 14})`." Without context, it can only say: "The expected tool was click_element and the actual tool was find_element."

The `promptFixSuggestion` field is entirely dependent on context. You can't suggest a prompt edit if you don't know what the prompt says. By passing the first 2,000 characters of the system prompt to the judge, we enable it to identify which instruction is missing or misleading and propose a specific addition.

### Two cases per pathology is the right starting point

We considered extracting more cases — 5 per pathology, or 10, or all failing turns. We stopped at two for a practical reason: each golden case is 32–63KB and takes 5–15 seconds to replay and judge. At 10 cases, the full critique runs in under 3 minutes. At 50 cases, it would take 15+ minutes and cost meaningfully more in API calls.

Two cases per pathology is enough to distinguish "we fixed it" from "we got lucky on one case." It's not enough for statistical confidence about the agent's capability, but that's not the goal. The goal is a fast, actionable feedback loop for prompt iteration.

### The report is the product

The code, the scorer, the judge, the extractor — they're all infrastructure. The actual product is the markdown report. Specifically, the "Prompt Improvement Recommendations" section. Everything else exists to produce that ranked list of specific prompt edits.

When the report says:

> 1. **[HIGH]** (find_element_loop, 2x) Add a rule: "Before calling find_element, scan visible elements for a matching [N] tag. If found, use click_element({id: N}) directly."

That's actionable. A developer can open the system prompt, add that sentence, re-run `npm run evals:critique -- --tag find_element_loop`, and verify the fix in under two minutes. This tight loop — from failure observation to prompt fix to verification — is what makes the eval system useful, not the scores.

---

## Limitations

### Small dataset, no statistical power

Ten golden cases cannot measure the agent's overall capability. They measure whether five specific failure patterns are present. If a new failure pattern emerges that isn't in the taxonomy, the eval suite won't catch it.

The mitigation is straightforward: as new failures appear in production traces, extract golden cases for them. The extraction workflow (`npm run evals extract ...`) makes this a 60-second operation. The taxonomy grows as the agent's failure surface evolves.

### Judge reliability

LLM-as-judge is not perfectly reliable. Lu et al. [2025] showed in AgentRewardBench that no single LLM excels as a judge across all benchmarks. Our judge uses Claude Sonnet, which is strong but not infallible. A judge error on one of 10 cases shifts the pass rate by 10%.

We address this partially by having the judge explain its reasoning — the `reasoning` field in the judge output. When a case unexpectedly passes or fails, a developer can read the judge's reasoning and decide whether to override the verdict manually.

### Replay fidelity

Replaying a trace turn against the LLM means sending the same inputs but getting (potentially) different outputs. The LLM is not deterministic — even with temperature 0, there's some variation in tool calls across runs. A case that passes on one replay might fail on the next.

This is inherent to LLM evaluation and not specific to our system. The standard mitigation is multiple replays per case and majority voting, but at 5–15 seconds per replay, this would significantly slow the feedback loop. We accepted single-replay fidelity as a tradeoff for speed.

### Manual prompt fixes

The feedback loop includes a human step: reading the report and applying the suggested prompt fixes. This is deliberate (automated prompt optimization can introduce regressions) but it's also a bottleneck. The system produces recommendations faster than a developer can evaluate and apply them.

Future work might semi-automate this: generate candidate prompt edits, apply them in a sandbox, re-run the eval suite, and present the developer with "this edit fixed 2 cases and broke 0" — reducing the human's job from "evaluate the suggestion and write the edit" to "approve or reject."

---

## References

### Papers

1. Liu, Y., Iter, D., Xu, Y., Wang, S., Xu, R., & Zhu, C. (2023). G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment. arXiv:[2303.16634](https://arxiv.org/abs/2303.16634)

2. Khattab, O., Singhvi, A., Maheshwari, P., Zhang, Z., Santhanam, K., Vardhamanan, S., ... & Potts, C. (2023). DSPy: Compiling Declarative Language Model Calls into Self-Improving Pipelines. arXiv:[2310.03714](https://arxiv.org/abs/2310.03714)

3. Ribeiro, M. T., Wu, T., Guestrin, C., & Singh, S. (2020). Beyond Accuracy: Behavioral Testing of NLP Models with CheckList. ACL 2020. arXiv:[2005.04118](https://arxiv.org/abs/2005.04118)

4. Wang, Z., et al. (2025). Agent Introspection for Failure Sensemaking. Microsoft Research.

5. Guo, S., et al. (2025). GEPA: Generating Evaluative Prompt Analyses for Agent Improvement. arXiv preprint.

6. Lu, X. H., Wang, Z., De Wynter, A., Ding, L., Peng, B., Ahmed, N., & Ritter, A. (2025). AgentRewardBench: Evaluating Automatic Evaluations of Web Agent Trajectories. arXiv:[2504.08942](https://arxiv.org/abs/2504.08942)

7. Zhou, S., Xu, F. F., Zhu, H., Zhou, X., Lo, R., Sridhar, A., ... & Neubig, G. (2023). WebArena: A Realistic Web Environment for Building Autonomous Agents. arXiv:[2307.13854](https://arxiv.org/abs/2307.13854)
