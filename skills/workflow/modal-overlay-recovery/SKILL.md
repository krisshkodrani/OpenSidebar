# Modal Overlay Recovery

## When To Use

Use this skill when the page has one or more blocking overlays (modals, cookie banners, newsletter popups, confirmation dialogs) that must be dismissed before the underlying content is accessible.

Use it for:

- cookie consent banners blocking page interaction
- newsletter or signup popups obscuring content
- multiple stacked overlays that must be dismissed sequentially
- any task where the first step is clearing blocking UI

Do not use it for:

- confirmation dialogs that are part of the intended workflow (use transactional-act-check-act)
- pages with no blocking overlays
- overlays that the user wants to interact with rather than dismiss

## Procedure

1. Read the page and identify ALL visible overlays, banners, and modals. Count them and note their close/dismiss/accept/X buttons.
2. Dismiss the topmost (highest z-index) overlay first by clicking its close, dismiss, accept, or X button directly with `click_element`. Do NOT use `dismiss_overlays` — it hides elements visually with CSS but does not trigger application state changes (React setState, Vue reactivity, etc.), so overlays may reappear or remain functionally present.
3. After each click, re-read the page immediately to confirm the overlay is actually gone (not just hidden) AND to detect any remaining overlays.
4. Repeat steps 2-3 for each remaining overlay. Do not batch dismissals — handle them one at a time.
5. Only after ALL overlays are confirmed gone via re-read, proceed to the underlying task or call done.
6. If an overlay reappears after clicking its close button, try `press_key("Escape")`, then re-read. If still present, look for alternative dismiss targets.

## Required Evidence

- Count of overlays detected on initial page read
- Confirmation that each overlay was dismissed (re-read after each)
- Final page state showing no blocking overlays remain
- If underlying task follows, evidence that the content is now accessible

## Common Failures

- Calling done after dismissing only one of multiple overlays
- Clicking stale element IDs after an overlay is removed (tags shift when DOM changes)
- Assuming dismiss_overlays handled all overlays without re-reading
- Trying to interact with content behind an overlay that is still present
- Batching multiple dismiss attempts without re-grounding between them

## Verification

- Confirm each overlay's dismiss button or close mechanism was activated.
- After each dismissal, verify via re-read that the overlay element is no longer present.
- Final verification: the underlying page content is visible and interactive.

## Relevance

Overlays and blocking modals are one of the most common browser-use pathologies. This skill prevents the agent from prematurely reporting success or burning turns on stale element references after partial dismissal.

Current E2E targets:

- `tests/e2e/continuation-act-check-act.test.ts` (Turn 1: dismiss cookie + newsletter)
- `tests/e2e/modal-overlays.test.ts`
