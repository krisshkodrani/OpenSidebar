# JobAgent (Codex)

**Read `skills/jobagent/SKILL.md` first and follow it.** That is the shared spec
for every platform: the verb table, the judgment rules, and the gate protocol.
This file only covers what is specific to Codex.

Do not restate the pipeline's rules here or in your replies. Run the verb,
report what it says.

## Platform specifics

**Searching (step 1 of the shared spec).** Use Codex's web search. Prefer direct
posting pages over aggregators, and filter candidates by hand before spending an
`assess` on each — assess loads the page.

**The two gates.** Codex has no structured prompt primitive, so ask in plain
text and then **stop your turn**. Do not continue past a gate in the same reply,
and do not offer to proceed "if that's fine" — that phrasing invites silence to
read as consent, and silence is not a decision.

- *Kit gate* — list the resolved fields with provenance, then the unresolved
  ones as direct questions, and stop.
- *Submit gate* — `fill --follow` returns at the gate with the approval's
  `context` and id. Quote the context verbatim, ask, and stop. Resolve with
  `decide` only after an explicit answer.

**Shell access.** Codex runs the verbs directly. Every consequential step is
already gated by the daemon, so there is no need to add confirmation prompts
around read verbs (`status`, `queue`, `show`, `assess`, `runs`, `approvals`) —
they write nothing.

**Reporting.** Quote daemon error text verbatim; paraphrasing loses the part
that says what to do about it.

**When the daemon is down** (exit code 2), say so and stop.

## Worked shape

```
pnpm run jobagent status
<web search>
pnpm run jobagent assess <url>
pnpm run jobagent ingest <url> --source websearch
pnpm run jobagent questions <name>
pnpm run jobagent draft <name>
   → ask the unresolved questions, STOP
pnpm run jobagent edit-draft <name> <file>
   → ask whether to approve the kit, STOP
pnpm run jobagent approve-kit <name> --promote
pnpm run jobagent fill <name> --follow
   → quote the approval context, ask, STOP
pnpm run jobagent decide <approvalId> approve
pnpm run jobagent submit <name> --follow
```

Add `--json` to any verb when you need to read a field rather than show a human.
