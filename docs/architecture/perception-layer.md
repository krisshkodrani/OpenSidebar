# Perception Layer Architecture

## Overview

The perception layer replaces raw DOM text injection with a vision-based page interpretation system. Instead of dumping up to 15K characters of unfiltered, unstructured page text directly into the agent's system prompt, a multimodal model (OpenRouter Gemini 2.5 Flash) interprets a screenshot + element metadata and produces a structured ~150-token summary.

**Before (raw DOM text):**
- ~3,750 tokens of unfiltered page content per turn
- Repetitive content not collapsed (100 identical sections = 100x waste)
- Modal/popup text ambiguous — no indication of which button dismisses what
- Agent calls `read_page` repeatedly because text representation is insufficient
- `take_screenshot` gated behind tier-1 escalation, not a core capability

**After (perception layer):**
- ~150 tokens of structured interpretation per turn (~25x reduction)
- Repetitive content collapsed ("Sections 1-100: identical filler text")
- Modals/overlays explicitly described with dismiss instructions
- Visual-only content (images, canvas, charts) now visible to the agent
- Automatic — runs after every DOM-modifying action, no tool call needed

---

## Architecture

```
                          Agent Loop (loop.ts)
                               │
                    ┌──────────┴──────────┐
                    │  refreshPerception() │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                 │
    computeFingerprint   captureVisibleTab   perceive()
    (stagnation.ts)      (chrome.tabs API)   (perception.ts)
              │                │                 │
              ▼                │      ┌──────────┴──────────┐
       Cache check             │      │    OpenRouter        │
       (FNV-1a hash)           │      │  (Gemini 2.5 Flash)  │
              │                │      │                      │
         hit? ──► skip         │      │                      │
         miss? ──────────────► │      │                      │
                               │      └──────────┬───────────┘
                               │                  │
                               ▼                  ▼
                          Screenshot +      Vision Model API
                          Element Summary   (multimodal request)
                               │                  │
                               │                  ▼
                               │          PerceptionResult
                               │          { interpretation,
                               │            usage, model,
                               │            providerId }
                               │                  │
                               ▼                  ▼
                    context.setPageInterpretation()
                               │
                               ▼
                    System Prompt: ## Page Interpretation
                    {{pageInterpretation}}
```

---

## Component Deep Dive

### Perception Module (`src/background/perception.ts`)

The core module. Exports a single function `perceive()` that takes a screenshot + element metadata and returns a structured page interpretation.

**Input:**
```typescript
interface PerceptionInput {
  screenshotDataUrl: string;    // JPEG base64 from captureVisibleTab
  elements: TaggedElement[];     // Tagged interactive elements
  url: string;
  title: string;
  scroll: { y: number; maxY: number };
}
```

**Output:**
```typescript
interface PerceptionResult {
  interpretation: string;   // Structured text injected into system prompt
  usage?: TokenUsage;       // Token counts and cost
  model: string;            // Which model produced this
  providerId?: string;      // "openrouter"
  durationMs: number;       // Wall-clock time
  cached: boolean;          // True if fingerprint cache hit
}
```

**Element summary builder:** Before sending the screenshot, `buildElementSummary()` creates a compact metadata string:
- Counts by category (inputs, buttons, links, other)
- Up to 10 key elements (inputs, submit buttons) with tag IDs

Example output:
```
42 total (5 inputs, 8 buttons, 22 links, 7 other)
Key: [3] input "Email", [7] input "Password", [12] button "Submit"
```

This gives the vision model structural context that complements what it sees in the screenshot.

### Fingerprint Caching (`src/background/agent/stagnation.ts`)

Perception is expensive (API call + screenshot capture). The fingerprint cache ensures we only re-interpret when the page has meaningfully changed.

**How it works:**

1. `computeElementSignatures(snapshot)` builds a set of element signatures:
   ```
   "button:Submit:"
   "input::disabled=true,value=hello"
   "a:Click here:"
   ```
   Each signature encodes: `tagName:text[:30]:stateAttrs`

2. `computeSnapshotFingerprint(snapshot)` hashes the sorted signature set via FNV-1a:
   ```
   "https://example.com|42|a1b2c3d4"
    ───────────────────  ──  ────────
    URL                  │   FNV-1a hash of sorted signatures
                         element count
   ```

3. In `refreshPerception()`, the fingerprint is compared to `lastPerceptionFingerprint`:
   - **Match (cache hit):** Skip screenshot capture and API call entirely
   - **Miss:** Capture screenshot, call `perceive()`, update cache

**What triggers a cache miss:**
- Any element added or removed
- Element text changes (first 30 chars)
- State attribute changes: `disabled`, `checked`, `aria-expanded`, `value`, `selected`, `aria-selected`
- URL change

**What does NOT trigger a miss:**
- Scroll position changes (same elements visible)
- CSS-only changes (animations, colors)
- Content outside interactive elements

### Context Integration (`src/background/agent/context.ts`)

The `ContextManager` stores the interpretation and injects it into the system prompt.

**Storage:**
```typescript
private pageInterpretation: string | null = null;

public setPageInterpretation(interpretation: string | null): void {
  this.pageInterpretation = interpretation;
}
```

