# Demo Video Style Guide

This is the house style for OpenSidebar demo collages: short, polished videos that
show the agent completing real tasks, each introduced by a title card and narrated
by an on-screen caption, with the model stack always credited. The style is encoded
in `scripts/build-demo-montage.mjs`; this document explains the design language and
copy conventions so future cuts stay consistent.

## The pipeline

1. **Record each run** through the E2E harness under the `video` profile, which
   auto-captures the visible Chrome window to an MP4 timelapse:
   ```
   E2E_PROFILE=video corepack pnpm tsx scripts/workarena-handoff.ts \
     --task workarena.servicenow.<task> --allow-servicenow-reset --seed <n>
   ```
   Runs are nondeterministic, so record until you get a clean `Validation: true`
   pass and keep that clip (`.artifacts/e2e/videos/<date>/…-view.mp4`).
2. **Build the collage** — the montage script locates each clip by task id,
   re-times it to a uniform fast-motion length, adds the cards and overlays, and
   concatenates everything through black:
   ```
   node scripts/build-demo-montage.mjs --scene-sec 17     # full video
   node scripts/build-demo-montage.mjs --stills           # PNG mockups for sign-off
   ```
   Output: `.artifacts/e2e/videos/<date>/opensidebar-servicenow-demo-collage.mp4`.

The tooling is ffmpeg-only (no moviepy), reusing the harness's encoder settings
(`libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -movflags +faststart`).

## Structure

```
Intro card → [ Title card → Captioned scene ] × N → Outro card
```
Every block fades in and out to black, so the concatenation reads as a clean
fade-through-black transition (no crossfade math). Target length is roughly
1.5–2 minutes: scenes re-timed to a uniform ~12–17s fast-motion, cards ~3s.

## Visual language

- **Canvas:** 1920×1080, 30 fps, H.264.
- **Card background:** deep navy `#0B1F33`.
- **Palette:** white headlines, accent blue `#4FC3F7` for taglines / benefit lines
  / the model bar, muted grey `#B8C4D0` for secondary credit lines.
- **Type:** Segoe UI Bold. (ffmpeg's filtergraph cannot take a Windows `C:/…` font
  path, so the script copies the font into a temp dir and references it by a
  cwd-relative, colon-free path — do the same for any added text.)

**Title card:** a centered headline (~68px, white) over a benefit line (~34px,
accent); the intro and outro also carry a small third line (~26px, grey) for model
credit.

**Scene overlay:** a semi-transparent bottom band (`black@0.55`, ~150px tall) that
carries two persistent lines — a **caption** (~40px, white) naming the exact task,
and beneath it the **model bar** (~26px, accent). The band guarantees contrast over
ServiceNow's light UI, and the model bar stays visible the entire time the agent
works.

## Copy conventions

- **Headlines** are benefit-oriented and lead with a verb: "Order from the service
  catalog", "Read a dashboard chart", "Sort a list the way you need it". They name
  the capability, not the internal task id.
- **Benefit lines** state the value in one plain sentence: "Browses the catalog,
  configures the item, and places the order."
- **Captions** name the concrete action with the real values from the run, so the
  viewer sees exactly what happened: `Ordering 8× "Developer Laptop (Mac)" with a
  custom software config`; `Filtering incidents: Caller = System Administrator OR
  Priority = 4 – Low`.
- **Taglines / positioning:** intro "An AI agent that operates ServiceNow — live,
  no integration"; outro "One agent. Every ServiceNow workflow."
- **Never overstate.** Frame each scene as what actually happened; if a task was a
  single sort, call it a sort, not a "multi-step workflow."

## Model attribution (keep accurate)

The bar and intro line credit the exact seats the runs use. Verify against the code
before changing (`config/model-config.ts`, `utils/executor-model-policy.ts`,
`background/llm/client.ts`) rather than trusting the handoff report, whose
`executorModel`/`plannerModel` fields are null unless `E2E_MODEL` is exported.

- **Executor: Kimi K2.7 Code** (`accounts/fireworks/models/kimi-k2p7-code`) —
  vision-capable; it receives the screenshot, so it genuinely "sees" the page.
- **Planner / Writer / Judge: GLM 5.2** (`accounts/fireworks/models/glm-5p2`).
- **Provider: Fireworks AI.**

On-screen form: `OpenSidebar · Executor: Kimi K2.7 Code (vision) · Planner: GLM 5.2
· Fireworks AI`.

## Choosing scenes (the cleanliness rule)

Only feature tasks that stay visually clean. Tasks that navigate, query, read, or
order (service catalog, dashboard charts, list filter/sort, knowledge search) show
no error UI. **Record-creation form tasks** (create incident / change / user /
hardware) route through the ServiceNow record controller, which optimistically
fills then submits and so flashes transient red "Invalid update" / "Match not
found" validation banners mid-run — these pass, but they read as errors, so avoid
them in a polished cut. Compositional "planning" tasks are impressive but currently
too flaky to record reliably; pick a clean single-capability fallback instead.

Sign-off flow: render the `--stills` mockups first and get approval on the look
before spending credits recording and encoding the full video.
