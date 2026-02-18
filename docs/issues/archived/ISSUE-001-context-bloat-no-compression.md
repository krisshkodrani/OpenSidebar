# ISSUE-001: Context Bloat and Missing Compression in Long Runs

Severity: Critical
Status: Open
Date identified: 2026-02-17
Updated: 2026-02-17 (deep trace analysis)
Area: Orchestrator + Agent context management

## Summary

Long-running sessions accumulate excessive prompt/context volume and stay at compression level `none`, causing degraded decision quality, slower execution, and higher retry/loop behavior. Compression never activates despite sessions running 150-287 turns. The only context resets come from `distillForEscalation()` during model switches — the sliding-window compression system is effectively dead code during these runs.

## Evidence

### Session-level totals

| Session | Turns | LLM Calls | Total Tokens | Compression |
|---------|-------|-----------|-------------|-------------|
| `22c047ce` | 287 | 292 | 3,241,252 | `none` (all turns) |
| `37661697` | 189 | 197 | 2,216,569 | `none` (all turns) |
| `4b279dcc` | 153 | 161 | 1,383,653 | `none` (all turns) |
| `0b58a215` | 185 | — | — | `none` (all turns) |
| `4426e55d` | 85 | — | — | `none` (all turns) |

### Context growth trajectory (session `22c047ce`, 287 turns)

| Turn | messageCount | prompt_tokens |
|------|-------------|---------------|
| T1 | 5,005 | 8,109 |
| T50 | ~10,000 | ~12,500 |
| T121 | 6,073 | 8,874 |
| T161 | 11,517 | 13,580 |
| T229 | **16,560** | **18,068** |
| T241 | 7,947 | 10,471 |
| T281 | 9,097 | 11,265 |

Context oscillates between 5K-16.5K messages. The drops at T121, T241 correspond to `distillForEscalation()` during model switches. Between switches, context grows monotonically.

### Cognitive degradation symptom: code corruption

In session `22c047ce`, the fast model (`gpt-oss-120b`) began corrupting a previously-memorized code at T204 after 200+ turns of accumulated context:

| Turn | Model | Code typed | Matches displayed? |
|------|-------|-----------|----------|
| T9 | zai-glm-4.7 | `TA8UBD` | Yes |
| T129 | zai-glm-4.7 | `TA8UBD` | Yes |
| T204 | gpt-oss-120b | `TABUBD` | **No** (8→B) |
| T215 | gpt-oss-120b | `TABUBD` | **No** |
| T221 | gpt-oss-120b | `TABUBD` | **No** |
| T223 | gpt-oss-120b | `TABUBD` | **No** |
| T228 | gpt-oss-120b | `TABUBD` | **No** |
| T250 | zai-glm-4.7 | `TA8UBD` | Yes (after escalation) |

The fast model confused digit "8" with letter "B" for 5 consecutive cycles. After escalation back to the smart model, the displayed code was restored. This is evidence of cognitive quality degradation under context bloat — the model cannot reliably reproduce a 6-character string from earlier in the conversation.

**Important caveat:** Investigation revealed that Step 20 of the challenge is likely **unsolvable by design** — the displayed code "TA8UBD" does not actually work even when entered correctly (confirmed by manual testing). Neither code variant would have advanced the step. However, the code corruption still demonstrates that the fast model loses fidelity on previously-seen data after prolonged context accumulation.

### LLM timing is NOT the cause

Average LLM response time across sessions: ~997ms. No systematic slowdown over time (early ~1000ms, late ~890ms). The "sluggishness" is cognitive, not latency.

## User-visible impact

- Early turns behave sharper/faster; later turns become slower and less effective.
- The agent revisits prior work and needs more hints to recover.
- Resource cost increases without proportional progress.
- Fast model begins making errors on data it previously handled correctly.

## Root cause hypothesis

1. **Compression thresholds never reached.** The dynamic compression system (NONE→LIGHT→MEDIUM→HEAVY) is configured but never activates because the per-turn token count stays within budget. The problem is cumulative quality degradation from 200+ messages, not individual turn size.
2. **distillForEscalation() is the only working reset.** Model switches via escalation are the only mechanism that compresses history. Between switches, context grows unbounded.
3. **No turn-count-based compression.** The system only considers token budget, not how many turns of low-value history have accumulated. A session with 200 failed `find_element` calls has the same compression as a 5-turn session.

## Recommended fix direction

1. **Add turn-count trigger for compression.** Force LIGHT compression after 30 turns, MEDIUM after 60, HEAVY after 100 — regardless of token budget.
2. **Distill repetitive tool loops.** When 3+ consecutive turns use the same tool with similar args, collapse them into a single summary (e.g., "find_element × 5: 'Submit' → all not found").
3. **Aggressive pruning of failed turns.** Tool calls that returned errors or "not found" carry near-zero information. Prune these preferentially.
4. **Hard cap on retained history.** Keep the last N turns (e.g., 40) plus a distilled summary of everything before. This prevents the monotonic growth between escalation resets.
5. **Emit explicit logs when compression mode changes** for observability.

## Acceptance criteria

1. Any run beyond 60 turns must show compression transitions beyond `none`.
2. Token-per-turn growth curve should flatten after threshold, not continue rising.
3. Code corruption symptom (fast model garbling known data) should not occur.
4. In benchmark challenge runs, average turns to completion drops materially from current baseline.
