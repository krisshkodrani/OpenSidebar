Looking at the trace analysis from 2026-04-12 (20 traces, 95% pass rate) and the lab methodology context, I can identify several skill candidates. The single failure mode (turn_limit_reached on hover-menus) combined with the lab's empirical research charter reveals some clear patterns.

## Research Note: Workflow Skill Candidates

**Date:** 2026-04-12
**Source:** trace-analysis-2026-04-12.md (20 traces, 1 day window)
**Existing Skills Context:** lab/agents/hermes/config.yaml workflow skills

---

### Candidate 1: Hover-and-Reveal Interaction Skill

| Attribute | Value |
|-----------|-------|
| **Candidate Name** | `hover-reveal-navigation` |
| **Trigger/Workflow Shape** | Page contains dropdown menus, tooltips, or hidden elements that require mouse hover to expose clickable targets. Agent must: (1) identify element requiring hover, (2) execute mousemove to coordinates, (3) wait for DOM mutation/MutationObserver event, (4) verify revealed content is accessible, (5) proceed with click on revealed element. |
| **Why Skill vs Tool/Fix** | The hover-menus E2E failure hit 25-turn limit because generic prompting treats hover as a single action without verification loop. A tool cannot encapsulate the *decision pattern* of when to hover vs click vs scroll. This is an orchestration pattern: the agent must plan "hover wait verify next action" as an atomic sequence. Harness fixes would require hardcoding DOM heuristics; a skill preserves model discretion while providing the workflow template. |
| **Tied Traces/E2E** | `4401ad41` (hover-menus, 25 turns, turn_limit_reached). Likely affects any E2E case with hover-menus, mega-navs, or tooltip-dependent workflows. |
| **Overfitting Risk** | **Medium**. Risk of over-specifying DOM selectors or timing constants. Mitigation: skill should use generic "wait for DOM mutation" rather than specific class names; allow model to select hover targets rather than hardcoding coordinates. |

---

### Candidate 2: Turn-Budget-Conscious Planning Skill

| Attribute | Value |
|-----------|-------|
| **Candidate Name** | `budget-aware-execution` |
| **Trigger/Workflow Shape** | At session start or mid-session when remaining turns < 10 (or configurable threshold), agent must enter "conservation mode": skip exploratory actions, verify instead of retry, prefer batch operations, and surface explicit budget warnings to user. |
| **Why Skill vs Tool/Fix** | The hover-menus failure shows the agent proceeding with normal action density despite approaching limit. This is a *planning* pathology, not a tool gap. A harness fix (auto-abort at 20 turns) loses work; a skill lets the model adapt strategy consolidating verification steps, batching snapshot queries, or yielding to user. |
| **Tied Traces/E2E** | `4401ad41` (25/25 turns). Pattern likely appears in other max_turns failures not sampled in this 1-day window. |
| **Overfitting Risk** | **Low**. The skill is about meta-cognition (counting turns) rather than domain logic. Safe to generalize. |

---

### Candidate 3: Trace-Root-Cause-Synthesis Skill

| Attribute | Value |
|-----------|-------|
| **Candidate Name** | `trace-pathology-analysis` |
| **Trigger/Workflow Shape** | When given a trace ID or trace file, agent must: (1) load trace JSON, (2) identify turn sequence patterns (loops, over-calls, repeated errors), (3) correlate with harness/tool behavior, (4) classify into failure taxonomy (see lab/knowledge/failure-taxonomy.md), (5) output structured diagnosis with evidence. |
| **Why Skill vs Tool/Fix** | The lab's `lab:analyze-traces` command produces quantitative summaries (turn counts, tokens) but not qualitative root-cause diagnosis. The trace-analysis-2026-04-12.md shows *what* failed (turn_limit_reached) but not *why* the agent kept cycling. A skill encapsulates the methodology: "sample generalize classify record" from lab/README.md. |
| **Tied Traces/E2E** | All trace-driven research questions in lab/questions/. Enables `lab:research` to answer "investigate the latest traces for possible new skills" without human filtering. |
| **Overfitting Risk** | **Low-Medium**. Risk of over-weighting recent trace patterns. Mitigation: skill should reference failure-taxonomy.md as grounding, not just pattern-match on latest traces. |

---

### Candidate 4: RFC-Hypothesis-Drafting Skill

| Attribute | Value |
|-----------|-------|
| **Candidate Name** | `rfc-hypothesis-draft` |
| **Trigger/Workflow Shape** | When research identifies a harness pathology (from traces, E2E, or user reports), agent must draft an RFC following lab/rfcs/ structure: hypothesis statement, proposed change, predicted impact, verification plan. |
| **Why Skill vs Tool/Fix** | The lab README emphasizes "Write an RFC: 'We believe X because Y...'" but this is currently manual. A skill ensures consistent RFC structure and links findings to the experiment loop. Not a harness change because RFCs are pre-implementation hypotheses. |
| **Tied Traces/E2E** | Any trace pathology that leads to `lab:question` entries. Connects research findings to actionable experiments. |
| **Overfitting Risk** | **Low**. Template-driven skill; structure is fixed, content varies. |

---

### Candidate 5: Multi-Agent Delegation Pattern Skill

