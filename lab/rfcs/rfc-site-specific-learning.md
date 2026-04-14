# RFC: Site-Specific Learning

## Status

Implemented (2026-04-14)

## Problem

The agent is amnesiac about site-specific patterns. Every visit to the same website starts from scratch — the agent rediscovers cookie banners, login walls, dynamic loading, layout quirks, and navigation patterns every time. This wastes turns, increases failure rate, and prevents the compounding improvement that users expect from repeated use.

Current state:
- Generic `execution-result` memories are written on task completion (since 2026-04-14)
- Memories are searched by semantic similarity to the user's query
- No domain-scoped retrieval — memories for amazon.com mix with unrelated sites
- No structured extraction — memories are raw summaries, not actionable tips
- Executor receives no memory context at all (only planner does)

## Research Basis

See: [lab/research/web-agent-memory-sota-2026-04-13.md](../research/web-agent-memory-sota-2026-04-13.md)

Key findings from SOTA (AWM, WebCoach, HMT, TIMA, AutoRefine):

| Finding | Source | Impact |
|---------|--------|--------|
| LLM-based extraction >> rule-based | All top systems | Higher quality lessons, semantic generalization |
| Semantic descriptors >> DOM selectors | HMT | Robust to layout changes, cross-session transfer |
| Per-subtask extraction >> per-task | TIMA | More granular, reusable tips |
| Three tip types: strategy/recovery/optimization | TIMA | Better prompt structuring |
| Contrastive learning (failures + successes) | AutoRefine | Recovery tips are highest-value |
| Domain filtering + embedding retrieval | WebCoach | Fast, relevant, no noise |
| Hierarchical memory (domain/task/action) | HMT | 72.7% token reduction, cross-domain transfer |

## Solution

### Overview

Three new capabilities wired into existing code paths:

1. **Extract** — After task completion, one LLM call distills site-specific tips from the execution trajectory
2. **Store** — Tips saved as `site-knowledge` memories in GBrain, tagged by domain
3. **Retrieve + Inject** — Before planning, query by current domain and inject tips into both planner AND executor prompts

### Extraction (post-completion)

**Primary path: LLM-based** — One call to the executor model (~$0.001) with a structured extraction prompt. Input: compressed execution summary per node (description, status, retries, verifier reasons, outcomes). Output: JSON array of `{ domain, tip, tipType, confidence }`.

Three tip types (from TIMA):
- `strategy` — what approach works ("scroll to load dynamic content before reading")
- `recovery` — what to do when something fails ("if element blocked, use dismiss_overlays first")
- `optimization` — shortcuts ("search form is in the hamburger menu, not the header")

Rules enforced in the extraction prompt:
- Semantic descriptions only, never DOM IDs or tag numbers
- Site-specific tips only, not generic web browsing advice
- Max 4 tips per extraction
- 10-25 words each, actionable, imperative voice
- Return `[]` if execution was straightforward

**Fallback path: rule-based** — If LLM call fails, scan reflexion logs for common patterns via regex (cookie/overlay/captcha/login/paywall, rate limiting, bot detection, dynamic loading). Produces lower-quality but still useful tips.

### Storage

Each tip stored as a GBrain page:
- Category: `site-knowledge`
- Tags: `["agent-memory", "site-knowledge", "domain-{hostname}"]`
- Title: `"{domain}: {tip preview}"`
- Content: the tip text
- Metadata: `{ domain, tipType, confidence, taskId }`

The domain tag enables fast lookup without semantic search.

### Retrieval

New backend endpoint: `GET /memory/domain?d={hostname}` — uses GBrain's tag-based `list_pages` to find all `domain-{hostname}` entries.

At task start:
1. Extract domain from current tab URL
2. Query backend for domain-tagged memories
3. Deduplicate by normalized content
4. Format top 4 by confidence into a brief (~200 tokens)
5. Inject into both planner (user message) and executor (instruction section)

Format:
```
SITE KNOWLEDGE (learned from prior visits to this domain):
- [strategy] Dismiss cookie/consent banner before interacting with page elements
- [recovery] If search form not visible, check the hamburger menu
- [optimization] Checkout button is below the fold — scroll down first
```

## Implementation

### New files

| File | Purpose |
|------|---------|
| `src/background/orchestrator/site-knowledge.ts` | Domain util, extraction context builder, LLM extraction prompt, rule-based fallback, formatting, dedup |
| `tests/background/site-knowledge.test.ts` | Extraction logic unit tests |

### Modified files

| File | Change |
|------|--------|
| `src/background/orchestrator/index.ts` | Wire extraction at completion, retrieval at start |
| `src/background/orchestrator/handoff.ts` | Add `siteKnowledgeBrief` param to `buildExecutorInstruction()` |
| `src/background/orchestrator/types.ts` | Add `siteKnowledgeBrief` to `OrchestratorTask` |
| `src/background/infrastructure/backend-client.ts` | Add `searchMemoryByDomain()` |
| `backend/gbrain-client.ts` | Add domain tag to `buildPageContent()` |
| `backend/services/memory-service.ts` | Add `queryMemoriesByDomain()` |
| `backend/routes/memory.ts` | Add `GET /memory/domain` endpoint |
| `tests/backend/server.test.ts` | Test domain endpoint |

### Data flow

```
                                    WRITE PATH
                                    ─────────
Task completes
  → buildExtractionContext(task, payload, finalUrl)     ~1500 tokens
  → LLM call (executor model)                          ~$0.001
  → SiteKnowledgeEntry[]                               0-4 entries
  → postMemory() for each                              fire-and-forget
  → GBrain page tagged "domain-{hostname}"

                                    READ PATH
                                    ─────────
Task starts
  → extractDomain(tab.url)                             pure function
  → GET /memory/domain?d={domain}                      tag-based lookup
  → deduplicateSiteKnowledge()                         normalize + dedup
  → formatSiteKnowledgeForPrompt()                     top 4, ~200 tokens
  → inject into planner (user message)
  → inject into executor (instruction after "Execution policy")
```

## Testing

1. **Unit tests**: Mock task data with reflexion logs → verify extraction produces correct tips
2. **Backend endpoint**: POST memory with domain metadata → GET /memory/domain returns it
3. **LLM extraction**: Complete a task on a site with cookie banner → verify site-knowledge memory created with meaningful tip
4. **End-to-end**: Run same site twice → verify second run's prompts contain tips from first run
5. **Fallback**: Simulate LLM failure → verify rule-based fallback still produces tips
6. **Degradation**: Kill backend → verify agent works normally with no site knowledge

## Impact

**Users**: Success rate improves across sessions for frequently visited sites. Agent gets smarter with use.

**Performance**: One extra LLM call per task completion (~$0.001, ~1-2s). Domain lookup adds ~50ms to task start. Net effect is positive — fewer retries on known sites.

**Competitive**: No open-source browser agent has production-grade site-specific learning. This is a genuine differentiator.

## Future work (not in this RFC)

- **Hierarchical memory** (HMT-style): domain → task → action layers for richer reuse
- **Recency decay**: downweight tips older than N days (sites change)
- **Consolidation**: after N memories per domain, merge/cluster via LLM
- **Cross-domain transfer**: generalize patterns (e.g., "e-commerce checkout" pattern) across similar sites
- **User feedback**: let users upvote/downvote tips in the trace viewer
- **LLM-guided retrieval**: use LLM to select most relevant tips (TIMA's +7% approach) for complex tasks
