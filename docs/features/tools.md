# OpenSidebar Tools Reference

This document provides a comprehensive reference for all tools available in OpenSidebar, an AI-powered Chrome extension with agentic browsing capabilities.

## Overview

OpenSidebar provides **51 tools** organized into categories such as DOM interaction, navigation, browser management, page analysis, and control flow.

---

## DOM Interaction Tools

### click_element

Click an element on the page. Auto-scrolls to it first.

| Parameter | Type    | Required | Description                    |
| --------- | ------- | -------- | ------------------------------ |
| id        | integer | Yes      | Tag ID of the element to click |

**Example:**

```json
{
  "tool": "click_element",
  "args": { "id": 5 }
}
```

---

### type_text

Type into an input field. Auto-focuses and auto-scrolls. Clears existing text in input/textarea fields; appends in contenteditable.

| Parameter  | Type    | Required | Description                               |
| ---------- | ------- | -------- | ----------------------------------------- |
| id         | integer | Yes      | Tag ID of the input element               |
| text       | string  | Yes      | Text to type                              |
| pressEnter | boolean | No       | Press Enter after typing (default: false) |

**Notes:**

- Only set `pressEnter` for single-field forms (search bars)
- For multi-field forms, fill all fields first then click the submit button

---

### scroll_page

Scroll the page or a container.

| Parameter | Type    | Required | Description                              |
| --------- | ------- | -------- | ---------------------------------------- |
| direction | string  | Yes      | Direction: "up", "down", "top", "bottom" |
| id        | integer | No       | Container tag ID. Omit for window scroll |

**Note:** If you know what text you're looking for, use `find_element` instead — it scrolls directly to it.

---

### read_page

Force a fresh DOM snapshot. Gets a new view of the current page state.

| Parameters | None |
| ---------- | ---- |

**Notes:**

- Only needed after `find_element` fails or after dynamic content changes
- The page snapshot is already in your context each turn — don't call this just to "see" the page

---

### hover_element

Hover to reveal menus, tooltips, or hidden content. Auto-scrolls to element.

| Parameter | Type    | Required | Description           |
| --------- | ------- | -------- | --------------------- |
| id        | integer | Yes      | Tag ID of the element |

---

### find_element

Find exact visible text on the page, scroll to it, and return its tag ID.

| Parameter | Type   | Required | Description        |
| --------- | ------ | -------- | ------------------ |
| text      | string | Yes      | Text to search for |

**Notes:**

- Only works with text that literally appears on screen
- Do NOT search for conceptual labels, element types, or attribute values
- Use `read_page` first if unsure what text exists

---

### select_option

Select an option from a native HTML `<select>` dropdown.

| Parameter | Type    | Required | Description                  |
| --------- | ------- | -------- | ---------------------------- |
| id        | integer | Yes      | Tag ID of the select element |
| value     | string  | Yes      | Option text or value         |

**Note:** For custom dropdowns (div-based menus), click the menu to open it then click the option.

---

### press_key

Press a keyboard key on the page (dispatched to window, not a specific element).

| Parameter | Type   | Required | Description                                                           |
| --------- | ------ | -------- | --------------------------------------------------------------------- |
| key       | string | Yes      | Key name (e.g., "Enter", "Escape", "Tab", "ArrowDown", " " for space) |
| modifiers | array  | No       | Modifier keys to hold (e.g., ["ctrl"], ["shift", "alt"])              |

**Note:** For typing into fields, use `type_text`. Useful for Escape, Tab, Enter, arrow keys.

---

### drag_and_drop

Drag source element to target element.

| Parameter | Type    | Required | Description   |
| --------- | ------- | -------- | ------------- |
| sourceId  | integer | Yes      | Source tag ID |
| targetId  | integer | Yes      | Target tag ID |

**Notes:**

- Looks for elements with `draggable=true` (sources) and `dropzone=true` (targets)
- Source is auto-scrolled into view but target is NOT
- Scroll to reveal both elements first if they're far apart

---

### draw_stroke

Draw a stroke on a canvas element.