| Attribute | Value |
|-----------|-------|
| **Candidate Name** | `parallel-subagent-delegation` |
| **Trigger/Workflow Shape** | When task has 3+ independent subtasks (e.g., "analyze 3 competitor UIs" or "test 5 E2E cases"), agent must: (1) decompose into parallel workstreams, (2) spawn subagents with isolated context, (3) collect results, (4) synthesize without cross-contamination. |
| **Why Skill vs Tool/Fix** | The lab architecture shows Hermes spawning parallel subagents, but no explicit skill guides the orchestration pattern. Current traces may show serialized execution when parallel was possible. The `delegate_task` tool exists but using it effectively is a workflow pattern. |
| **Tied Traces/E2E** | Any trace with >10 turns on a multi-part task. Lab agents README mentions "Spawn one or more subagents to work on tasks in isolated contexts." |
| **Overfitting Risk** | **Medium**. Risk of over-delegating simple tasks. Mitigation: skill should include cost threshold (only delegate if estimated turns > 15). |

---

### Candidate 6: Knowledge-Base-Grounded-Research Skill

| Attribute | Value |
|-----------|-------|
| **Candidate Name** | `gbrain-grounded-research` |
| **Trigger/Workflow Shape** | When answering research questions, agent must: (1) query GBrain for indexed RFCs, previous research, trace analyses, (2) incorporate findings as context, (3) cite sources explicitly, (4) identify gaps requiring new experiments. |
| **Why Skill vs Tool/Fix** | The lab has GBrain indexing (lab/knowledge/, lab/research/, lab/rfcs/) but no explicit skill ensures research uses it. Current workflow may re-derive conclusions already in failure-taxonomy.md or previous trace analyses. |
| **Tied Traces/E2E** | All `lab:research` and `lab:question` workflows. Specifically relevant when "investigating latest traces" needs to compare against historical patterns. |
| **Overfitting Risk** | **Low**. Retrieval-augmented pattern; more context reduces overfitting. |

---

## Issues That Should NOT Become Skills

These belong in harness, verifier, memory, or tool layers:

| Issue | Why Not a Skill | Correct Home |
|-------|-----------------|--------------|
| **Turn limit hard cutoff at 25** | This is a harness safety boundary, not a workflow choice. The executor should manage this. | **Harness**: Configurable in harness config; consider dynamic extension requests. |
| **API key fallback logic** | Provider fallbacks (Fireworks OpenRouter) are infrastructure resilience, not agent reasoning. | **Harness/Tool**: The `delegate_task` or base executor should handle provider retries. |
| **DOM snapshot compression** | If snapshots are too large, that's a tool implementation issue (how we build the string), not an agent skill. | **Tool**: `browser_snapshot` should auto-truncate or use accessibility tree more aggressively. |
| **Trace file JSON parsing** | Reading trace files is a mechanical data operation. | **Tool**: `read_file` or new `trace_load` tool; or GBrain index should pre-parse. |
| **Embedding search relevance** | If GBrain retrieval returns irrelevant chunks, that's a memory/embedding model issue. | **Memory**: Re-index with better chunking or query expansion. |
| **E2E test scheduling** | Running `test:e2e:progressive` is CI orchestration, not agent reasoning. | **Harness/CI**: Keep in npm scripts and GitHub Actions. |
| **Model selection per task** | Auto-routing between Kimi K2.5 and other models based on task type is a routing layer decision. | **Harness**: Model router in executor, not agent skill. |

---

## Prioritized Summary

| Priority | Candidate | Confidence | Effort | Impact |
|----------|-----------|------------|--------|--------|
| **P1** | `hover-reveal-navigation` | High | Medium | Fixes known E2E failure mode |
| **P1** | `budget-aware-execution` | High | Low | Prevents max_turns waste across all E2E |
| **P2** | `trace-pathology-analysis` | Medium | Medium | Enables automated RCA, feeds P1/P2 skills |
| **P2** | `gbrain-grounded-research` | Medium | Low | Improves all research tasks with existing data |
| **P3** | `rfc-hypothesis-draft` | Medium | Low | Connects findings to experiment loop |
| **P3** | `parallel-subagent-delegation` | Medium | Medium | Efficiency gain for complex research |

---

**Conclusion:** The immediate skill candidates are **hover-reveal-navigation** and **budget-aware-execution**, directly tied to the turn_limit_reached failure in the latest traces. The lab's empirical methodology (trace hypothesize experiment record) suggests **trace-pathology-analysis** and **rfc-hypothesis-draft** as meta-skills that institutionalize the research loop itself.

---
Generated by `npm run lab:research` on 2026-04-12T16:59:19.806Z.
Query: Investigate the latest traces for possible new workflow skills to create and produce a prioritized list of candidates. Use the current repo context, the latest trace-analysis note, and existing workflow-skills direction. Focus on recurring workflow shapes, repeated pathologies, and where generic tools or generic prompting appear to be hitting their limit. For each candidate include: candidate name, trigger/workflow shape, why it should be a skill rather than a tool or harness fix, what traces or E2E classes it seems tied to, and overfitting risk. Also include a short section for issues that should NOT become skills and should instead become harness, verifier, memory, or tool changes.
