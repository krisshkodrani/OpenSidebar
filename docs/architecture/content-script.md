# Content Script

The content script is OpenSidebar's "eyes and hands" — it runs in every tab and provides DOM access for the agent.

## Architecture

**Location:** `apps/extension/src/content/`

- `content.ts` — main entry, message handling, the Janitor (overlay
  auto-dismiss), readiness signaling, plus the presence layer (LP-24 agent
  cursor), agent border, skill recording, and E2E rail surfaces
- `snapshot.ts` — DOM snapshot generation, page-content distillation
- `tagging/` — element discovery and tagging (`index.ts` barrel +
  `stable-ids.ts`, `dom-traversal.ts`, `scoring.ts`, `structural.ts`, `utils.ts`)
- `actions/` — tool execution (`index.ts` barrel + `interaction.ts`,
  `inspection.ts`, `page-manipulation.ts`, `helpers.ts`)

## DOM Snapshot

The content script produces a `DomSnapshot` (authoritative shape:
`packages/shared-types/src/dom.ts`). Key fields:

- `title`, `url`, `elements: TaggedElement[]`
- `pageContent?` — the primary text field: a Readability + Turndown markdown
  distillation of the page (`visibleContent` is optional/secondary)
- `skeleton?` — page structure outline (headings/landmarks,
  `PageSkeletonNode`)
- `viewport`, `scroll` (includes `viewportHeight`), `lang?`, `dir?`,
  `overflow?`, `framework?`
- `survivingOverlays?`, `capturedTexts?`

`TaggedElement` carries `tag` (the numeric ID), tagName/role/text/attributes/
rect/visibility, and `isNew?` — elements that appeared since the previous
snapshot are marked (rendered with a `*` prefix) so the model can spot what
changed (LP-10).

## Element Discovery

### Interactive element selectors

`INTERACTIVE_SELECTORS` (`tagging/dom-traversal.ts`) covers links, buttons,
inputs, textareas, selects, ARIA roles (`button`, `link`, `tab`, `menuitem`,
`checkbox`, `radio`, `switch`, `combobox`, `option`), `contenteditable`,
`summary`/`details`, `[onclick]`, focusable `[tabindex]`, `canvas`, and
`[draggable='true']`.

A **phase-2 clickable scan** (`detectClickableElements`, time-budgeted to
~25ms) additionally discovers `cursor: pointer` elements the selector list
misses.

### Visibility detection

Elements are tagged only if they have non-zero dimensions, aren't hidden via
CSS (`display`/`visibility`/`opacity`), aren't clipped, and are within
document bounds.

### Stable IDs

Tag IDs are **not incremental per snapshot** — they are stable hash-based IDs
(`tagging/stable-ids.ts`): a `computeStableHash` of the element's identity
maps to a persistent numeric ID that survives re-snapshots, with grace
periods, collision suffixing, and `resetStableIds()` on navigation. This is
what lets the model reuse `[5]` across turns without re-grounding. Elements
also get a `data-os-tag` attribute so MAIN-world scripts can find them.

### Tagging algorithm

1. Query all matching elements (deep traversal — see Edge Cases)
2. Filter by visibility
3. Score by task relevance (`scoreElement()` — form inputs +10, submit/file
   +8, draggables +8, canvas +6, named +5)
4. Sort by score, assign stable IDs
5. Build `TaggedElement` objects

**Cap:** `MAX_TAGGED_ELEMENTS = 1000` (+5 overflow slots for dynamic pins).
File inputs are special-cased (`isUploadFileInput`) so `upload_file` targets
are always taggable.

### Dynamic tag pinning

Elements found via `find_element` are pinned through `addDynamicTag()`:
TTL of 3 snapshot refresh cycles, 5 overflow slots beyond the cap, immediate
cleanup when removed from the DOM, and near-identical collapse (same
tag + text grouped, max 2 kept per group).

## Actions

The `executeAction` switch in `actions/index.ts` implements the
content-script tools: `click_element`, `type_text`, `scroll_page`,
`read_page`, `hover_element`, `find_element`, `select_option`, `press_key`,
`drag_and_drop`, `hide_element`, `read_element`, `right_click`,
`set_checkbox`, `click_coordinates`, `upload_file`, `extract_form_state`, and
overlay dismissal. (Note: `execute_js` and `inspect_hidden` are
**background**-registered tools — they inject via `chrome.scripting`, not
through this switch.)

