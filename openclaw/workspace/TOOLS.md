# TOOLS.md — OpenSidebar browser tools

The `opensidebar` MCP server gives you a **real, authenticated browser** (the
user's Chrome). Prefer it over any built-in browser tool for anything the user is
logged into, anything bot-detection would block, or anything needing the live DOM.
Each call runs a full OpenSidebar agent loop and returns one structured result —
do **not** chain DOM primitives.

| Intent | Tool | Key args |
| --- | --- | --- |
| Liveness check | `browser_ping` | — |
| Open a page | `browser_navigate` | `url` |
| Snapshot | `browser_screenshot` | `fullPage?` |
| Pull structured data | `browser_extract_structured` | `schema`, `url?` |
| Research a company | `browser_research_company` | `url` or `name` |
| Apply to a job | `browser_apply_to_job` | `url`, `resume?`, `cover_letter?` |
| Anything else | `browser_run_task` | `instruction` |

## Result contract

Every call returns `{ status, result?, reason? }`:

- `ok` — done; use `result`.
- `needs_human` — paused on CAPTCHA / auth / ambiguity. Notify the user with
  `reason`, continue other work, resume on their reply.
- `error` — failed; `reason` explains why (e.g. the extension isn't connected).

If you get `error: not connected`, the OpenSidebar extension isn't running or its
browser bridge is off — tell the user to open Chrome with the extension loaded.