| Parameter | Type    | Required | Description                            |
| --------- | ------- | -------- | -------------------------------------- |
| id        | integer | Yes      | Canvas tag ID                          |
| startX    | number  | Yes      | Start X (relative to element top-left) |
| startY    | number  | Yes      | Start Y (relative to element top-left) |
| endX      | number  | Yes      | End X (relative to element top-left)   |
| endY      | number  | Yes      | End Y (relative to element top-left)   |

**Note:** Coordinates are relative to the element's top-left corner (0,0 = top-left).

---

### hide_element

Hide an overlay blocking interaction (sets display:none).

| Parameter | Type    | Required | Description           |
| --------- | ------- | -------- | --------------------- |
| id        | integer | Yes      | Tag ID of the element |

**Notes:**

- Must match overlay heuristics: fixed/absolute + z-index>100, dialog role, backdrop-filter, or >30% viewport coverage
- If rejected, try `click_element` on a close button or `press_key` Escape instead

---

### read_element

Read a specific attribute (href, src, value) of an element.

| Parameter | Type    | Required | Description                                                              |
| --------- | ------- | -------- | ------------------------------------------------------------------------ |
| id        | integer | Yes      | Tag ID of the element                                                    |
| attribute | string  | No       | Attribute to read (e.g., "href", "src", "value"). Omit for text content. |

**Note:** For visible text, check the page snapshot first — it's already there.

---

### right_click

Right-click on an element (dispatches contextmenu event). Auto-scrolls to element.

| Parameter | Type    | Required | Description           |
| --------- | ------- | -------- | --------------------- |
| id        | integer | Yes      | Tag ID of the element |

**Note:** If no menu appears, the page may not handle contextmenu events.

---

### set_checkbox

Set a checkbox or radio to checked/unchecked. Fires input and change events.

| Parameter | Type    | Required | Description                         |
| --------- | ------- | -------- | ----------------------------------- |
| id        | integer | Yes      | Checkbox/radio tag ID               |
| checked   | boolean | Yes      | Whether the input should be checked |

---

### click_coordinates

Click at viewport X/Y coordinates.

| Parameter   | Type   | Required | Description                            |
| ----------- | ------ | -------- | -------------------------------------- |
| x           | number | Yes      | X coordinate in viewport pixels        |
| y           | number | Yes      | Y coordinate in viewport pixels        |
| description | string | No       | What you expect to click (for logging) |

**Notes:**

- ONLY use when the target has no [N] tag (canvas apps, games, obfuscated UIs)
- Prefer `click_element` when a tag exists

---

### upload_file

Upload a file to an `<input type="file">` element.

| Parameter | Type    | Required | Description               |
| --------- | ------- | -------- | ------------------------- |
| id          | integer | Yes      | File input tag ID         |
| url         | string  | No       | URL of the file to upload |
| profileFile | string | No       | Named local profile file, currently `cv` |

**Notes:**

- Downloads the file from the URL (max 10MB)
- Then injects it into the file input
- Provide either `url` or `profileFile`

---

### execute_js

Run JavaScript in the page context.

| Parameter | Type   | Required | Description                 |
| --------- | ------ | -------- | --------------------------- |
| code      | string | Yes      | JavaScript code to evaluate |

**Notes:**

- Use for hidden/computed values, timers, or DOM queries that tagged elements can't reach
- Returns the result as a string
- **No jQuery** — use `el.textContent.includes()` not `:contains()`
- Use `el.getAttribute('class')` not `el.className` (fails on SVG)
- Use `Array.from(querySelectorAll(...))` for array methods
- Wrap in `(function(){ ... })()` if using return

---

## Navigation Tools

### navigate

Navigate to a URL or search query. Waits for page load to complete.

