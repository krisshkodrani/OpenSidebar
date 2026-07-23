# JobAgent — reference workflow (not a product feature)

> **This is a reference implementation, not a supported end-user feature.**
> It exists to demonstrate the "extension = hands, external runtime = brain"
> architecture built on the optional agent-backend bridge (see the CHANGELOG
> entry for that bridge). It has no setup UI, ships default-off, and is not part
> of the published extension's supported surface. Treat it as example code.

JobAgent drives the existing browser tools through the optional loopback bridge
to run a **supervised, human-gated** job-application loop: discover postings,
draft a fill kit from a candidate profile, fill the form, and — only after a
human approves — submit.

## Safety model — read before running anything live

Unlike a toy example, this workflow can **fill and submit real job applications
in a logged-in browser session**. It is safe only because every consequential
step is human-gated:

- **Submit is never autonomous.** The consequential-action gate forwards the
  approval over the wire; a human must approve each submit
  (`filled-awaiting-submit → submitted-by-user`). There is no auto-submit.
- **Honesty is structural.** The fill mission is assembled only from a
  pre-approved manifest — the agent can type only what a human approved, never
  invent personal data. Drafted prose stays unsubmittable until marked
  `approved`.
- **No real PII in the repo.** Tests use a synthetic fixture. Real candidate data
  lives outside the tree at `~/.opensidebar/seed/` (`OPENSIDEBAR_SEED_DIR`).

The drafting rules have been observed to be *confidently wrong* on real forms
(the 2026-07-18 live smoke produced a kit whose four wrong answers all carried
confident provenance and an empty `unresolved` list) — which is exactly why the
human gate is mandatory. Do not remove it, and do not run this unattended.

## Autonomy is parked

Higher autonomy (scheduling, auto-approve, free-text drafting) was drafted as
RFCs LP-18 / LP-19 / LP-20 but is **parked** — JobAgent is a reference
implementation, not a product, so those RFCs are not scheduled for
implementation.

## Layout

- `scripts/jobagent/` — pure host-side logic (paths, package/lifecycle, manifest,
  brief assembly, discovery, drafting, answers, CV serve). No extension imports.
- `scripts/jobagent-console/` — a standalone **headless** loopback daemon
  (`pnpm run jobagent serve` → `http://127.0.0.1:7591`) plus the CLI verb
  surface that fronts it (`pnpm run jobagent help`): queue review, answer
  library, kit drafting, run orchestration, and the approval inbox. The daemon
  owns the WS bridge directly. There is no bundled web UI — it was removed in
  favour of the CLI so agent-platform skills and a human terminal share one
  tested surface.
- `.pi/extensions/jobagent.ts` — the pi-side reference driver over the bridge.

## Driving it

```
pnpm run jobagent serve                  # daemon (owns the WS bridge)
pnpm run jobagent status                 # daemon + bridge + active run
pnpm run jobagent queue                  # packages and their lifecycle status
pnpm run jobagent draft <name> q.json    # build a kit draft from the library
pnpm run jobagent approve-kit <name> --promote
pnpm run jobagent fill <name> --follow   # fills only; never submits
pnpm run jobagent submit <name> --follow # pauses at the approval gate
pnpm run jobagent decide <approvalId> approve
```

`--follow` streams a run's log and **returns control at the approval gate**
rather than waiting through it — the human decision is a separate, deliberate
`decide` call. Add `--json` to any verb for raw API output.

## Proven state

The full loop (discover → draft → fill → human-approve → submit) was proven live
end-to-end once, on a single candidate against a real form, on 2026-07-19 —
supervised and page-verified. It has **not** been proven at breadth across ATS
platforms, and nothing about it is autonomous.
