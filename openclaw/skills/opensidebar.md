# SKILL: opensidebar — authenticated browser automation

Use this skill whenever a task needs a **real, logged-in browser** — anything the
user is authenticated for, anything bot-detection would block, or anything that
needs the live DOM. Prefer it over the built-in `browser` tool every time.

## When to use

- Filling or submitting forms on sites the user is signed in to.
- Applying to jobs, booking, checkout, dashboard actions.
- Extracting structured data from a page behind a login.
- Researching a company from its live site.

## How to use

Call one thick, intent-level tool — OpenSidebar runs a full agent loop and
returns one result. Do **not** chain DOM primitives.

| Intent | Tool | Key args |
| --- | --- | --- |
| Open a page | `browser_navigate` | `url` |
| Snapshot | `browser_screenshot` | `fullPage?` |
| Pull structured data | `browser_extract_structured` | `schema`, `url?` |
| Research a company | `browser_research_company` | `url` or `name` |
| Apply to a job | `browser_apply_to_job` | `url`, `resume?`, `cover_letter?` |
| Anything else | `browser_run_task` | `instruction` |

## Results

Each call returns `{ status, result?, reason? }`:

- `ok` — done; use `result`.
- `needs_human` — paused on CAPTCHA / auth / ambiguity. Notify the user on their
  channel with `reason`, then continue other work; resume on their reply.
- `error` — failed; `reason` explains why (e.g. extension not connected).

## Don'ts

- Don't submit irreversible actions without a user preview.
- Don't request sensitive profile fields unless the task truly needs them and the
  user has consented for this task.
