# RFC LP-24 — The Presence Layer: a visible, natural agent cursor

Lifecycle status: **Decision stamped**
Date: 2026-07-24
Decision date: 2026-07-24 (owner resolved all three §10 questions in session:
**default mode = `subtle`** for regular users; **no action captions** in any
mode — the floating HUD remains the single text source; **error shake ships
in all modes** — blocked/failed actions are made visible as honest UX.)
Scope: a new `content/presence/` module rendering a synthetic cursor and
action choreography (glide, press, focus halos, per-control-type feedback)
inside the page while the agent acts; hooks in `content/actions/interaction.ts`;
a `presenceMode` setting; a perception-safety suspend hook in the screenshot
path. **Zero changes to real event dispatch semantics.**
Related: LP-17 (efficiency — presence must not tax turn latency in default
mode); LP-12 Phase B (cross-origin iframes — shared constraint, §7);
demo-video pipeline (`demo_video_pipeline`) — the primary cinematic consumer.

## 1. Problem

When the agent acts, pages change with no visible cause. Users watching a
live run (and viewers of demo videos) see forms filling themselves and views
jumping — there is no spatial narrative connecting intent to effect. The
existing in-page UI (agent border, floating HUD) says *that* the agent is
working, but never *where* or *what*. Claude-for-Chrome-style synthetic
cursors prove the UX value; a naive version (a div that teleports and
pulses) reads as cheap and, worse, can mislead — a cursor that jumps
instantly or clicks with no press feedback breaks the mental model instead
of building it.

The bar for this feature is explicitly high: it must look **stunning**, and
the movement must be **natural per control type** — a radio click, a field
receiving focus, a dropdown selection, and a drag each have distinct physical
grammar. Half-real is worse than absent.

## 2. Non-negotiable principles

1. **Presentation-only.** The presence layer never alters what events are
   dispatched, their order, their coordinates, or their timing semantics
   beyond a bounded pre-action delay. `type_text` stays single-shot value
   setting (per-character "cinematic typing" is rejected: it changes
   `onChange` granularity and would alter page behavior — see LP-17
   autocomplete guards). If presence code throws, is slow, or the tab is
   backgrounded, the action dispatches anyway (fail-open, hard timeout).
