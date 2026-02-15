# OpenSidebar Tools Reference

This document provides a comprehensive reference for all tools available in OpenSidebar, an AI-powered Chrome extension with agentic browsing capabilities.

## Overview

OpenSidebar provides **50 tools** organized into categories:

- **DOM Interaction** (17 tools)
- **Navigation** (8 tools)
- **Memory** (2 tools)
- **Browser Management** (11 tools)
- **Page Analysis** (4 tools)
- **React Toolkit** (4 tools)
- **Utilities** (4 tools)

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

- ONLY use after `take_screenshot` when the target has no [N] tag (canvas apps, games, obfuscated UIs)
- Prefer `click_element` when a tag exists

---

### upload_file

Upload a file to an `<input type="file">` element.

| Parameter | Type    | Required | Description               |
| --------- | ------- | -------- | ------------------------- |
| id        | integer | Yes      | File input tag ID         |
| url       | string  | Yes      | URL of the file to upload |

**Notes:**

- Downloads the file from the URL (max 10MB)
- Then injects it into the file input

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

## Memory Tools

### memory_add

Save info to long-term memory (Second Brain).

| Parameter | Type   | Required | Description      |
| --------- | ------ | -------- | ---------------- |
| content   | string | Yes      | Text to remember |
| category  | string | No       | Category tag     |

**Note:** Memories are stored locally using SQLite FTS5 + Voy vector search with Reciprocal Rank Fusion (RRF) for hybrid retrieval.

---

### memory_search

Search long-term memory.

| Parameter | Type   | Required | Description  |
| --------- | ------ | -------- | ------------ |
| query     | string | Yes      | Search query |

**Returns:** Ranked results with scores from the hybrid search.

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

### take_screenshot

Capture and describe the visual layout.

| Parameters | None |
| ---------- | ---- |

**Notes:**

- Use when element tags don't match what you expect
- Use when you need spatial context
- Use when stuck after 3+ failed attempts

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

## React Toolkit

> **Note:** These tools are gated behind React detection — they only become available when React is detected on the page.

### inspect_react

Read React component name, props, and state for a tagged element.

| Parameter | Type    | Required | Description                                                 |
| --------- | ------- | -------- | ----------------------------------------------------------- |
| id        | integer | Yes      | Tag ID of the element to inspect                            |
| depth     | integer | No       | How many parent components to traverse (default: 3, max: 8) |

**Notes:**

- Use when data isn't visible in the DOM
- Hidden values, form state, loading flags
- Values stored in useState/useReducer

---

### react_set_input

Set a React controlled input value.

| Parameter | Type    | Required | Description                                      |
| --------- | ------- | -------- | ------------------------------------------------ |
| id        | integer | Yes      | Tag ID of the input element                      |
| value     | string  | Yes      | The value to set                                 |
| submit    | boolean | No       | Press Enter after setting value (default: false) |

**Notes:**

- Use when `type_text` doesn't update the field (React controlled components ignore direct DOM writes)
- Falls back to standard input events if React isn't managing this element

---

### inspect_react_tree

Show the React component tree structure with state summaries.

| Parameter | Type    | Required | Description                                          |
| --------- | ------- | -------- | ---------------------------------------------------- |
| depth     | integer | No       | Max tree depth to traverse (default: 5, max: 10)     |
| filter    | string  | No       | Only show components whose name contains this string |

**Note:** Use to understand page organization when the DOM structure is unclear.

---

### wait_for_react

Wait for React to finish rendering (pending state updates, Suspense, transitions).

| Parameter | Type    | Required | Description                                     |
| --------- | ------- | -------- | ----------------------------------------------- |
| timeout   | integer | No       | Max wait time in ms (default: 3000, max: 10000) |

**Note:** Use after an action that triggers async state changes instead of a blind wait.

---

## Control Flow Tools

### escalate

Switch to a smarter, slower model for complex reasoning.

