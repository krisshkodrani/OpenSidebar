# Web Agent Memory & Site-Specific Learning: State of the Art

**Date:** 2026-04-13  
**Purpose:** Research summary for OpenSidebar's site-specific learning feature

---

## Key Papers & Approaches

**AWM — Agent Workflow Memory** (Wang et al., ICML 2025) [paper](https://arxiv.org/abs/2409.07429) | [code](https://github.com/zorazrw/agent-workflow-memory)  
Extracts reusable multi-step *workflows* from successful trajectories. Works offline (from training data) and online (from live execution). On WebArena: +51.1% relative success rate, fewer steps. The gold standard for procedural memory in web agents.

**WebCoach — Cross-Session Memory Guidance** (Liu et al., 2025) [paper](https://arxiv.org/abs/2511.12997)  
Three components: WebCondenser (compresses raw navigation logs), External Memory Store (episodic trajectories), Coach (retrieves by similarity + recency, injects advice at runtime). A 38B model went from 47% to 61% success on WebVoyager. Model-agnostic, no retraining. Closest to what we want to build.

**HMT — Hierarchical Memory Tree** (2026) [paper](https://arxiv.org/html/2603.07024v1)  
Three-level hierarchy: Intent (normalized goals) → Stage (semantic subgoals with pre/post-conditions) → Action (semantic element descriptions, NOT raw selectors). Key insight: discards DOM IDs entirely, stores semantic descriptors. 72.7% context token reduction. Outperforms flat AWM on cross-domain transfer.

**Synapse — Trajectory-as-Exemplar Prompting** (Zheng et al., ICLR 2024) [paper](https://arxiv.org/abs/2306.07863) | [code](https://github.com/ltzheng/Synapse)  
State abstraction + full trajectory exemplars retrieved by embedding similarity. 99.2% on MiniWoB++, +56% over prior art on Mind2Web. Proves that retrieving *complete trajectories* as few-shot examples beats retrieving individual tips.

**AutoRefine** (2025) [paper](https://arxiv.org/html/2601.22758v1)  
Contrastive analysis of success vs. failure trajectories → extracts skill patterns (guidelines) and subagent patterns (specialized reasoning). Continuous maintenance: scoring, pruning, merging redundant patterns via clustering. Multi-query retrieval with MMR for diversity.

**TIMA — Trajectory-Informed Memory** (2026) [paper](https://arxiv.org/html/2603.10600)  
Three tip types: strategy (from successes), recovery (from failure handling), optimization (from inefficiencies). LLM-guided retrieval beats cosine similarity by +7.2pp on complex tasks. Subtask-level extraction > task-level for granular reuse.

---

## What Works

1. **Hierarchical memory structures outperform flat ones.** HMT's intent/stage/action hierarchy and AWM's workflow abstraction both beat storing raw trajectories. The hierarchy enables cross-domain transfer.

2. **Semantic element descriptions, not DOM selectors.** HMT's biggest win: storing "the search input field near the navigation bar" rather than `input#search-7`. This is critical for sites that change layouts or use dynamic IDs.

3. **LLM-based extraction beats rule-based.** Every top system uses LLM reflection to distill trajectories into reusable knowledge. Rule-based approaches miss the semantic generalization needed for cross-site transfer.

4. **Dual retrieval: embedding similarity + recency.** WebCoach's approach works well. Pure cosine similarity is cheaper but misses context; LLM-guided selection adds ~7% accuracy on complex tasks at higher cost.

5. **Contrastive learning from failures.** AutoRefine shows that comparing success/failure trajectories produces better patterns than learning from successes alone.

---

## What Doesn't Work

- **Storing raw trajectories verbatim** — context blowup, poor transfer across domains
- **Site-specific DOM selectors as memory keys** — brittle, break on layout changes
- **Pure embedding retrieval without recency** — stale memories dominate
- **Task-level-only extraction** — too coarse for reuse on subtasks (TIMA ablation)
- **Expecting small models to self-reflect** — extraction quality drops sharply below ~30B params; use your strongest model for reflection

---

## Open Source Landscape

| Project | Memory/Learning | Notes |
|---------|----------------|-------|
| **browser-use** | "Memory" mentioned in features | No cross-session persistence documented |
| **Stagehand** | None | Stateless SDK, three primitives (act/extract/observe) |
| **Skyvern** | None | Visual-first, no learning layer |
| **agentmemory** | Yes — PostToolUse hook, SHA-256 dedup, vector indexing | Generic agent memory, not web-specific |
| **meMCP** | Yes — MCP-based persistent memory | Session-level, not trajectory-aware |
| **AWM (GitHub)** | Yes — full implementation | Research code, not production-ready |

No major open-source browser agent has production-grade cross-session site-specific learning. This is a genuine differentiator.

---

## Recommendations for OpenSidebar

### Architecture: Three-Layer Hierarchical Memory

Adopt HMT's pattern, adapted for a Chrome extension:

1. **Domain Layer** — keyed by eTLD+1 (e.g., `amazon.com`). Stores domain-level patterns: cookie banner selectors, login wall behavior, dynamic loading quirks.
2. **Task Layer** — keyed by normalized intent + domain. Stores reusable stage sequences (e.g., "add to cart on Amazon" = search → select → add → confirm).
3. **Action Layer** — semantic element descriptors with pre/post-conditions. No raw selectors. Match by role + label + structural context.

### Storage: Local-First, No Cloud

- Use `chrome.storage.local` (10MB limit) or IndexedDB for the memory store
- JSON-serializable entries with embeddings stored as Float32Arrays
- LRU eviction per domain (cap at ~50 entries/domain, ~500 domains)
- No cloud dependency — all computation local or via existing LLM provider

### Extraction Strategy: LLM Reflection Post-Task

After each completed task (success or failure), run a single LLM call against the trajectory:
- Input: compressed trajectory (like WebCoach's WebCondenser output)
- Output: structured JSON with domain patterns, reusable stages, and semantic element descriptors
- Use the executor model (already available) — extraction doesn't need the planner
- Cost: ~1 additional LLM call per task completion, amortized over all future visits

### Retrieval Strategy: Domain + Embedding Hybrid

1. **First pass:** Filter by eTLD+1 domain (instant, zero cost)
2. **Second pass:** Cosine similarity between current task embedding and stored task-layer entries
3. **Inject as context:** Top-3 relevant memories prepended to agent system prompt, formatted as "Site Knowledge" section
4. Skip LLM-guided retrieval (TIMA's +7% isn't worth the latency/cost for a real-time extension)

### Techniques to Adopt

- **Contrastive extraction** (AutoRefine): Store what went wrong alongside what worked. Recovery tips from failures are the highest-value memories for cookie banners and login walls.
- **Semantic element descriptions** (HMT): Never store raw tag IDs. Store `{role: "button", label: "Accept cookies", context: "modal overlay bottom-right"}`.
- **Recency weighting** (WebCoach): Decay old memories. Sites change; a 6-month-old layout pattern may be harmful.
- **Incremental consolidation**: After N memories for the same domain, merge/deduplicate (AutoRefine's clustering approach).

### Techniques to Avoid

- **Full trajectory storage** — too expensive for local storage, poor retrieval quality
- **Embedding-only retrieval without domain filtering** — unnecessary compute, retrieves irrelevant cross-domain noise
- **Fine-tuning or weight updates** — incompatible with API-based LLMs in a Chrome extension
- **Complex vector databases** — overkill for local-first; a simple cosine similarity over a few hundred entries is fast enough in JS

---

## Sources

- [AWM: Agent Workflow Memory](https://arxiv.org/abs/2409.07429) — Wang et al., ICML 2025
- [WebCoach: Cross-Session Memory Guidance](https://arxiv.org/abs/2511.12997) — Liu et al., 2025
- [HMT: Hierarchical Memory Tree](https://arxiv.org/html/2603.07024v1) — 2026
- [Synapse: Trajectory-as-Exemplar Prompting](https://arxiv.org/abs/2306.07863) — Zheng et al., ICLR 2024
- [AutoRefine: Trajectories to Reusable Expertise](https://arxiv.org/html/2601.22758v1) — 2025
- [TIMA: Trajectory-Informed Memory Generation](https://arxiv.org/html/2603.10600) — 2026
- [MACLA: Hierarchical Procedural Memory](https://arxiv.org/html/2512.18950v1) — 2025
- [Episodic Memory Position Paper](https://arxiv.org/pdf/2502.06975) — 2025
- [Agent Memory Survey](https://github.com/Shichun-Liu/Agent-Memory-Paper-List) — comprehensive paper list
- [AgentTrek: Trajectory Synthesis](https://openreview.net/pdf/e95d923ccea15b1bab268aeeb8b3845547e3dafe.pdf) — ICLR 2025
