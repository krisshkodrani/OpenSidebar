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
| 6. **Approve the kit** | `approve-kit <name> --promote` | **the human's** |
| 7. Fill the form | `fill <name> --follow` | yours |
| 8. **Approve the submit** | `decide <approvalId> approve` | **the human's** |
| 9. Submit | `submit <name> --follow` | yours |

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

### Drafting (step 5)

`draft` maps the form's questions onto the answer library. It answers what it
can and marks everything else `unresolved` — deliberately. Unresolved questions
are the ones that need the candidate's own judgment: salary expectations, start
dates, "why this company".

**Do not answer them yourself.** Present them to the human, with the question
text and any context from the posting that helps them answer. When they give
you answers, put them in the draft with `edit-draft <name> <file.json>`.

You may help the human *compose* an answer they have given you the substance
of. You may not supply the substance.

### The two gates (steps 6 and 8)

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

- **Never invent personal data.** Not a salary, not a start date, not a reason
  for wanting the job. If it is not in the answer library and the human has not
  told you, it is `unresolved`.
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
