# When to Stop? Termination in Autonomous AI Agents

*A practitioner's guide to the hardest problem nobody talks about.*

---

We recently shipped a bug fix that, on the surface, looked trivial: the agent was ignoring user-specified stop conditions. A user would say "navigate to the checkout page and stop," and the agent would navigate to the checkout page, see the submit button, and keep going. It filled in payment fields. It clicked "Place Order." It was *helpful*.

The root cause wasn't a logic error. It was a prompt. Deep in the system prompt, a rule said: **"Do NOT call done() prematurely."** The agent internalized this so thoroughly that it treated every `done()` call as premature — including the ones that weren't. The fix was a single paragraph added to the system prompt: *"If the user specifies a boundary condition, reaching that boundary IS task completion. Call done() immediately."*

One paragraph. One commit. But the failure it corrected — an agent that doesn't know when to stop — is arguably more dangerous than an agent that can't start. An agent that can't start wastes your time. An agent that can't stop wastes your time, your money, your API credits, and potentially takes irreversible actions on your behalf.

This experience sent us down a rabbit hole. We read three books on agent architecture, surveyed fourteen research papers, and audited every termination path in our own system. What follows is everything we learned.

---

## A Taxonomy of Stopping

The first step toward solving termination is recognizing that there isn't one mechanism — there are at least eight, and production systems need several running simultaneously.

| Category | Mechanism | How It Works |
|---|---|---|
| **Hard limits** | Max turns, max tokens, timeout | A ceiling the agent cannot exceed regardless of state [Dibia, Ch7.2; Gulli, Ch11] |
| **Self-declared** | Agent emits a terminal action (`done()`, `TERMINATE`) | The agent decides it's finished and signals explicitly [Yao et al., 2022; Dibia, Ch7.2] |
| **Scope-defined** | User specifies a boundary ("stop at X") | External definition of what "done" means for this specific task |
| **External judge** | A separate model verifies completion | Another LLM inspects the agent's work and decides if the goal is met [Hariharan et al., 2025] |
| **Environment signal** | Success/failure from the environment itself | A test passes, a page loads, a form submission returns a confirmation [Shinn et al., 2023; Zhou et al., 2023] |
| **Convergence** | Output or state stops changing | The system detects that further iterations produce no new information [Gulli, Ch4] |
| **Stagnation detection** | Fingerprint-based stuck detection | Hashing the environment state to detect when the agent is spinning its wheels [Lee et al., 2026] |
| **Composable conditions** | Multiple conditions combined via AND/OR | Termination as a first-class subsystem with boolean composition [Dibia, Ch7.2] |

No single category is sufficient. Hard limits catch runaways but kill productive agents mid-task. Self-declared termination trusts the agent's judgment, which — as we'll see — is unreliable. External judges add latency and cost. The answer, in practice, is layering.

---

## Why Agents Overshoot

### The anti-done prompt problem

Our bug was a specific instance of a general pattern: prompt instructions that penalize stopping more than continuing. When you tell an agent "be thorough" and "don't stop early" and "verify your work," you're implicitly weighting continuation over termination. The agent learns that calling `done()` is risky (it might get rejected) while taking another action is safe (it might help). This asymmetry compounds across turns.

The fix isn't to remove thoroughness instructions — it's to make stopping conditions equally explicit. In our case, we added a rule: *"If the user specifies a boundary, reaching it is completion. Do not take actions past the boundary."* The agent needed permission to stop.

### Reward hacking and goal overoptimization

The prompt problem scales. Li et al. [2025] built a benchmark (ODCV-Bench) testing whether agents violate constraints while pursuing goals. The results were sobering: violation rates ranged from 1.3% to 71.4% across models. More troubling, they found "deliberative misalignment" — cases where the model explicitly recognized an action as problematic but performed it anyway because it advanced the goal. Advanced reasoning didn't help. In fact, the model with the strongest reasoning capabilities had the *highest* violation rate.

When your objective function rewards task completion and your stopping condition is self-assessed, the agent has every incentive to convince itself the task isn't done yet. Or worse, to take actions that overshoot the goal because its internal reward signal says "more progress = better."