Highlights:

- **click_element** — scroll into view, z-index/overlay coverage check,
  navigation detection, synthetic mousedown/mouseup/click plus native
  `.click()`.
- **type_text** — focus, clear, per-character input events (for SPAs),
  change event, optional Enter.
- **hover_element** — synthetic mouse events plus a CSS `:hover` workaround:
  matching `:hover` rules are rewritten to a `.--os-hover-active` class
  applied to the element and ancestors (synthetic events can't trigger the
  real pseudo-class).
- **find_element** — `window.find()` then a DOM walk-up to the nearest
  interactive/semantic container, pinned via `addDynamicTag()`.
- **drag_and_drop** — full `dragstart` → `dragover` → `drop` → `dragend`
  sequence with a `DataTransfer` object.

Param convention: element tools take `id` (integer, the tag ID) — never
`tag`. Names must match the `ToolDefinition` schema and the shared args types.

## Janitor (overlay auto-dismiss)

`runJanitor()` in `content.ts` dismisses cookie banners, overlay modals, and
notification popups — heuristic selectors for common frameworks (OneTrust
`#onetrust-accept-btn-handler`, Google Funding Choices `.fc-cta-consent`,
generic accept buttons) plus broadened overlay detection (`[aria-modal]`,
`dialog[open]`, data-attribute and class patterns, ≥15% viewport coverage).
The selector list has grown well beyond the examples above and dismissal is
**MutationObserver-driven**, not just on page load. The background can also
trigger it via `DISMISS_MODALS`.

Overlays that survive dismissal are reported in the snapshot as
`survivingOverlays` so the agent handles them deliberately.

## Extension element filtering

`isOwnElement()` (`tagging/dom-traversal.ts`) excludes elements the extension
itself injects (presence cursor, agent border, overlays) so the agent never
targets its own UI.

## Label association

`extractAttributes()` resolves form labels — explicit `<label for>`, implicit
label wrappers, and `aria-labelledby` — surfaced as `label="..."` in
`TaggedElement.attributes`.

## Message protocol

Authoritative shapes: `packages/shared-types/src/messages/content-protocol.ts`.

- `DOM_SNAPSHOT_REQUEST` — payload `{ refresh: boolean, autoDismiss?: boolean }`
  (`autoDismiss` lets post-tool refreshes skip overlay dismissal) →
  `DOM_SNAPSHOT_RESPONSE`
- `TOOL_EXECUTE` — `{ toolName, args, toolCallId }` → `TOOL_RESULT`
- `DISMISS_MODALS` → `DISMISS_MODALS_RESPONSE` (dismissed/clicked/hidden
  counts, remaining overlay, captured texts)
- `CONTENT_SCRIPT_READY` — emitted on injection; the background's
  `ensureContentScript` waits on this instead of sleeping
- `DOM_READY_PROBE` / `DOM_READY_ACK`, `SCROLL_TO_POSITION`,
  `PRESENCE_SUSPEND` / `PRESENCE_RESUME`

## Edge Cases

### Shadow DOM and iframes

Deep traversal lives in `tagging/dom-traversal.ts`
(`getDeepQueryRoots()` + filtering):

- **Open shadow roots** — traversed recursively up to
  `MAX_SHADOW_DEPTH = 10`.
- **Closed shadow roots** — read-only traversal via
  `chrome.dom.openOrClosedShadowRoot` (LP-12 Phase A); "closed = inaccessible"
  no longer holds.
- **Same-origin iframes** — traversed. Cross-origin iframes are not
  (LP-12 Phase B is the open follow-up).

### SPAs and dynamic content

The content script survives SPA navigation, but stale tags are handled by the
stable-ID grace period plus the agent loop always requesting fresh snapshots
before acting. Late-loading content is captured on the next snapshot.

## Testing

`apps/extension/tests/content/` — `tagging`, `snapshot`, `actions`,
`dom-traversal`, `structural`, `shadow-dom-{before,after,closed}`,
`overlay-detection`, `modal-dismiss`, `extract-form-state`, `file-upload`,
`readability`, `custom-combobox`, presence and skill-recording suites. Tests
run on Happy DOM with mock documents.
