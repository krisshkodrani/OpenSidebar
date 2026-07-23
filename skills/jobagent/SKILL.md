# JobAgent — driving the job-application pipeline

**Single source of truth for all agent platforms** (Claude Code, pi, Codex).
Platform wrappers are adapters only: they choose a web-search primitive and a
way to ask a human. Nothing about the pipeline is restated in a wrapper — if
you find yourself explaining what `filled-awaiting-submit` means in a wrapper,
the spec has begun to fork.

## What this is

A supervised loop that finds job postings, drafts an application kit from a
hand-authored answer library, fills the form through the OpenSidebar browser
extension, and submits — with a human decision at two fixed points.

You are the driver. The `jobagent` CLI is the implementation. You never make a
gate decision yourself.

## Before you start

Everything runs through one command:

```
pnpm run jobagent <verb> [args] [--json]
```

Run `pnpm run jobagent status` first. If it exits **2**, the daemon is not
running — say so and stop; do not try to start it unless asked. Exit **1** is a
request or usage error and the message says what went wrong. Add `--json` when
you need to read a field rather than show a human the output.

## The loop

| Step | Verb | Yours or the human's |
| --- | --- | --- |
| 1. Find postings | *your platform's web search* | yours |
| 2. Filter cheaply | `assess <url>` | yours |
| 3. Create the package | `ingest <url> --source <where-you-found-it>` | yours |
| 4. Read the form | `questions <name>` | yours |
| 5. Draft the kit | `draft <name>` | yours |
| 6. Propose the rest | `set <name> "<label>" --file <f> --proposed --basis "<why>"` | yours |
| 7. Present the table; iterate | `set` / `accept` as the human directs | **the human's words, your typing** |
| 8. **Approve the kit** | `approve-kit <name> --promote` | **the human's** |
| 9. Fill the form | `fill <name> --follow` | yours |
| 10. **Approve the submit** | `decide <approvalId> approve` | **the human's** |
| 11. Submit | `submit <name> --follow` | yours |

### Searching (step 1)

Search for postings matching the roles in `jobagent criteria`. Prefer direct
posting pages over aggregators. Do not ingest every result — `assess` first.

### Assessing (step 2)

`assess` prints `MATCH` or `reject` with reasons, and writes nothing. It is
cheap relative to a package, but it does load the page — do not re-assess a URL
you have already assessed in this conversation.

Report rejections to the human with the reason. A rejection is information
about the criteria, not a failure.

### Ingesting (step 3)

`ingest` puts the posting through exactly the same rules as a board sweep. Three
outcomes, all normal:

- **created** — a package now exists in `reviewing`.
- **duplicate** — already tracked; say which package and move on.
- **rejected** — off criteria; do not try to work around it.

If the output warns that the company was inferred from the URL host, tell the
human — the page did not name a company and the value is a placeholder.

### Reading the form (step 4)

`questions` reads the form's fields into `questions.json`. If it fails with
**partial** / multi-page, **stop for this package**. A multi-page form is not
supported yet, and a kit drafted from page one would look complete while
missing whole pages. Report it and move to the next package.

### Drafting and proposing (steps 5–7)

`draft` maps the form's questions onto the answer library. What it cannot
resolve comes back `unresolved` — those need the candidate's judgment: salary
expectations, start dates, "why this company".

**You then propose an answer for each of them** — that is the tentative table
the human iterates on. Rules for proposing:

- Record every proposal with `set … --proposed --basis "<grounding>"`. The
  basis names what the answer stands on: the posting's own text, a fact from
  the CV, a library entry. If you cannot state a basis, do not propose —
  leave it and ask.
- **Never propose demographic or EEO answers** (age, gender, race/ethnicity,
  veteran or disability status, and the like). Drafting already sidelines
  these; leave them sidelined. If the human wants them answered they add
  explicit entries to their answer library, or fill them in the form
  themselves.
- Proposals are visibly provisional: the table marks them `PROPOSED ⚠` until
  the human acts. Present the whole table with that distinction intact —
  the human must always be able to tell your words from theirs.

Then iterate as directed: re-propose with `set --proposed` when they want
changes, record their own wording with plain `set` (their words, final), and
record adoption with `accept <name> "<label>"` — or `accept <name>
--all-proposed` when they say to take the rest as-is. Only the human's
say-so triggers an `accept`; approval stays blocked while anything is
unreviewed, and that blocking is the point.

### The two gates (steps 8 and 10)

These are the whole safety model. At each one:

1. Show the human exactly what will happen — for the kit, the resolved fields
   and their provenance; for the submit, the approval `context` verbatim.
2. Ask.
3. Do what they said.

Never call `approve-kit` or `decide` on your own reasoning, and never on
inferred consent. "They said to apply to jobs" is not approval of this submit.
If the human is unavailable, stop and say the run is waiting on them.

`fill --follow` returns control at the approval gate and prints the exact
`decide` command — that is your cue to ask, not to decide.

### After a fill

`fill` never submits. A filled package sits at `filled-awaiting-submit` until a
human runs the submit. If the human wants to check the form in the browser
before submitting, that is a reasonable thing to encourage.

## Rules

- **Propose, never pass off.** You may draft answers the library lacks, but
  only as marked proposals with a stated basis — never as settled fields. A
  proposal the human has not acted on cannot reach a form, and nothing you do
  should try to change that. Facts about the human (salary numbers, dates,
  their history) come from them or their library, not from your inference.
- **Never bypass a gate**, including by "helpfully" pre-approving a kit you are
  confident about. Confidence is exactly the failure mode here: a past live run
  produced four wrong answers that all carried confident provenance and an
  empty unresolved list.
- **Never restate lifecycle rules.** Statuses and their legal transitions are
  the daemon's; report what it says rather than reasoning about what it should
  say.
- **Report failures as failures.** A rejected posting, a partial form, or a
  daemon that is down are all normal outcomes to report plainly. Do not retry
  around them.

## Reference

Full verb list: `pnpm run jobagent help`. Design and rationale: RFC LP-22
(`docs/engineering/rfcs/lp-0022-jobagent-agent-platform-skills.md`). Safety
model: `scripts/jobagent/README.md`.