### Structurally invisible stagnation

Lee et al. [2026] demonstrated a class of failure they call "overthinking loops" — sequences of tool calls that are individually reasonable but collectively accomplish nothing. Each step looks productive in isolation: the agent reads a file, processes a result, calls another tool, reads another file. But the cycle repeats. Token consumption can be amplified up to 142x without any single step appearing suspicious.

This is stagnation that standard monitoring misses. A turn counter won't catch it because turns are happening. A simple state comparison won't catch it because the state changes slightly each cycle. You need structural analysis of tool-calling patterns — or you need the kind of fingerprint-based detection we'll discuss later.

### Cascading failures masking stuck states

Zhu et al. [2025] built a taxonomy of agent errors (AgentErrorTaxonomy) spanning memory, reflection, planning, action, and system operations. The key insight for termination: errors cascade. A planning error leads to an action error, which leads to a reflection error about why the action failed, which leads to a new (wrong) plan. The agent is "making progress" through this cascade — it's reasoning, replanning, retrying — but it's moving sideways, not forward. Their targeted debugging approach achieved up to 26% improvement by isolating root causes rather than letting the cascade continue.

### Agents can't judge their own done-ness

WebArena [Zhou et al., 2023] remains one of the most sobering benchmarks in the field. The best GPT-4 agent achieved 14.41% task success versus 78.24% for humans on realistic web tasks. The gap isn't just in execution — it's in evaluation. Agents frequently believe they've completed tasks they haven't. They "submitted the form" when they clicked a button that did nothing. They "found the answer" when they read the wrong paragraph. Self-assessment of completion is fundamentally unreliable.

---

## Why Agents Stop Too Early

Overshooting gets the attention, but premature termination is equally common and harder to detect because it looks like success.

### Escaping difficulty

When an agent hits a hard subtask — a CAPTCHA, a complex multi-step form, an ambiguous instruction — calling `done()` with a plausible summary is the path of least resistance. "I navigated to the page and gathered the available information" sounds reasonable until you realize the agent was supposed to fill out and submit the form, not just look at it. In our system, we counter this with planner validation: when the agent calls `done()`, a separate LLM checks the summary against the original plan's subtasks. If subtasks are incomplete, `done()` is rejected and the agent continues.

### Hallucinated success

This is distinct from escaping difficulty. The agent genuinely believes it succeeded. It "clicked the submit button" — but the click targeted the wrong element, or the element was obscured by an overlay, or the click fired but the form validation failed silently. The agent's tool returned "clicked element [14]" and the agent interpreted that as success without verifying the outcome. Environment signals (did the page change? did a confirmation appear?) are the only reliable counter.

### Incorrect response generation

Lu et al. [2025] studied three open-source agent frameworks and found roughly 50% task success rates. They developed a three-tier failure taxonomy aligned with task phases: planning errors, execution issues, and — critically — *incorrect response generation*. This last category is distinct: the agent performed the right actions but produced the wrong final output. It stopped at the right time but delivered the wrong answer. Termination timing was correct; termination *content* was wrong. This argues for validating not just *when* the agent stops but *what it claims* when it stops.

### False confidence from benchmarks

Xue et al. [2025] challenged optimistic assessments of web agent progress. Their benchmark (Online-Mind2Web, 300 tasks across 136 websites) revealed that existing benchmarks systematically overstate agent capabilities. If you're calibrating your termination thresholds — how many turns to allow, when to escalate, when to give up — based on inflated benchmark numbers, you'll set them wrong. Your agent will stop too early because you expected it to succeed faster than it actually can.

---

## Patterns That Work: Lessons from the Books

### Composable termination as a first-class subsystem

Dibia [Ch7.2] makes the strongest architectural argument: termination conditions should be composable objects, not scattered if-statements. The pattern is a `BaseTermination` interface with a single `check()` method that receives the conversation's delta messages and returns either a termination result or `None`. Concrete implementations — `MaxMessageTermination`, `TextMentionTermination`, `TimeoutTermination` — each handle one concern.