| Parameter | Type   | Required | Description                               |
| --------- | ------ | -------- | ----------------------------------------- |
| url       | string | No\*     | Full URL (https://)                       |
| query     | string | No\*     | Search query (uses default search engine) |

**Note:** Provide url OR query, not both.

---

### create_tab

Open a new tab in this workspace.

| Parameter | Type   | Required | Description |
| --------- | ------ | -------- | ----------- |
| url       | string | Yes      | URL to open |

**Returns:** The new tab's ID. Use `switch_tab` to make it active for subsequent tools.

---

### close_tab

Close a tab in this workspace.

| Parameter | Type    | Required | Description                   |
| --------- | ------- | -------- | ----------------------------- |
| tabId     | integer | No       | Tab ID. Omit for current tab. |

**Note:** Cannot close the current tab — switch to another tab first.

---

### switch_tab

Switch to another tab in this workspace.

| Parameter | Type    | Required | Description         |
| --------- | ------- | -------- | ------------------- |
| tabId     | integer | Yes      | Tab ID to switch to |

**Note:** All subsequent tool calls will run on this tab until you switch again.

---

### go_back

Go back in browser history.

| Parameters | None |
| ---------- | ---- |

**Note:** Waits for page load to complete.

---

### go_forward

Go forward in browser history.

| Parameters | None |
| ---------- | ---- |

**Note:** Waits for page load to complete.

---

### list_tabs

List open tabs in this workspace with their IDs, titles, and URLs.

| Parameters | None |
| ---------- | ---- |

---

### create_window

Open a new browser window.

| Parameter | Type    | Required | Description                   |
| --------- | ------- | -------- | ----------------------------- |
| url       | string  | No       | URL to open in the new window |
| incognito | boolean | No       | Open in incognito mode        |

---

## Browser Management Tools

### wait

Pause for dynamic content to load, then re-orient.

| Parameter | Type    | Required | Description                                                  |
| --------- | ------- | -------- | ------------------------------------------------------------ |
| seconds   | integer | Yes      | Seconds to wait (1–10)                                       |
| reason    | string  | No       | Why you're pausing (e.g., "lost track of which step I'm on") |

**Notes:**

- Use for timed reveals, animations, or AJAX loads
- Not just to re-read the page (use `read_page` for that)
- Returns your original goal, plan progress, and fresh page state

---

### done

Signal task completion or answer the user's question with a summary.

| Parameter | Type   | Required | Description                                                  |
| --------- | ------ | -------- | ------------------------------------------------------------ |
| summary   | string | Yes      | What was accomplished, or your answer to the user's question |

---

### group_tabs

Group tabs into a tab group with a title and optional color.

| Parameter | Type   | Required | Description                                                              |
| --------- | ------ | -------- | ------------------------------------------------------------------------ |
| tabIds    | array  | Yes      | Tab IDs to group                                                         |
| title     | string | Yes      | Group title                                                              |
| color     | string | No       | Group color (grey, blue, red, yellow, green, pink, purple, cyan, orange) |

---

### ungroup_tabs

Remove tabs from their tab group.

| Parameter | Type  | Required | Description        |
| --------- | ----- | -------- | ------------------ |
| tabIds    | array | Yes      | Tab IDs to ungroup |

---

### get_cookies

Get cookies for a URL.

| Parameter | Type   | Required | Description                                   |
| --------- | ------ | -------- | --------------------------------------------- |
| url       | string | No       | URL to get cookies for. Omit for current tab. |

---

### set_cookie

Set a cookie for a URL.

| Parameter | Type   | Required | Description          |
| --------- | ------ | -------- | -------------------- |
| url       | string | Yes      | URL to set cookie on |
| name      | string | Yes      | Cookie name          |
| value     | string | Yes      | Cookie value         |
| domain    | string | No       | Cookie domain        |
| path      | string | No       | Cookie path          |

---

### delete_cookie

Delete a specific cookie by name and URL.

| Parameter | Type   | Required | Description               |
| --------- | ------ | -------- | ------------------------- |
| url       | string | Yes      | URL the cookie belongs to |
| name      | string | Yes      | Cookie name to delete     |

---

### copy_to_clipboard

Copy text to the system clipboard.

| Parameter | Type   | Required | Description  |
| --------- | ------ | -------- | ------------ |
| text      | string | Yes      | Text to copy |

---

### search_history

Search browser history by keyword.

| Parameter  | Type    | Required | Description               |
| ---------- | ------- | -------- | ------------------------- |
| query      | string  | Yes      | Search keyword            |
| maxResults | integer | No       | Max results (default: 20) |

---

### create_bookmark

Bookmark a page.

| Parameter | Type   | Required | Description                               |
| --------- | ------ | -------- | ----------------------------------------- |
| title     | string | No       | Bookmark title (defaults to current tab)  |
| url       | string | No       | URL to bookmark (defaults to current tab) |
| parentId  | string | No       | Parent folder ID                          |

---

### get_bookmarks

Search bookmarks by keyword.

| Parameter  | Type    | Required | Description               |
| ---------- | ------- | -------- | ------------------------- |
| query      | string  | Yes      | Search keyword            |
| maxResults | integer | No       | Max results (default: 20) |

---

### download_file

Start a download to the user's downloads folder.

| Parameter | Type   | Required | Description                               |
| --------- | ------ | -------- | ----------------------------------------- |
| url       | string | Yes      | URL of the file to download               |
| filename  | string | No       | Optional filename for the downloaded file |

**Note:** Returns immediately — download completes in the background.

---

## Page Analysis Tools

### inspect_hidden

Scan the page for hidden DOM elements.

| Parameter  | Type    | Required | Description                        |
| ---------- | ------- | -------- | ---------------------------------- |
| pattern    | string  | No       | Case-insensitive text filter       |
| maxResults | integer | No       | Max results (default: 25, max: 50) |

**Detects:**

- display:none
- visibility:hidden
- opacity:0
- off-screen positioning
- color camouflage
- aria-hidden
- text-indent
- font-size:0

---

### inspect_chart

Extract read-only chart and dashboard evidence from DOM, SVG, canvas, and common chart-library state.

| Parameter  | Type    | Required | Description                                      |
| ---------- | ------- | -------- | ------------------------------------------------ |
| pattern    | string  | No       | Case-insensitive chart label or series filter    |
| maxResults | integer | No       | Max labels or points (default: 30, max: 100)     |

**Use for:** chart value extraction, dashboard metrics, graph labels, and visible data points.

---

### inspect_region

Zoom into a screen region and return a magnified view (RFC LP-13). The pixel-path complement to `inspect_chart` — use it when a value exists only in pixels (a `<canvas>` chart, tiny text, dense map labels). Max 2 calls per turn; each zoom charges the high-detail image budget.

| Parameter | Type    | Required | Description                                                        |
| --------- | ------- | -------- | ------------------------------------------------------------------ |
| id        | integer | No       | Tag ID to zoom onto (20px padding). Use this OR the rect.          |
| x         | number  | No       | Region left edge in viewport pixels (the `@box` coordinate space)  |
| y         | number  | No       | Region top edge in viewport pixels                                 |
| width     | number  | No       | Region width in viewport pixels                                    |
| height    | number  | No       | Region height in viewport pixels                                   |
| purpose   | string  | No       | What the agent is trying to read (recorded in the trace)           |

**Use for:** canvas fine print, small chart labels, favicon-sized icons, dense tables — after `inspect_chart` and DOM reads come up empty. On vision turns the magnified image is attached to the executor's next view; on structured turns the perception model describes the crop.

---

### inspect_table

Summarize visible table/list structure, headers, sampled rows, sort indicators, and useful URL query state.

| Parameter | Type    | Required | Description                                      |
| --------- | ------- | -------- | ------------------------------------------------ |
| maxRows   | integer | No       | Max visible rows per table/list (default: 10)    |

**Use for:** list filtering, list sorting, row verification, and table state checks.

---

### inspect_filter_state

Summarize filter/query controls and applied filter state without mutating the page.

| Parameter  | Type    | Required | Description                                  |
| ---------- | ------- | -------- | -------------------------------------------- |
| pattern    | string  | No       | Case-insensitive field/filter text filter    |
| maxResults | integer | No       | Max controls or conditions (default: 30)     |

**Use for:** condition builders, list filters, filter chips, and URL-backed query state.

---

### inspect_catalog_item

Summarize catalog item controls, selected options, checked state, quantity-like inputs, and price/summary cues.

| Parameter   | Type    | Required | Description                                      |
| ----------- | ------- | -------- | ------------------------------------------------ |
| maxControls | integer | No       | Max configurable controls (default: 40, max: 80) |

**Use for:** service catalog configuration, quantity/options checks, cart/request confirmation prep.

---

### xray_page

Toggle X-ray mode: forces all hidden elements visible.

| Parameters | None |
| ---------- | ---- |

**Notes:**

- Overrides display:none, opacity:0, visibility:hidden
- Call again to disable
- Use when you suspect content is hidden by CSS

---

### fast_forward

Toggle fast-forward mode: accelerates all page timers to fire instantly.

| Parameters | None |
| ---------- | ---- |

**Notes:**

- Accelerates setTimeout/setInterval to fire instantly
- Use when content appears after a countdown or timed delay
- Call again to restore normal timing

---

### read_pdf

Extract text from a PDF URL.

| Parameter | Type    | Required | Description                        |
| --------- | ------- | -------- | ---------------------------------- |
| url       | string  | Yes      | PDF URL                            |
| maxPages  | integer | No       | Max pages to extract (default: 20) |

---

## Control Flow Tools

### escalate

Switch to a smarter, slower model for complex reasoning.

| Parameter | Type   | Required | Description                             |
| --------- | ------ | -------- | --------------------------------------- |
| reason    | string | Yes      | Why the current model can't handle this |

**Note:** Use when stuck on riddles, puzzles, math, or multi-step logic. Switches execution onto the planner tier.

---

## Audio/Video Tools

### transcribe_audio

Transcribe speech from an `<audio>` or `<video>` element.

| Parameter | Type    | Required | Description                       |
| --------- | ------- | -------- | --------------------------------- |
| id        | integer | Yes      | Tag ID of the audio/video element |

**Notes:**

- Use when a challenge hides information in audio (spoken codes, instructions, passwords)
- Returns the full text transcript

---

## Tool Categories Summary

| Category               | Tools                                                                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DOM Interaction**    | click_element, type_text, scroll_page, read_page, hover_element, find_element, select_option, press_key, drag_and_drop, draw_stroke, hide_element, read_element, right_click, set_checkbox, click_coordinates, upload_file, execute_js |
| **Navigation**         | navigate, create_tab, close_tab, switch_tab, go_back, go_forward, list_tabs, create_window                                                                                                                                             |
| **Browser Management** | wait, done, group_tabs, ungroup_tabs, get_cookies, set_cookie, delete_cookie, copy_to_clipboard, search_history, create_bookmark, get_bookmarks, download_file                                                                            |
| **Page Analysis**      | inspect_hidden, inspect_chart, inspect_region, inspect_table, inspect_filter_state, inspect_catalog_item, xray_page, fast_forward, read_pdf                                                                                                             |
| **Control Flow**       | escalate                                                                                                                                                                                                                               |
| **Audio/Video**        | transcribe_audio                                                                                                                                                                                                                       |
| **Utilities**          |                                                                                                                                                                                                                                        |

---

## Risk Levels

Tools are classified by risk level:

| Level      | Description                     | Tools                                                                                        |
| ---------- | ------------------------------- | -------------------------------------------------------------------------------------------- |
| **LOW**    | Read-only page inspection       | read_page, scroll_page, list_tabs, get_bookmarks, inspect_hidden, inspect_chart, inspect_region, inspect_table, inspect_filter_state, inspect_catalog_item |
| **MEDIUM** | Mutates page or browser state   | click_element, type_text, hover_element, select_option, set_checkbox, copy_to_clipboard, download_file |
| **HIGH**   | Navigation, tabs, browser data, or code execution | navigate, close_tab, create_tab, go_back, go_forward, execute_js, get_cookies, set_cookie, delete_cookie, search_history |

---

## Model Tiers

OpenSidebar uses separate runtime tiers for execution, planning, and visual perception:

| Model Tier | Model ID                           | Provider    | Use Case                           |
| ---------- | ---------------------------------- | ----------- | ---------------------------------- |
| **Executor** | `accounts/fireworks/models/kimi-k2p7-code` | Fireworks | Executor, everyday tasks (default) |
| **Planner**  | `accounts/fireworks/routers/kimi-k2p6-turbo` | Fireworks | Complex reasoning, escalated tasks |
| **Perception** | `unified_vl` by default; structured fallback is provider-specific | Configured provider | Vision-based page understanding |

The `escalate` tool switches execution onto the planner tier when needed.
