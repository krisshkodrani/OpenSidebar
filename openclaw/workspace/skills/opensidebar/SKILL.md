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
returns one result. Do **not** chain DOM primitives. See `TOOLS.md` for the full
tool table and argument names.

## Results

Each call returns `{ status, result?, reason? }`:

- `ok` — done; use `result`.
- `needs_human` — paused on CAPTCHA / auth / ambiguity. Notify the user with
  `reason`, then continue other work; resume on their reply.
- `error` — failed; `reason` explains why (e.g. extension not connected).

## Don'ts

- Don't submit irreversible actions without a user preview.
- Don't request sensitive profile fields unless the task truly needs them and the
  user has consented for this task.