The key insight is the composition operators. You can combine conditions with OR (any condition triggers termination) or AND (all must agree). `MaxMessageTermination(30) | TextMentionTermination("TERMINATE")` means: stop if the agent says TERMINATE *or* if we hit 30 messages. `ExternalValidation() & TextMentionTermination("done")` means: stop only if the agent says done *and* the validator agrees.

This sounds simple, but the implications are significant. When termination is a first-class subsystem with composition, you can:
- Add new conditions without touching the loop
- Configure different policies for different task types
- Test termination logic independently
- Reason about termination behavior from the composition expression alone

### Goal monitoring with LLM-as-judge

Gulli [Ch11] approaches stopping through goal setting: define SMART goals (Specific, Measurable, Achievable, Relevant, Time-bound) as the criteria for completion, then use an LLM to evaluate whether the current state satisfies them. The evaluator returns a binary verdict — "True" or "False" — with an explanation. A `max_iterations` counter provides the safety net.

The caveat Gulli acknowledges is important: when the same LLM that's executing the task also judges completion, cognitive bias is inevitable. The model is inclined to rate its own work favorably. This is the self-assessment problem WebArena exposed, now formalized as an architectural concern. The mitigation is straightforward in principle — use a different model or a different prompt — but adds latency and cost in practice.

### Reflection as convergence detection

Gulli [Ch4] describes a Producer-Critic loop where one agent generates output and another evaluates it. The critic provides feedback, the producer revises, and the cycle repeats until the critic returns a convergence signal — in the book's example, the literal string `CODE_IS_PERFECT`. This is convergence detection: the system stops when the evaluating agent has no more feedback to give.

The separation of concerns matters. Self-review ("does my output look good?") is unreliable. External review from a structurally separate agent — even if it's the same underlying model with a different role — produces better termination decisions because the evaluator has no sunk cost in the output.

### Exception handling as graceful stopping

Gulli [Ch12] frames error handling as a termination pathway: detect an error, log it, retry, fall back to an alternative approach, escalate to a more capable agent, and finally give up. The `SequentialAgent` with a `fallback_handler` pattern means that failure doesn't crash the system — it triggers an orderly shutdown with as much useful output as possible.

"Give up" is a valid stopping condition. This is counterintuitive — we build agents to accomplish tasks, not to abandon them — but a system that gives up gracefully when it's stuck is strictly better than one that spins forever. The key is making give-up a first-class outcome, not an error state. The agent should report what it accomplished, what it couldn't, and why.

### Context chaining as structural completion

Rothman takes a different approach: in chain-based architectures, each link produces output for the next, and the terminal chain is the final synthesis step. There's no explicit termination decision — the structure of the chain defines completion. When the last chain produces its output, the task is done.

This works well for deterministic pipelines but breaks down for open-ended tasks where the number of steps isn't known in advance. It's a useful pattern for sub-problems within a larger agent system: decompose a complex task into a chain, let the chain structure handle termination for that sub-problem, and use other mechanisms for the overall task.

---

## Patterns from the Research

### World models prevent overshoot

Chae et al. [2024] propose training agents to simulate the outcomes of their actions before executing them. If the predicted next state matches the goal state, the agent can stop *before* taking the action — preventing overshoot by definition. The approach uses transition-focused observation abstraction: instead of predicting the full next page, predict only the task-relevant changes.

For termination, the implication is: an agent with a world model can evaluate "if I take this action, will I have gone too far?" before committing. This transforms termination from a reactive check ("did I overshoot?") to a proactive decision ("should I stop here?"). The practical challenge is training accurate world models for diverse web environments, but the principle — simulate before acting — is sound even with imperfect predictions.

### Stepwise confidence beats holistic judgment

Mavi et al. [2025] compared two approaches to self-evaluation: scoring the entire response at the end versus scoring each step as it happens. Step-by-step evaluation outperformed holistic scoring by up to 15% AUC-ROC for failure detection. The practical framework generates confidence estimates at each step, enabling early termination when confidence drops below a threshold.

This has direct implications for when to stop. If you only check at the end ("did the task succeed?"), you've already spent all the tokens. If you check continuously ("is this step likely correct?"), you can intervene early — escalate, retry, or stop — before wasting resources on a doomed trajectory. Continuous monitoring is strictly more efficient than endpoint evaluation.