| Parameter | Type   | Required | Description                             |
| --------- | ------ | -------- | --------------------------------------- |
| reason    | string | Yes      | Why the current model can't handle this |

**Note:** Use when stuck on riddles, puzzles, math, or multi-step logic. Switches to Grok 4.1 Fast model.

---

### update_plan

Report task progress or REVISE the plan if the current one is failing.

| Parameter    | Type    | Required | Description                                  |
| ------------ | ------- | -------- | -------------------------------------------- |
| subtasks     | array   | Yes      | Ordered list of subtask descriptions         |
| currentIndex | integer | Yes      | 0-based index of the NEXT subtask to execute |
| lastResult   | string  | No       | Brief result of the last completed subtask   |
| rationale    | string  | No\*     | Required if changing the plan                |

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
- Requires a Groq API key in settings (uses Whisper large-v3-turbo)

---

## Utility Tools

### send_notification

Show a desktop notification to the user.

| Parameter | Type   | Required | Description        |
| --------- | ------ | -------- | ------------------ |
| title     | string | Yes      | Notification title |
| message   | string | Yes      | Notification body  |

---

## Tool Categories Summary

| Category               | Tools                                                                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DOM Interaction**    | click_element, type_text, scroll_page, read_page, hover_element, find_element, select_option, press_key, drag_and_drop, draw_stroke, hide_element, read_element, right_click, set_checkbox, click_coordinates, upload_file, execute_js |
| **Navigation**         | navigate, create_tab, close_tab, switch_tab, go_back, go_forward, list_tabs, create_window                                                                                                                                             |
| **Memory**             | memory_add, memory_search                                                                                                                                                                                                              |
| **Browser Management** | wait, take_screenshot, done, group_tabs, ungroup_tabs, get_cookies, set_cookie, delete_cookie, copy_to_clipboard, search_history, create_bookmark, get_bookmarks, download_file                                                        |
| **Page Analysis**      | inspect_hidden, xray_page, fast_forward, read_pdf                                                                                                                                                                                      |
| **React Toolkit**      | inspect_react, react_set_input, inspect_react_tree, wait_for_react                                                                                                                                                                     |
| **Control Flow**       | escalate, update_plan                                                                                                                                                                                                                  |
| **Audio/Video**        | transcribe_audio                                                                                                                                                                                                                       |
| **Utilities**          | send_notification                                                                                                                                                                                                                      |

---

## Risk Levels

Tools are classified by risk level:

| Level      | Description                     | Tools                                                                                        |
| ---------- | ------------------------------- | -------------------------------------------------------------------------------------------- |
| **LOW**    | Read-only operations            | read_page, scroll_page, memory_search, list_tabs, get_cookies, search_history, get_bookmarks |
| **MEDIUM** | Mutates state but reversible    | click_element, type_text, hover_element, select_option, set_checkbox, copy_to_clipboard      |
| **HIGH**   | Navigation, tabs, external data | navigate, close_tab, create_tab, escalate, download_file, send_notification                  |

---

## Model Tiers

OpenSidebar uses two LLM tiers with priority-based provider failover:

| Model Tier | Model ID                           | Provider                              | Use Case                           |
| ---------- | ---------------------------------- | ------------------------------------- | ---------------------------------- |
| **Fast**   | `gpt-oss-120b`                     | Cerebras (3000 TPS, highest priority) | Fast, everyday tasks (default)     |
| **Fast**   | `openai/gpt-oss-120b`              | Groq (250K TPM)                       | Fast fallback                      |
| **Fast**   | `openai/gpt-oss-120b`              | OpenRouter                            | Fast fallback                      |
| **Smart**  | `x-ai/grok-4.1-fast:nitro`         | OpenRouter                            | Complex reasoning, escalated tasks |
| **Vision** | `qwen/qwen3-vl-235b-a22b-instruct` | OpenRouter                            | Screenshot analysis (configurable) |

The `escalate` tool switches to Grok 4.1 when needed.