2. **Perception-clean.** The executor's own VL screenshots must never
   contain the fake cursor (the model would reason about a pointer that
   isn't part of the page). Every capture path suspends presence first (§6).
3. **Deterministic.** No `Math.random()` in motion. Paths and durations are
   pure functions of (from, to, control type, mode) — same action, same
   pixels. Replay and A/B video comparisons stay stable.
4. **Bounded cost.** Default mode adds ≤ 250 ms per action and idles at
   zero CPU (no rAF loop when still). Cinematic mode is opt-in.
5. **Contained.** One host element, namespaced, `pointer-events: none`,
   aria-hidden, no page-world injection, no external assets. The page can
   never receive an event from us, and our visuals can never eat a click.

## 3. Architecture

New module `apps/extension/src/content/presence/` (each file well under the
1,500-line cap):

```
presence/
  index.ts          — public API: init/attach/suspend/resume/perform
  coordinator.ts    — action queue, choreography state machine, fail-open timer
  motion.ts         — pure path/duration math (Bézier, Fitts-scaled timing)
  cursor.ts         — host element, glyph states, idle fade, DOM resilience
  effects.ts        — ripples, press scale, error pulse, selection chip
  focus-halo.ts     — field focus outline lifecycle
  choreography.ts   — per-control-type scripts (the grammar table, §5)
  presence-styles.ts— injected <style> (namespaced keyframes/vars)
```

**Host.** A single `<opensidebar-presence>` element appended to
`document.documentElement` with an **open shadow root** (open, so tests can
assert into it) containing the cursor glyph, effect layer, and halo layer.
`position: fixed; inset: 0; pointer-events: none; z-index: 2147483647`
(one above the agent border's 2147483646). A `MutationObserver` re-appends
the host if the page removes it; a `fullscreenchange` listener reparents it
into `document.fullscreenElement` and back. All visuals are inline SVG +
CSS transforms (compositor-only: `translate3d`/`scale`/`opacity`,
`will-change: transform`).

**Hook point.** `content/actions/interaction.ts` already computes the exact
physical truth we need: `centerMouseOptions(target)` produces the click
coordinates, and the pointer sequence (`pointerover → mouseover → mousemove
→ pointerdown/mousedown → pointerup/mouseup → click`) is dispatched from
known code paths. The integration is one call at the top of each dispatching
helper:

```ts
await presence.perform({ kind: "click", target, point });  // resolves at "press" moment
performElementClick(target, opts);                          // unchanged
presence.settle();                                          // post-action ripple/settle
```

`presence.perform` resolves when the choreography reaches its dispatch
point, or immediately when mode is `off`, `prefers-reduced-motion` is set,
the document is hidden, or the internal watchdog (600 ms subtle / 1,600 ms
cinematic) fires. The dispatchers never await anything else and never
propagate presence errors. Actions covered: click, type/focus, select,
checkbox/radio, hover, drag-and-drop, scroll, press-key (Enter/Escape get a
key chip, §5), upload.

**No background round-trips.** The whole layer lives in the content script's
isolated world; the only cross-context traffic is the settings value, the
suspend/resume message for captures, and an optional per-action overhead
sample for traces.

## 4. Motion system — why it will look natural

Movement is where fake cursors die. The spec:

- **Path:** quadratic Bézier from current position to target. The control
  point sits perpendicular to the chord at `min(0.18 × distance, 60 px)`,
  side chosen deterministically (hash of from+to), giving every glide a
  slight human arc instead of a laser line.
- **Duration:** Fitts-inspired — `duration = clamp(90, 60 + 70 ×
  log2(distance / targetWidth + 1), 420)` ms in subtle mode (×1.8 in
  cinematic). Short hops are quick flicks; cross-screen travel visibly
  *travels* but never dawdles.
- **Easing:** ease-in-out with a 2–3 px overshoot-and-settle on glides
  longer than 300 px (cinematic only). The settle is what reads as "a hand
  stopped here" rather than "an element animated".
- **Micro-pause:** 60–90 ms dwell after arrival before the press begins —
  the gap a person needs to confirm the target. This dwell is also when the
  target's own `:hover` state (already dispatched by the real
  `pointerover`) becomes visible, so the page participates in the
  choreography for free.
- **Press physics:** cursor scales to 0.92 on press, back on release, with
  a 250 ms expanding ripple ring at the click point (accent color, fades).
  Double-click = two ripples; right-click = square-ish pulse.
- **Idle behavior:** after 1.5 s of no actions the cursor fades to 40 %;
  after 4 s it hides entirely (also keeps stray perception captures clean).
  Next action fades it in *at its last position* and glides from there —
  continuity, never teleporting. Position survives same-tab navigations via
  `sessionStorage`, so a link click flows into the next page's first action.

## 5. Choreography grammar — per control type

The user-visible soul of the feature. `choreography.ts` maps action × control
type to a script; the coordinator executes it. Control type comes from the
target element itself (tag/type/role), which `interaction.ts` already has.

| Control | Script |
| --- | --- |
| **Button / link** | glide → dwell (native hover shows) → press scale → ripple → dispatch. Links add a brief "navigating" glyph state if a navigation follows within 400 ms. |
| **Radio / checkbox** | glide → dwell → press → **small ripple centered on the control, not the label** (clicks on `<label>` retarget the visual to the input's rect) → the control's own checked animation carries the payoff. |
| **Text field focus + type** | glide → cursor morphs to I-beam over the field → click → **focus halo**: a rounded-rect outline drawn around the field border (180 ms fade-in, subtle breathing at 4 s period) that persists while the field stays the action target and fades on blur/next target. The page's real caret (from the real focus) does the rest. No fake keystrokes. |
| **Native `<select>`** | glide → click → since the OS picker never renders in-page and the value is set directly, honesty beats mime: focus halo + a **selection chip** — a small floating label near the control ("Business ✓") that fades after ~1.2 s. Never pretend a menu opened. |
| **Custom (DOM) dropdowns** | plain click choreography on the option element — the page's own menu is real, so no special casing. |
| **Drag & drop** | press at source → weighted glide (slower curve, ×1.4 duration) with a low-opacity ghost outline of the dragged element following the cursor → release ripple at target. |
| **Scroll** | cursor holds position; a two-chevron glyph pulses beside it in the scroll direction. The real scroll stays instant — we do not switch to smooth scrolling (it changes timing and triggers scroll-linked page behavior differently). |
| **Key press (Enter/Escape/Tab)** | a small key-cap chip (`⏎`, `esc`) appears beside the cursor for 500 ms. Communicates non-pointer actions without inventing pointer motion. |
| **Blocked / failed action** | 2-cycle 3 px horizontal shake + brief red pulse ring. Users watching a run instantly see "it tried, the page refused" — currently invisible. |
| **Upload** | click choreography on the trigger + chip ("file attached"). |

Everything above is driven by design tokens in `presence-styles.ts`
(durations, radii, the accent color — reuse the agent-border blue so the
presence layer and existing HUD read as one system).

## 6. Perception & capture safety

The screenshot path (background `captureVisibleTab` for VL turns and e2e
evidence) gains a bracketing hook: background sends
`presence.suspend` (content hides the host synchronously — `display: none`,
same frame), captures, then `presence.resume`. Suspend must be awaited by
the capture path with a 50 ms cap so a dead content script can't stall
perception. Additions:

- New `ContentProtocolMessage` variants `presence_suspend` / `presence_resume`
  in `packages/shared-types/src/messages/content-protocol.ts` (domain module,
  not the barrel, per convention).
- The idle auto-hide (§4) already covers the common case — captures happen
  after action settle — the hook makes it a guarantee, not a coincidence.
- E2E **video** lane runs cinematic; normal e2e suites run `off` so timing
  assertions and LP-17 latency numbers stay untouched. Trajectory entries
  remain environment-agnostic — presence never writes into them; the only
  telemetry is an optional `presence_overhead_ms` field on existing
  tool-execution trace events.

## 7. Cross-cutting constraints

- **Modes & settings:** `presenceMode: "off" | "subtle" | "cinematic"` in
  `packages/shared-types/src/settings.ts` + `utils/settings-storage.ts`,
  sidepanel toggle next to the existing agent-visibility controls. Proposed
  default: **subtle** (the UX argument for the feature is watching live
  runs, not only demos) — owner call, see §10.
- **`prefers-reduced-motion`:** glides become instant repositions + a fade;
  ripples become a single opacity pulse; halos stay (static). Non-negotiable
  accessibility floor.
- **Iframes:** same-origin frames — the acting frame's content script
  reports the target rect; the top-frame presence host positions using
  accumulated frame offsets. Cross-origin — the top frame knows only the
  `<iframe>` rect (LP-12 Phase B constraint): glide to the iframe, show a
  perimeter halo on the frame instead of faking interior coordinates.
  Honest degradation over wrong pixels.
- **Performance budget:** ≤ 10 KB gzipped for the whole module; zero
  timers/rAF while idle; effects capped at 3 concurrent; no layout reads in
  the animation loop (rects are read once per action, before the glide).
- **CSP / cleanliness:** no external fonts/images, inline SVG only, style
  element inside the shadow root, no `page-world` bridge involvement.
- **Coexistence:** z-index above agent border, below nothing of ours;
  presence hides while the skill-recording HUD is capturing user
  demonstrations (recording a human should not draw a robot cursor).

## 8. Testing

- **Unit (vitest/happy-dom):** motion math is pure — snapshot path points
  and durations for fixed inputs; determinism (same input → same output);
  choreography table dispatch-point ordering; coordinator fail-open (throwing
  effect still resolves `perform` within watchdog); suspend hides host same
  frame; reduced-motion branch; label→input visual retarget for radios.
- **Integration:** interaction.ts dispatch still fires identical event
  sequences with presence on (assert event log equality on a fixture DOM,
  presence on vs off) — this is the guard for principle 1.
- **E2E:** one medium fixture run with `subtle` asserting task outcome and
  turn count parity vs `off` (presence must not change agent behavior);
  video-review lane flips to `cinematic` for visual QA.
- **Visual QA matrix (manual, pre-ship):** dark pages, dense forms
  (vendor-onboarding fixture), modal overlays fixture, iframe fixture,
  fullscreen, the three demo-video sites.

## 9. Phases

| Phase | Content | Exit criterion |
| --- | --- | --- |
| 0 | Settings plumbing + messages + empty host behind `off` default | verify green; no visual change |
| 1 | Core engine: host/shadow, cursor glyph, motion, click choreography, capture suspend, reduced-motion | subtle mode demo on shop fixture; event-sequence parity test green |
| 2 | Grammar table complete: focus halo, I-beam morph, radio/checkbox retarget, select chip, key chips, scroll glyph, error shake | all §5 rows demonstrable on fixtures |
| 3 | Cinematic mode (pacing ×1.8, overshoot, drag ghost), navigation continuity, sidepanel toggle UI | video-lane recording reviewed by owner |
| 4 | Perf audit (budget §7), QA matrix, default-mode decision, docs | stamp follow-up: flip default per §10 decision |

Phases 1–2 are the substance; 0 is an afternoon; 3–4 are polish and
decision-making. Each phase lands independently behind the setting.

## 10. Open questions — RESOLVED (Decision Stamp, 2026-07-24)

1. **Default mode: `subtle`.** The live-watching UX is the feature's main
   value; reduced-motion support and the settings toggle cover objections.
   Phase 0 still lands behind `off` — the flip to `subtle` happens at the
   Phase 4 exit per §9, once the parity tests and QA matrix are green.
2. **Action captions: none, in any mode.** The floating HUD stays the
   single text source; the choreography itself communicates the action.
3. **Error shake: ships in all modes.** Blocked/failed actions become
   visible — honest UX over a purely positive picture.

Implementation-review amendments (owner, 2026-07-24, after the first filmed
run): (a) the glyph must NOT resemble the OS cursor — larger (32px) with
brand-blue fill, white outline, soft blue glow; (b) **no glyph morphing** —
the §5 I-beam morph is dropped, the cursor keeps one form and the focus halo
alone marks text-entry targets; (c) **visibility is session-scoped, not
action-scoped** — the §4 idle dim/hide behavior is dropped (it made the
cursor materialize near each new target like a focus point instead of
travelling). The cursor fades in when the agent session starts, stays
visible the whole run — gliding between actions, sitting still while the
model thinks — and fades out at session end (driven by the same
AGENT_ACTIVITY signal as the agent border). Capture suspends resume with a
150ms soft fade instead of a hard pop.