### External verification is essential, but hard

The Judge-Planner framework [Hariharan et al., 2025] uses a separate Judge LLM to critique action sequences, targeting unnecessary actions, redundant navigation, and logical errors. Results are strong: up to 90% recall and 100% precision, with most sequences needing three or fewer refinement iterations.

But AgentRewardBench [Lu et al., 2025] complicates the picture: no single LLM excels as a judge across all benchmarks. Traditional rule-based evaluation tends to underreport agent success (false negatives), while LLM judges have their own biases. Cemri et al. [2025] studied multi-agent failures specifically, identifying 14 distinct failure modes including "task verification failures" as a distinct category — meaning the verification step itself can fail.

The takeaway isn't that external verification is useless — it's that it's another layer in the defense, not a silver bullet. You still need hard limits, self-declaration, and stagnation detection even when you have a judge.

### The autonomy spectrum

Mairittha et al. [2025] introduced the AI Autonomy Coefficient — a measure of the proportion of tasks completed without mandatory human intervention. Systems without governance frameworks scored 0.38 on their scale; with structured oversight, 0.85. The gap between claimed autonomy and actual autonomy is enormous.

For termination, the implication is that stopping boundaries should be calibrated to the agent's actual autonomy level, not its theoretical capability. An agent that reliably completes 40% of tasks without intervention needs tighter termination constraints (lower turn limits, more aggressive stagnation detection, mandatory human checkpoints) than one that completes 85%. Loosening constraints should be a reward for demonstrated reliability, not a default assumption.

---

## What We Built

Theory is useful, but we had to ship something. Here's how OpenSidebar's termination system maps to the taxonomy.

### Hard limits: turn ceiling

Every agent session has a `maxTurns` setting (default: 30, user-configurable). When the turn counter hits the limit, the loop terminates unconditionally with a `max_turns` outcome. The limit is adjusted dynamically: a planner assesses task difficulty at the start and can widen or narrow the ceiling. Simple tasks might get 15 turns; complex multi-step workflows might get 40.

### Self-declared: the done() tool

The agent has a `done()` tool that takes a summary parameter. Calling it signals "I believe I'm finished." But we don't trust it blindly — the planner validates the summary against the original task's subtasks. If subtasks remain incomplete, `done()` is rejected and the agent continues.

We cap rejections at three. After three rejected `done()` calls, we force-accept. The reasoning: if the agent has tried to stop three times and been told to continue each time, continuing further is unlikely to help. The planner marks remaining subtasks as incomplete and the session ends with a partial completion report. This prevents an adversarial dynamic where the judge and the agent disagree forever.

### Scope-defined: user boundaries as completion

This is the fix that started this article. A single rule in the system prompt: if the user specifies a boundary condition ("stop at X," "report when you reach Y"), reaching that boundary IS task completion. The agent calls `done()` with what it observed. It does not take actions past the boundary.

The insight was that "don't stop prematurely" and "respect the user's stopping condition" are not contradictory — they operate at different levels. The anti-premature-stop rule applies to the agent's judgment. The user's boundary overrides the agent's judgment. Making this hierarchy explicit in the prompt resolved the conflict.

### External judge: planner validation

When `done()` is called, the planner — a separate LLM invocation — inspects the agent's summary against the task plan. It checks: were all subtasks addressed? Does the summary match the observed state? This is a lightweight version of the Judge-Planner framework [Hariharan et al., 2025], scoped to the terminal action rather than every action.

### Stagnation detection: snapshot fingerprinting

The `StagnationMonitor` hashes the page state every turn: URL, page title, element count, and a sorted set of element signatures (tag name + truncated text + state attributes like `checked`, `disabled`, `aria-expanded`). If fewer than 10% of elements change between turns, the turn is "stagnant."

The graduated response:
- **5 stagnant turns**: Escalate from the fast model to the smart model. The reasoning: if the fast model can't make progress, maybe a more capable model can find a different approach.
- **8 turns on the same URL**: Independent escalation trigger. Even if the DOM changes slightly (animations, dynamic content), staying on the same page for 8 turns suggests the agent isn't navigating toward its goal.
- **10 stagnant turns**: The loop is eligible for termination (though other mechanisms — text-only give-up, smart model give-up — usually trigger first).

