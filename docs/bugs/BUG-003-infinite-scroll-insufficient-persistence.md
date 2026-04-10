# BUG-003: Agent scrolls to 30 of 35 posts in infinite-scroll feed, then times out

**Severity**: Low
**Component**: Executor scroll persistence + retry_step budget
**Test**: `tests/e2e/infinite-scroll.test.ts`
**Prompt**: "Find Post #35 'The Secret Formula for Productivity' in the feed and tell me the secret code mentioned in it."
**Status**: Open

## Observed behavior

The agent scrolls through an infinite-scroll feed, loading batches of 10 posts. It reaches 30 posts (3 successful scroll-load cycles) but stops before reaching post #35. The test times out after ~620s.

Before the harness fixes, the agent only loaded 10 posts (1 cycle). The `retry_step` mechanism improved this 3× to 30 posts, but it's still 5 posts short.

## Evidence

Report `docs/e2e-reports/natural-v2/infinite-scroll.md`:
```json
{
  "postsLoaded": 30,
  "targetFound": false,
  "targetCode": "",
  "allLoaded": false
}
```

Fixture (`tests/e2e/fixtures/online-shop-pro/src/routes/infinite-scroll.tsx`):
- BATCH_SIZE = 10, MAX_POSTS = 50
- IntersectionObserver triggers at 10% visibility on sentinel div
- 500ms simulated load delay per batch
- Post #35 requires 4 scroll-load cycles minimum (posts 1-10, 11-20, 21-30, 31-40)

## Root cause

**Retry budget math**: The `retry_step` mechanism (Fix B) gives the step a default `maxRetries` of 5. Each retry scrolls once and checks. With 3 successful loads out of 5 retries (some retries may not trigger the IntersectionObserver if the scroll doesn't reach the sentinel), the agent gets to 30 posts but exhausts retries before reaching 35.

**Scroll-to-sentinel gap**: The agent scrolls by a fixed viewport amount, but the sentinel div may be below the scroll target. If the scroll doesn't bring the sentinel into view, the IntersectionObserver doesn't fire and no new posts load. The agent wastes a retry on a scroll that didn't trigger a load.

**No feedback on load progress**: The agent sees "Page is scrollable (X% scrolled)" from the find_element hint (Fix 5/8), but doesn't know how many posts are loaded or how many more scrolls it needs. It can't distinguish "I scrolled but nothing loaded" from "I scrolled and 10 more posts loaded."

## Possible fixes

1. **Increase default maxRetries**: Change from 5 to 8 in the planner's decomposition of scroll tasks. With 8 retries, even with 50% wasted scrolls, the agent would get 4+ successful loads (40 posts). This is the simplest fix.

2. **Scroll-to-bottom**: Instead of scrolling by viewport, scroll directly to `document.body.scrollHeight`. This guarantees the sentinel enters the viewport on every scroll, triggering the IntersectionObserver every time.

3. **Load detection in scroll_page tool**: After scrolling, wait briefly (500ms) and report whether new elements appeared. This gives the agent explicit feedback: "scrolled and 10 new items loaded" vs "scrolled but no new content."

4. **Planner maxRetries from query analysis**: When the planner sees "find Post #35" it could estimate the scroll budget needed: item #35 at 10/batch = 4+ batches = maxRetries: 8. This is query-specific intelligence.

5. **find_element with scroll search**: Enhance find_element to automatically scroll and search in a loop, rather than requiring the executor to manually orchestrate scroll-search cycles. This moves the persistence into the tool, not the executor.

## Reproduction

```bash
npm run test:e2e:progressive -- infinite-scroll
```

## Progress history

| Run | Posts Loaded | Mechanism |
|---|---|---|
| v1 baseline (no fixes) | 10 | Agent scrolled once, gave up |
| v2 round 1 (Fix 5 scroll hint) | 10 | Hint present but agent still gave up |
| v2 round 2 (Fix B retry_step) | 30 | 3× improvement, retry mechanism working |
| v2 round 3 (Codex RFC impl) | 30 | Same — retry budget exhausted at 30 |

## Related

- Report: `docs/e2e-reports/natural-v2/infinite-scroll.md`
- Fixture: `tests/e2e/fixtures/online-shop-pro/src/routes/infinite-scroll.tsx`
- retry_step (Fix B): `src/background/agent/loop.ts` ~line 5593
- Scroll hint (Fix 5/8): `src/content/actions/inspection.ts` ~line 181
- Planner patterns: `prompts/runtime/planner/decompose_system.md` (INTERACTION PATTERNS section)