**System prompt injection** in `constructSystemMessage()`:
```typescript
const interpretation = this.pageInterpretation
  || "No visual interpretation available. Use element list above.";
content = content.replace("{{pageInterpretation}}", interpretation);
```

**Token budget estimation** in `getCompressionLevel()`:
```typescript
const perceptionTokens = this.pageInterpretation ? 200 : 0;
// Added to: baseTokens + elemTokens + historyTokens
// Determines compression level: NONE | LIGHT | MEDIUM | HEAVY
```

The 200-token estimate is conservative (actual output averages ~150 tokens) to prevent under-compression.

### Agent Loop Integration (`src/background/agent/loop.ts`)

The `refreshPerception()` method is called at 6 points in the agent loop:

| # | Location | Trigger | Purpose |
|---|----------|---------|---------|
| 1 | Initial setup | Session start | First page interpretation before any action |
| 2 | Tool result processing | After DOM-modifying tools | Page changed, need fresh interpretation |
| 3 | De-escalation | Planner → executor tier switch | Fresh context after model change |
| 4 | Strategy pivot | History cleared for retry | Clean slate interpretation |
| 5 | Escalation | Executor → planner tier switch | Planner model gets visual context |
| 6 | Text-only nudge | Agent stuck emitting text | Refresh context to unstick |

**Fingerprint caching means most of these calls are free.** In a typical 10-turn session:
- Turn 1: cache miss (initial) → API call
- Turns 2-4: tool executes, DOM changes → cache miss → API call
- Turns 5-6: scroll or read-only tool → cache hit → free
- Turns 7-10: mix of hits and misses

**Estimated: ~5 API calls per 10-turn session** (vs 10 without caching).

### Prompt Template (`prompts/runtime/perception/interpret_page.md`)

The perception prompt produces a 6-section structured report:

```
1. LAYOUT: Page type and visible structure (1-2 sentences).
2. STATE: Active tab, open menus, focused inputs, loading indicators, toggle states.
3. CONTENT: Key text visible — headings, paragraphs, instructions, data.
4. VISUAL-ONLY: Text in images, canvas, charts, SVGs.
5. BLOCKERS: Overlays, modals, dialogs blocking interaction + dismiss instructions.
6. SPATIAL: Notable layout relationships (e.g. "submit button below form").
```

**Template variables:**
- `{{title}}` — Page title
- `{{url}}` — Current URL
- `{{scrollPosition}}` — e.g., `500/2000px (25%) — more content below`
- `{{elementSummary}}` — Output of `buildElementSummary()`

**Example output (~120 tokens):**
```
LAYOUT: E-commerce product page with header nav, product gallery, and purchase form.
STATE: "Add to Cart" button enabled. Quantity selector at 1. Color dropdown closed.
CONTENT: "Nike Air Max 90 — $129.99". Reviews: "4.5/5 (238 reviews)".
VISUAL-ONLY: Product image shows white sneaker with red accent. Size chart is an image.
BLOCKERS: Cookie consent banner at bottom. [47] button "Accept All" dismisses it.
SPATIAL: Price and "Add to Cart" grouped in right column. Reviews section below fold.
```

---

## Provider Architecture

### Single Provider

All perception requests route through OpenRouter using `google/gemini-2.5-flash`.

### Error Handling

| Error | Behavior |
|-------|----------|
| 429 (rate limit) | Retry with exponential backoff |
| 400, 401, 403 (client error) | Return error fallback |
| 500, 502, 503, 504 (server error) | Retry (up to 2 retries, exponential backoff) |
| Network error | Retry with backoff |
| Timeout (20s) | Return timeout fallback immediately |
| AbortSignal | Return timeout fallback immediately |

**Retry timing:** Base delay 800ms, exponential backoff with jitter (800ms, 1600ms+).

### API Request Format

Uses the OpenAI-compatible multimodal format via OpenRouter:

```json
{
  "model": "google/gemini-2.5-flash",
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "<perception prompt with element summary>" },
      { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,..." } }
    ]
  }],
  "max_tokens": 600,
  "temperature": 0.1
}
```

---

## Performance Analysis

### Token Savings

| Metric | Before (raw DOM) | After (perception) | Savings |
|--------|-------------------|---------------------|---------|
| System prompt page content | ~3,750 tokens | ~150 tokens | **96%** |
| Per-turn budget consumed | ~30% of context | ~1.2% of context | **28.8pp** |
| Repetitive content | Full duplication | Collapsed | **~100%** |
| 10-turn session total | ~37,500 tokens | ~1,500 tokens | **96%** |

### Latency Impact

| Scenario | OpenRouter |
|----------|------------|
| Vision API call | ~500-2,000ms |
| Screenshot capture | ~50-100ms |
| Fingerprint check | <1ms |
| **Total (cache miss)** | **~600-2,100ms** |
| **Total (cache hit)** | **<1ms** |

**Net effect on turn latency:** Perception adds ~600-2,100ms per cache-miss turn. With fingerprint caching (~50% hit rate), the average per-turn overhead is ~300-1,000ms. This is offset by reduced token processing time due to the 96% reduction in system prompt tokens.