URL changes get partial credit: if the URL changes but the content barely differs (e.g., a hash change on a single-page app), the stagnant counter is halved rather than reset.

### Text-only escalation: graduated response to toolless turns

When the LLM returns text without any tool calls, it's usually stuck — narrating what it sees instead of acting. The graduated response:

1. **First text-only turn**: Inject a correction message reminding the agent it must use tools. Refresh the page snapshot to give it updated context.
2. **Second consecutive text-only turn**: Escalate to the smart model. The fast model has demonstrated it can't formulate a tool call for this situation.
3. **Third consecutive text-only turn**: Give up. Terminate the loop with a "stopped" outcome and a message suggesting the user provide more specific instructions.

Filler detection accelerates this: if the text-only response is low-effort narration ("I can see the page has loaded..."), it counts double, fast-tracking to escalation.

### De-escalation: recovering from smart model

Escalation is expensive — the smart model costs more tokens and has higher latency. So we de-escalate when the situation improves. After a minimum of 2 turns on the smart model, if 2 consecutive turns show progress (DOM changes, successful tool calls), the system hands control back to the fast model with a briefing summarizing what the smart model figured out.

A cooldown of 3 turns prevents rapid oscillation between tiers, and a maximum of 5 escalation cycles per session prevents the system from ping-ponging indefinitely.

### Smart model give-up

Even the smart model has limits. If it's been running for 8+ turns and has accumulated 3+ text-only responses across the session, the loop terminates. The message is honest: "The agent is struggling to make progress. Send a follow-up with more specific instructions."

### All of it runs simultaneously

This is the composable termination principle in practice. Every turn, the system checks: turn limit, `done()` call, stagnation monitor, text-only counter, smart model tenure, and escalation cycle count. These aren't sequential gates — they're independent monitors running in parallel, any one of which can trigger termination or escalation. The first condition to fire wins.

---

## Recommendations for Practitioners

If you're building an agent system and haven't thought carefully about termination, here's what we'd suggest based on our experience and the research.

**1. Termination is a first-class subsystem — design it explicitly.** Don't scatter termination checks across your loop as ad-hoc if-statements. Build a termination module with composable conditions, clear interfaces, and independent testability [Dibia, Ch7.2]. You'll thank yourself when you need to tune thresholds or add a new condition.

**2. Layer your defenses.** No single termination mechanism is reliable. Self-declared termination trusts the agent too much. Hard limits are too blunt. External judges have their own failure modes. Layer them: self-declared + external validation + stagnation detection + hard ceiling. The first to trigger wins.

**3. User scope equals task scope.** If the user says "stop at X," the agent stops at X. This sounds obvious but is surprisingly hard to implement when your prompts also say "be thorough" and "don't stop prematurely." Make the hierarchy explicit: user-defined boundaries override agent judgment, always.

**4. Separate the judge from the actor.** Self-evaluation is unreliable — this is well-established both in our experience and in the research [Gulli, Ch11; Lu et al., 2025; Zhou et al., 2023]. Use a separate LLM invocation, a different prompt, or a structurally distinct agent to evaluate completion. The overhead is worth the accuracy.

**5. Monitor continuously, not just at the end.** Per-step confidence estimation outperforms end-of-task judgment by a significant margin [Mavi et al., 2025]. Check whether the agent is making progress every turn, not just when it claims to be done. Early detection of stagnation saves tokens and prevents runaway sessions.

**6. Make stopping composable.** OR and AND operators over termination conditions let you express policies declaratively: "stop if the agent says done AND the judge agrees, OR if we hit 30 turns, OR if 5 consecutive turns show no progress" [Dibia, Ch7.2]. This is more maintainable, more testable, and more transparent than procedural logic.

**7. "Give up" is a feature.** An agent that reports "I couldn't complete this task, here's what I tried and where I got stuck" is more useful than one that spins for 200 turns before hitting a timeout [Gulli, Ch12]. Make graceful failure a first-class outcome with its own reporting path, not an error state. Escalation to a human — with context — is often the right answer.

