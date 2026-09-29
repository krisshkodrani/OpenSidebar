# Remote browser work (named-tester beta)

Remote work lets an authorized Codex integration supervise a read-only task in a
Chrome browser running OpenSidebar. The extension remains the browser executor
and enforces local site access and safety settings. OpenSidebar does not supply
model credits: connect and verify your own provider key in account settings.

## Set up

1. Install a current OpenSidebar extension build and sign in on the browser you
   want to use. Link it to the same account shown at `/app/settings`.
2. Add and verify a supported provider key. Keep the extension open long enough
   for its remote-work capability and online status to appear.
3. Enable **Remote browser work** in Settings. The switch is available only to
   named beta testers while server activation is staged.
4. Add `https://opensidebar.com/mcp` as an MCP server in Codex and complete its
   separate sign-in. Select the intended OpenSidebar browser before requesting
   a task.
5. Open `/app/missions` to check setup, recent status, and the bounded result
   summary. You can stop an active mission there or disable remote work for the
   whole account. The extension also shows the active remote task and local
   controls.

The first beta supports research and extraction only. Browser edits and
submissions are disabled. A stopped mission may already have performed reads;
the displayed result can be uncertain if the browser or network disconnects.
Do not treat an uncertain outcome as completed work.

## Data and control boundaries

The website's recent-mission list contains account-owned IDs, device IDs,
times, and lifecycle states. Instructions and bounded progress/results are
stored in encrypted envelopes and are fetched only for an authorized mission.
Raw page content, screenshots, tool output, and local traces are not returned
by the website mission list. Revoking the Codex connection or disabling remote
work stops new coordination; local site-access rules remain authoritative.

Account run analytics are a separate, off-by-default setting at
`/app/analytics`. When enabled, new runs can sync only an opaque run ID, device
ID, times, state, provider/model identifier when available, token counts, and
USD spend with its source. Active remote values are observed and provisional;
the terminal value reconciles them. Unknown spend is excluded from recorded
totals, and model spend is separate from cloud relay request quota. No task
instruction, URL, page content, screenshot, or trace is included. Data expires
after 90 days; turning the setting off deletes synced analytics. Existing local
run and trace retention is managed separately.

The public Playground is a separate practice environment. Its 12 curated
scenarios share the ModelBench engine, while the internal 100-case benchmark,
model telemetry, and scores are not exposed to public accounts.