### API Cost Estimates

**Per perception call (cache miss):**

| Provider | Input tokens | Output tokens | Cost |
|----------|-------------|---------------|------|
| OpenRouter (Gemini 2.5 Flash) | ~800 | ~150 | ~$0.000210 |

**Per 10-turn session (~5 cache misses):**

| Provider | Cost per session |
|----------|-----------------|
| OpenRouter | ~$0.0011 |

**Cost comparison:** The token savings on the main LLM (not sending ~3,750 tokens/turn) offset the perception cost. Perception adds ~$0.11 per 100 sessions while saving ~$0.15-0.30 per 100 sessions in main LLM input tokens.

### Cache Hit Rate Estimates

| Session Type | Est. Cache Hit Rate | Perception Calls / 10 turns |
|--------------|--------------------|-----------------------------|
| Navigation-heavy (multi-page) | ~20% | ~8 |
| Form filling (single page) | ~60% | ~4 |
| Read-only browsing | ~80% | ~2 |
| Mixed (typical) | ~50% | ~5 |

---

## Graceful Degradation

The system never fails hard. Every error path produces a usable agent context:

```
Level 0: Full perception
  ├─ Screenshot + element summary → vision model → structured interpretation
  └─ Agent sees: LAYOUT, STATE, CONTENT, VISUAL-ONLY, BLOCKERS, SPATIAL

Level 1: Provider error
  ├─ OpenRouter returns error after retries
  └─ Agent sees: "[Visual perception failed: provider error]"
  └─ Element list still available — agent can still operate

Level 2: No API key
  ├─ No openRouterApiKey configured
  └─ Agent sees: "[No API key — visual perception unavailable...]"
  └─ Element list still available

Level 3: Runtime exception
  ├─ Unexpected error in refreshPerception()
  └─ context.setPageInterpretation(null)
  └─ Agent sees: "No visual interpretation available. Use element list above."
```

The element list (`## Visible Elements` in the system prompt) is always populated independently of perception. The perception layer adds context but is never required.

---

## Suggested Improvements

### 1. Semantic Fingerprint Caching

**Problem:** Current fingerprint only considers element signatures. A page could have the same elements but very different visual content (e.g., a chart that updates, a video frame that changes).

**Solution:** Include a perceptual hash of the screenshot in the fingerprint. Libraries like `blockhash` produce 256-bit hashes that detect visual similarity. Compare hamming distance — if <15% different, consider it a cache hit.

**Impact:** Reduces false cache hits on visually dynamic pages while maintaining efficiency on static pages.

### 2. Adaptive Model Selection

**Problem:** Simple pages (login form, 3 elements) don't need a vision model. Complex pages (dashboard with charts, nested modals) benefit most from vision.

**Solution:** Score page complexity from element count + element diversity + scroll depth:
- **Low complexity** (<10 elements, single viewport): Skip perception entirely, use element list only
- **Medium complexity** (10-50 elements): Use Gemini 2.5 Flash (fast, cheap)
- **High complexity** (50+ elements, multiple overlays): Use a higher-quality vision model

**Impact:** Eliminates unnecessary vision calls on simple pages (~30% of turns), while ensuring complex pages get the best interpretation.

### 3. Streaming Perception

**Problem:** The current implementation waits for the full vision model response before the agent can act. On OpenRouter, this can be 1.5-3s.

**Solution:** Stream the perception response and inject it into the system prompt incrementally. The agent could start reasoning about LAYOUT and STATE sections while CONTENT and SPATIAL sections are still arriving.

**Impact:** Reduces perceived latency by 40-60% on cache-miss turns. Requires changes to the prompt injection path in `context.ts`.

### 4. Differential Perception

**Problem:** After a click that opens a dropdown, re-interpreting the entire page is wasteful. Only the dropdown region changed.

**Solution:** Track which screen region changed (compare screenshots via pixel diff), and ask the vision model to describe only the changed region. Use a tighter prompt: "A dropdown opened near [coordinates]. Describe the new options visible."

**Impact:** Reduces output tokens by ~60% on incremental changes. Reduces latency proportionally. Requires screenshot diff infrastructure.

### 5. Confidence Scoring

**Problem:** The agent has no signal for how reliable the perception output is. A blurry screenshot or a heavily dynamic page (animations mid-capture) produces lower-quality interpretations.

**Solution:** Ask the vision model to append a confidence score (1-5) to its output. The agent loop could use this to decide whether to trigger `read_page` for a fresh capture.

**Impact:** Enables the agent to self-correct when perception quality is low, reducing wasted turns acting on bad information.

### 6. Perception Result Caching Across Sessions

**Problem:** If the user navigates back to a previously visited page, the perception cache is empty (it's in-memory only, reset per session).

**Solution:** Persist recent perception results to `chrome.storage.session` keyed by URL + fingerprint. On page load, check if a recent (< 5 min) cached interpretation exists.

**Impact:** Eliminates cold-start perception calls on revisited pages. Useful for multi-tab workflows where users switch between known pages.