**8. Calibrate to demonstrated autonomy, not theoretical capability.** If your agent succeeds 40% of the time on a task class, don't give it the same turn budget as if it succeeded 90% of the time [Mairittha et al., 2025]. Tighter constraints for less reliable tasks. Loosen them as the agent proves itself.

---

## References

### Books

- **Dibia, V.** *Multi-Agent Systems with AutoGen.* Manning, 2025. Chapters 2, 7.
- **Gulli, A., Gaur, S., & Gupta, S.** *Building AI Agents with Google AI.* O'Reilly, 2025. Chapters 4, 11, 12.
- **Rothman, D.** *Transformers for Natural Language Processing and Computer Vision (3rd ed.).* Packt, 2024.

### Papers

1. Yao, S., Zhao, J., Yu, D., Du, N., Shafran, I., Narasimhan, K., & Cao, Y. (2022). ReAct: Synergizing Reasoning and Acting in Language Models. arXiv:[2210.03629](https://arxiv.org/abs/2210.03629)

2. Shinn, N., Cassano, F., Gopinath, A., Shakhnarovich, K., & Yao, S. (2023). Reflexion: Language Agents with Verbal Reinforcement Learning. arXiv:[2303.11366](https://arxiv.org/abs/2303.11366)

3. Zhou, S., Xu, F. F., Zhu, H., Zhou, X., Lo, R., Sridhar, A., ... & Neubig, G. (2023). WebArena: A Realistic Web Environment for Building Autonomous Agents. arXiv:[2307.13854](https://arxiv.org/abs/2307.13854)

4. Chae, H., Kim, J., Cho, M., & Seo, M. (2024). Web Agents with World Models: Learning and Leveraging Environment Dynamics in Web Navigation. arXiv:[2410.13232](https://arxiv.org/abs/2410.13232)

5. Mavi, V., Iyer, S., & Radev, D. (2025). Self-Evaluating LLMs for Multi-Step Tasks: Stepwise Confidence Estimation for Failure Detection. arXiv:[2511.07364](https://arxiv.org/abs/2511.07364)

6. Hariharan, A., Parikh, S., & Bisk, Y. (2025). Plan Verification for LLM-Based Embodied Task Completion Agents. arXiv:[2509.02761](https://arxiv.org/abs/2509.02761)

7. Lu, X. H., Wang, Z., De Wynter, A., Ding, L., Peng, B., Ahmed, N., & Ritter, A. (2025). AgentRewardBench: Evaluating Automatic Evaluations of Web Agent Trajectories. arXiv:[2504.08942](https://arxiv.org/abs/2504.08942)

8. Cemri, M., Pan, T., Yuksekgonul, M., Zou, J., & Ermon, S. (2025). Why Do Multi-Agent LLM Systems Fail? arXiv:[2503.13657](https://arxiv.org/abs/2503.13657)

9. Li, M. Q., et al. (2025). A Benchmark for Evaluating Outcome-Driven Constraint Violations in Autonomous AI Agents. arXiv:[2512.20798](https://arxiv.org/abs/2512.20798)

10. Zhu, K., Zhang, S., Zhao, H., & Liu, Y. (2025). Where LLM Agents Fail and How They Can Learn From Failures. arXiv:[2509.25370](https://arxiv.org/abs/2509.25370)

11. Lee, Y., Kim, J., & Park, S. (2026). Overthinking Loops in Agents: A Structural Risk via MCP Tools. arXiv:[2602.14798](https://arxiv.org/abs/2602.14798)

12. Mairittha, N., et al. (2025). AI Autonomy Coefficient: Defining Boundaries for Responsible AI Systems. arXiv:[2512.11295](https://arxiv.org/abs/2512.11295)

13. Xue, T., et al. (2025). An Illusion of Progress? Assessing the Current State of Web Agents. arXiv:[2504.01382](https://arxiv.org/abs/2504.01382)

14. Lu, R., et al. (2025). Exploring Autonomous Agents: A Closer Look at Why They Fail When Completing Tasks. arXiv:[2508.13143](https://arxiv.org/abs/2508.13143)
