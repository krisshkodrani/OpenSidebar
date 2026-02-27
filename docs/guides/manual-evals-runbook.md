# Manual Evals Runbook

Collect traces from two runs — baseline (agent alone) and coached (you guide via hints) — then convert to eval cases for comparison.

## How Teaching Works

There is no "record my actions" button. The agent always executes; you **coach it with hints**.

During an active run, the input area switches to feedback mode:
- Placeholder changes to **"Send feedback..."**
- Send button turns **amber**
- Your message is injected into the agent's conversation as feedback

The agent reads your feedback on its next turn and adjusts. If teach mode is ON and the task succeeds, the orchestrator extracts the plan as a **learned skill** for future replay.

**Why hints over demonstrations:** The agent still plans, reasons, and verifies. Hints build transferable reasoning; recorded demos just replay brittle click sequences.

---

## Pre-Flight

```bash
# Terminal 1 — keep running the entire session
npm run logs

# Terminal 2 — build once
npm run build
```

Then load/reload the extension:
1. `chrome://extensions` → Developer mode ON
2. **Load unpacked** → select the `dist/` folder

### Verify recording works
1. Open side panel on any page
2. Send a trivial message ("read this page"), let agent run 1-2 turns, stop it
3. Check the log server terminal — you should see structured JSON entries flowing
4. Check that a new file appeared in `traces/` with today's date

If nothing appears, check the service worker console (DevTools → chrome-extension → service worker) for network errors to `127.0.0.1:7589`.

---

## Run A: Baseline (Agent Alone)

**Goal:** See how far the agent gets on its own. No hints, no teaching.

### Settings (side panel gear icon)
| Setting | Value | Why |
|---------|-------|-----|
| Teach Mode | **OFF** | Don't learn from a potentially failed run |
| Auto Skill Replay | **OFF** | No skills exist yet |
| Max Turns | **25** | Enough to observe behavior |

### Steps
1. Navigate to the challenge page
2. Open side panel, type the task, press Send
3. **Watch, don't intervene** — observe:
   - Does the planner decompose into multiple nodes?
   - Does pre-flight review fire? (only for plans with 3+ nodes)
   - Where does the agent get stuck?
   - Do retries/reroutes happen? Does the advocate fire?
   - Does escalation dialog appear?
4. Let it finish or time out
5. Note the outcome: completed / partial / failed

### Capture session ID
```bash
# Agent-level trace
tail -1 traces/index.jsonl

# Orchestrator-level trace (if orchestrator mode ran)
tail -1 traces/runs/index.jsonl
```

Write them down:
- **Baseline session ID:** _______________
- **Baseline run ID:** _______________

---

## Run B: Coached (You Guide via Hints)

**Goal:** Guide the agent to success using hints. The successful plan gets saved as a learned skill.

### Settings
| Setting | Value | Why |
|---------|-------|-----|
| Teach Mode | **ON** | Learn from successful completion |
| Auto Skill Replay | **OFF** | You're teaching fresh, not replaying |
| Max Turns | **40** | Extra room for feedback-guided retries |

### Steps
1. Navigate to the challenge page (same URL as baseline)
2. Open side panel, type the **same task query** as baseline, press Send
3. Watch the planner decompose the task
4. For each node the executor runs:
   - **If it's doing the right thing** → let it run
   - **If it's stuck or wrong** → type feedback in the amber input area
   - Keep feedback **short and actionable**:
     - Good: `"The login button is inside the nav bar at the top, try read_page first"`
     - Good: `"You need to scroll down to see the form"`
     - Bad: `"I think maybe you should try a different approach to this problem"`
5. Let the verifier do its job — retries generate valuable reflexion data
6. **Critical:** The task must complete with status **"completed"** for skill learning to fire

### Verify skill was learned
After successful completion, check:
- A step appears in the timeline: **"Teach mode: updated skill [name]"**
- Side panel → Settings → scroll to **Learned Skills** panel → new skill shows up
- Note the skill name and step count

### Capture session ID
```bash
tail -1 traces/index.jsonl
tail -1 traces/runs/index.jsonl
```

Write them down:
- **Teaching session ID:** _______________
- **Teaching run ID:** _______________

---

## Post-Run: Convert and Analyze

### Convert traces to eval cases

```bash
# Baseline
npx tsx evals/cli.ts convert <BASELINE_SESSION_ID> --strategy all
npx tsx evals/cli.ts convert-run <BASELINE_RUN_ID> --strategy all

# Teaching
npx tsx evals/cli.ts convert <TEACHING_SESSION_ID> --strategy all
npx tsx evals/cli.ts convert-run <TEACHING_RUN_ID> --strategy all

# Golden fixtures (reference expectations)
npx tsx evals/cli.ts convert-golden
```

### Run evals
```bash
npx tsx evals/cli.ts run --all
```

### Analyze
```bash
npx tsx evals/cli.ts stats
npx tsx evals/cli.ts analyze
npm run evals:critique
```

### Outputs
| Artifact | Location |
|----------|----------|
| App logs | `logs/opensidebar.jsonl` |
| Agent traces | `traces/<session-id>.jsonl` |
| Orchestrator traces | `traces/runs/<run-id>.jsonl` |
| Eval cases | `evals/cases/*.jsonl` |
| Eval results | `evals/results/*.jsonl` |
| Critique report | `evals/reports/critique-<timestamp>.json` and `.md` |

---

## What to Look For in Traces

New conversation collaboration patterns — verify these appear in orchestrator traces:

| Trace Event | When It Fires | Cost |
|-------------|--------------|------|
| `evidence_attached` | Every executor completion | Zero |
| `cross_role_reflexion` | Verifier retry or reroute | Zero |
| `plan_reviewed` | Plans with 3+ nodes | 1 LLM call |
| `planner_retrospective` | Task end with failures | 1 LLM call |
| `advocate_challenge` | Retry + low confidence + first attempt | 1 LLM call |
| `dialogue_completed` | Verifier-critic dialogue | Already existed |
| `skill_learned` | Successful task + teach mode ON | Zero |

Search logs for specific events:
```bash
npx tsx scripts/log-query.ts search "evidence_attached"
npx tsx scripts/log-query.ts search "advocate"
npx tsx scripts/log-query.ts search "retrospective"
npx tsx scripts/log-query.ts search "plan_reviewed"
npx tsx scripts/log-query.ts search "cross_role_reflexion"
```

---

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Forgot `npm run logs` | Traces won't record. Use Settings → Export Logs for buffered data, then re-run with the server |
| Teach mode OFF during coached run | Skill won't be learned. Re-run with it ON |
| Task failed during coached run | Skill learning only fires on success. Guide more aggressively with hints |
| Different query text between runs | Use the exact same task text for fair comparison |
| Build stale after code changes | `npm run build` and reload extension before capture |
| Multiple tasks in one session | Keep one task per session for clean eval conversion |

## Quality Gate

Before analyzing results, confirm:
1. `npm run lint` — 0 errors
2. `npm test` — all pass
3. At least one `traces/<session-id>.jsonl` exists per run
4. Coached run has a learned skill visible in the panel
