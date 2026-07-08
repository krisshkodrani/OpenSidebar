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
2. **Build the collage** — the montage script locates each clip by label,
   re-times it to a uniform fast-motion length, adds the cards and overlays, and
   concatenates everything through black:
   ```
   node scripts/build-demo-montage.mjs --show servicenow --scene-sec 17
   node scripts/build-demo-montage.mjs --show fixtures   --scene-sec 17
   node scripts/build-demo-montage.mjs --show <name> --stills   # PNG mockups
   ```
   Output: `.artifacts/e2e/videos/<date>/opensidebar-<show>-demo-collage.mp4`.

The tooling is ffmpeg-only (no moviepy), reusing the harness's encoder settings
(`libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -movflags +faststart`).

**Three shows** are defined in the script and share the same style:
- **`servicenow`** — WorkArena/ServiceNow tasks (recorded via `workarena-handoff.ts`);
  the "extendable / deep integration" story.
- **`fixtures`** — general-web fixture tasks (recorded via `run-e2e-video-review.ts`);
  the "core, works on any website" story. Its clips are named by each test's
  `testLabel`, so `scenes[].task` is that label. Fixtures never touch the record
  controller, so they are all visually clean.
- **`traceviewer`** — a scripted tour of the built-in trace viewer (recorded via
  `scripts/record-trace-viewer-demo.mjs`, which needs `pnpm run logs` + a
  dev-surface build and captures one clip per scene: fleet, session, perception).
  Record it in **light mode** — dark mode still has badge-contrast gaps — and use
  the show's viewer-specific bottom bar instead of the model bar, since the
  subject is the tool, not the model seats.

To lock specific takes (e.g. after verifying which recordings passed), write
`.artifacts/demo-clips.json` — `{ "<label>": "<clip path>" }` — which the script
prefers over auto-picking the newest clip.

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
  cwd-relative, colon-free path — do the same for any added text. Also keep
  `expansion=none` on every `drawtext`: without it a literal `%` in a caption,
  e.g. "82% success", is parsed as an expansion token and truncates the line.)

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

## The promo cut (`scripts/build-promo-cut.mjs`)

The montage shows are presentation-style (card → scene → card). The **promo cut**
is the ~60s cinematic edit for hero slots (Chrome Web Store promo video, YouTube):

- **Cold open on product** — no leading logo card; the hook line rides a
  lower-third over the first scene. Branding moves to the CTA end card.
- **Lower thirds, not title cards** — a slim band with the beat's headline plus a
  small persistent brand/model chip bottom-right.
- **Speed ramping** — each beat is `[{from,to,speed}]` segments: fast traversal,
  then the payoff moment at ~1× (order confirmed, draft visible, suggestion pops,
  request submitted). Windows are calibrated to the pinned takes in
  `.artifacts/demo-clips.json` — re-probe if you re-pin. Trim segments at the
  INPUT (`-ss/-t` before `-i`) so `setpts` retimes exactly the window.
- **Animated cards** — the divider + CTA get a slow `zoompan` push-in and
  staggered per-line `drawtext` alpha fades.
- **Music** — `--music <file>` mixes a user-supplied bed with fade in/out; the cut
  must still read fully muted (sound-off autoplay is the default context).
- Keep the pitch/montages for long-form; the promo is the first-touch asset.

## Voiceover (`scripts/add-voiceover.mjs`)

Narration is mixed onto finished publish videos, never baked into the renders:
`node scripts/add-voiceover.mjs --video promo|pitch [--voice <id>] [--music <file>]`.
Lines are timed specs (`{at, maxSec, text}`) matching each cut's segment structure;
audio comes from ElevenLabs (key `ELEVENLABS_API_KEY`/`ELEVENLAB_API_KEY` in `.env`,
default voice "Rachel", cached by content hash in `.artifacts/vo/`). Lines that
overrun their window get squeezed up to 1.1× `atempo`, otherwise the script asks you
to shorten the copy. A `--music` bed is ducked under the voice via sidechain
compression. Video frames are stream-copied, so voiced variants are pixel-identical.
Keep narration factual — the same "never overstate" rule as captions.
