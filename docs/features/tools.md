# OpenSidebar Tools Reference

This document provides a comprehensive reference for all tools available in OpenSidebar, an AI-powered Chrome extension with agentic browsing capabilities.

## Overview

OpenSidebar provides **52 tools** organized into categories: DOM interaction, navigation, browser management, page analysis, ServiceNow & list workflow, control flow, and memory & profile.

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

Scroll page or container. Pass `y` from @y hints for absolute jump, or `direction` for relative.

| Parameter | Type    | Required | Description                                                              |
| --------- | ------- | -------- | ------------------------------------------------------------------------ |
| y         | integer | No       | Absolute Y position (from @y hints)                                      |
| direction | string  | No       | Direction for relative scrolling: "up", "down", "top", "bottom"          |
| amount    | integer | No       | Pixels for relative scrolling (use 1200–2000 for long/lazy-loaded pages) |
| id        | integer | No       | Container tag ID. Omit for window scroll                                 |

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

### hide_element

Hide an overlay blocking interaction (sets display:none).

| Parameter | Type    | Required | Description           |
| --------- | ------- | -------- | --------------------- |
| id        | integer | Yes      | Tag ID of the element |

**Notes:**

- Must match overlay heuristics: fixed/absolute + z-index>100, dialog role, backdrop-filter, or >30% viewport coverage
- If rejected, try `click_element` on a close button or `press_key` Escape instead

---

### dismiss_overlays

Dismiss all overlays, popups, modals, and cookie banners blocking the viewport. Tries close buttons first, falls back to hiding. Reports surviving overlays.

| Parameters | None |
| ---------- | ---- |

**Note:** Use `hide_element` to target one specific overlay by tag ID.

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

### list_tabs

List open tabs in this workspace with their IDs, titles, and URLs.

| Parameters | None |
| ---------- | ---- |

---

### create_window

Open a new browser window. Used by the orchestrator for parallel lane execution.

| Parameter | Type    | Required | Description                   |
| --------- | ------- | -------- | ----------------------------- |
| url       | string  | No       | URL to open in the new window |

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

### search_history

Search browser history by keyword.

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

## ServiceNow & List Workflow Tools

### open_servicenow_module

Resolve and open a ServiceNow application module from ServiceNow metadata. For tasks like "Navigate to the X > Y module of the Z application", call this before manual menu/search clicks or `navigate(query)`.

| Parameter   | Type    | Required | Description                                                                                    |
| ----------- | ------- | -------- | ---------------------------------------------------------------------------------------------- |
| application | string  | No       | Optional ServiceNow application name, e.g. "Configuration"                                     |
| path        | array   | Yes      | Module path labels, with the target module as the last item, e.g. ["Database Instances", "HBase"] |
| run         | boolean | No       | Whether to navigate after resolving the target URL. Defaults to true                           |

---

### search_knowledge_base

Search the current site's knowledge base, read the best matching articles, and extract the requested answer with evidence. Use this before manual search clicks for knowledge-base answer questions.

| Parameter  | Type    | Required | Description                                                                                     |
| ---------- | ------- | -------- | ------------------------------------------------------------------------------------------------ |
| question   | string  | Yes      | Exact user question to answer from the knowledge source                                          |
| query      | string  | No       | Optional search query. Defaults to distinctive terms from the question                           |
| answerType | string  | No       | Expected answer shape: "auto", "number", "text". Defaults to auto; use number for count, percent, date-like, or numeric questions |
| maxResults | integer | No       | Maximum result articles to fetch and rank (default 5, max 10)                                    |

---

### apply_list_filter

Apply a structured list/table filter from field/operator/value conditions, then verify the applied query state. For tasks like "show records where Field is Value" or "create a filter where A or B", call this as the first mutation instead of manually clicking complex filter-builder widgets.

| Parameter  | Type    | Required | Description                                                                                     |
| ---------- | ------- | -------- | ------------------------------------------------------------------------------------------------ |
| conditions | array   | Yes      | Filter conditions to apply — objects with `field` (required), `operator` (e.g. "is", "is empty", "is not", "starts with"; defaults to "is"), and `value` (display value; empty string for empty-value filters) |
| join       | string  | No       | How to join multiple conditions: "AND" or "OR". Use OR when the request says conditions are alternatives |
| table      | string  | No       | Optional visible list title or system table name when several lists are present                  |
| run        | boolean | No       | Whether to run/navigate the filter after building it. Defaults to true                           |

---

### apply_list_sort

Apply structured list/table sorting from ordered field/direction clauses, then verify the resulting query state. For tasks like "sort by Number descending then Duration ascending", call this as the first mutation instead of manually clicking list headers or personalization menus.

| Parameter | Type    | Required | Description                                                                                      |
| --------- | ------- | -------- | ------------------------------------------------------------------------------------------------ |
| sorts     | array   | Yes      | Ordered sort clauses, primary sort first — objects with `field` (required) and `direction` ("ascending", "descending", "asc", "desc"; defaults to ascending) |
| table     | string  | No       | Optional visible list title or system table name when several lists are present                  |
| run       | boolean | No       | Whether to run/navigate the sort after building it. Defaults to true                             |

---

### apply_list_action

Select visible rows in a ServiceNow list/table by record identifiers or unique row text, apply a visible selected-row action such as Delete or Mark as Duplicate, and optionally confirm the resulting dialog. Use after `inspect_table` has identified the exact target rows.

| Parameter     | Type    | Required | Description                                                                                       |
| ------------- | ------- | -------- | -------------------------------------------------------------------------------------------------- |
| records       | array   | Yes      | Visible record numbers or unique row text snippets identifying rows to select                       |
| action        | string  | Yes      | Visible selected-row action label, e.g. "Delete", "Delete with preview", or "Mark as Duplicate"     |
| relatedRecord | string  | No       | Optional related/reference record value required by the action modal, e.g. the other problem number for "Duplicate of" |
| relatedField  | string  | No       | Optional visible/reference field label or system field name for relatedRecord, e.g. "Duplicate of" or "duplicate_of" |
| table         | string  | No       | Optional visible list title or system table name when several lists are present                     |
| confirm       | boolean | No       | Whether to click a confirmation button in a resulting dialog. Defaults to true                      |

---

### configure_catalog_item

Configure a visible ServiceNow/service catalog item by label, verify requested values, and optionally click the order/request/add-to-cart button. Use this on catalog item detail pages instead of separate select_option, set_checkbox, type_text, radio-option clicks, and submit clicks.

| Parameter          | Type    | Required | Description                                                                                    |
| ------------------ | ------- | -------- | ------------------------------------------------------------------------------------------------ |
| expectedItem       | string  | No       | Expected visible catalog item/product name. When provided, the helper verifies the current item heading/title before submitting and refuses mismatched lookalike items |
| quantity           | string  | No       | Quantity to set when a quantity control exists                                                   |
| textFields         | array   | No       | Text inputs or textareas to fill by visible label, aria-label, name, or id — objects with `field` and `value` (both required) |
| optionFields       | array   | No       | Dropdown/select/radio-like options to choose by visible field label, aria-label, name, id, or nearby catalog variable label — objects with `field` and `value` (both required) |
| checkboxes         | array   | No       | Checkboxes to set by visible label, aria-label, name, or id — objects with `label` and `checked` (both required) |
| submit             | boolean | No       | Click an order/request/add-to-cart control after requested values are verified. Defaults to false |
| submitButton       | string  | No       | Optional visible submit button label, e.g. "Order Now"                                            |
| continueToCheckout | boolean | No       | After clicking an add-to-cart/order-to-cart control, continue by clicking a visible cart checkout/proceed-to-checkout control in the same call. Defaults to false |

---

### configure_servicenow_form

Fill and verify a ServiceNow record form by field label/name using g_form when available, including hidden/tabbed fields, choices, checkboxes, empty values, and references. Use this on ServiceNow record forms before manual type/click sequences.

| Parameter    | Type    | Required | Description                                                                                       |
| ------------ | ------- | -------- | -------------------------------------------------------------------------------------------------- |
| fields       | array   | No       | Requested field/value pairs to set — objects with `field` (visible label or system field name, e.g. "Short description" or "caller_id") and `value` (empty string clears an optional field), both required |
| submit       | boolean | No       | Click the ServiceNow Submit/Save/Update control after verifying requested values. Defaults to false |
| submitButton | string  | No       | Optional submit control label, e.g. "Submit", "Save", or "Update"                                   |

**Note:** Set `submit=true` only after requested values are verified.

---

## Control Flow Tools

### escalate

Switch to a smarter, slower model for complex reasoning.

| Parameter                           | Type   | Required | Description                                                                                    |
| ----------------------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------ |
| reason                              | string | Yes      | Why the current model can't handle this                                                          |
| reasonCode                          | string | No       | Structured escalation reason: "stuck", "complex_reasoning", "missing_tool", "blocked", "other". Use missing_tool only when the Available Tool Capabilities catalog lacks the required capability |
| requiredCapability                  | string | No       | For reasonCode=missing_tool, the absent capability needed to proceed (e.g. "read_page_state", "interact_with_page", "service_now_forms", "list_and_table_workflows") |
| availableCapabilitiesSeenByExecutor | array  | No       | Optional capabilities the executor believes are available from the current catalog               |
| blockingAction                      | string | No       | The concrete next action that cannot be performed without escalation                             |

**Note:** Use when stuck on riddles, puzzles, math, or multi-step logic. Switches execution onto the planner tier.

---

### clarify

Ask the user a question when you encounter ambiguity that cannot be resolved from the page. Use when multiple valid interpretations exist or user preferences are unknown.

| Parameter   | Type   | Required | Description                                     |
| ----------- | ------ | -------- | ----------------------------------------------- |
| question    | string | Yes      | The question to ask the user                    |
| suggestions | array  | No       | Optional suggested answers for quick selection  |

---

### update_plan

Update the current task plan with progress or revised steps. Intercepted by the agent loop to broadcast progress to the side panel.

| Parameter | Type   | Required | Description                              |
| --------- | ------ | -------- | ---------------------------------------- |
| summary   | string | No       | Brief summary of progress or plan update |

---

### compose_text

Delegate authored prose to the specialist Writer, which composes the text and enters it into the target field for you. Use this — not `type_text` — for any free-text answer or prose: job-application questions, essays, cover letters, message/email/comment bodies, "describe/explain/why" fields.

| Parameter    | Type    | Required | Description                                                                                    |
| ------------ | ------- | -------- | ------------------------------------------------------------------------------------------------ |
| id           | integer | Yes      | Tag ID of the target free-text field                                                             |
| instructions | string  | Yes      | What to write and any framing the Writer needs (the question being answered, requested angle, key points to include) |
| context      | string  | No       | Optional source material you already read that the answer should draw on (e.g. the job description, the email being replied to) |
| tone         | string  | No       | Optional desired tone/register (e.g. professional, enthusiastic, concise)                        |
| maxWords     | integer | No       | Optional soft word limit for the composed text                                                   |

**Notes:**

- Do NOT use it for short structured values (names, emails, dates, numbers); type those directly
- Do not retype the field afterwards

---

## Memory & Profile Tools

### update_notes

Save a brief note to the current run scratchpad. Notes survive context compression inside this run only. Use for: key element IDs, discovered values, form structure. Max 500 chars.

| Parameter | Type   | Required | Description      |
| --------- | ------ | -------- | ---------------- |
| note      | string | Yes      | The note to save |

---

### get_profile_fields

Read exact fact-like values from the user's local Profile Digest for form filling. Request only the labels or field paths you need.

| Parameter | Type  | Required | Description                                                                          |
| --------- | ----- | -------- | ------------------------------------------------------------------------------------ |
| fields    | array | Yes      | Exact profile labels or field paths to retrieve, e.g. ["full_name", "email", "location"] |

**Note:** Missing values mean the notes are unavailable, stale, or ambiguous; do not guess.

---

## Tool Categories Summary

| Category                        | Tools                                                                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **DOM Interaction** (17)        | click_element, type_text, scroll_page, read_page, hover_element, find_element, select_option, press_key, drag_and_drop, hide_element, dismiss_overlays, read_element, right_click, set_checkbox, click_coordinates, upload_file, execute_js |
| **Navigation** (7)              | navigate, create_tab, close_tab, switch_tab, go_back, list_tabs, create_window                                                                                                                                            |
| **Browser Management** (7)      | wait, done, get_cookies, set_cookie, delete_cookie, search_history, download_file                                                                                                                                          |
| **Page Analysis** (7)           | inspect_hidden, inspect_chart, inspect_region, inspect_table, inspect_filter_state, inspect_catalog_item, xray_page                                                                                                        |
| **ServiceNow & List Workflow** (7) | open_servicenow_module, search_knowledge_base, apply_list_filter, apply_list_sort, apply_list_action, configure_catalog_item, configure_servicenow_form                                                                 |
| **Control Flow** (4)            | escalate, clarify, update_plan, compose_text                                                                                                                                                                               |
| **Memory & Profile** (2)        | update_notes, get_profile_fields                                                                                                                                                                                           |

---

## Risk Levels

Tools are classified by risk level:

| Level      | Description                     | Tools                                                                                        |
| ---------- | ------------------------------- | -------------------------------------------------------------------------------------------- |
| **LOW** (21)    | Read-only inspection or agent-internal control | read_page, scroll_page, hover_element, find_element, read_element, list_tabs, search_knowledge_base, inspect_hidden, inspect_chart, inspect_region, inspect_table, inspect_filter_state, inspect_catalog_item, xray_page, wait, done, escalate, clarify, update_notes, get_profile_fields, update_plan |
| **MEDIUM** (18) | Mutates page or browser state   | click_element, type_text, select_option, drag_and_drop, hide_element, dismiss_overlays, press_key, switch_tab, upload_file, right_click, set_checkbox, click_coordinates, download_file, apply_list_filter, apply_list_sort, configure_catalog_item, configure_servicenow_form, compose_text |
| **HIGH** (12)   | Navigation, tabs, windows, browser data, destructive list actions, or code execution | navigate, open_servicenow_module, create_tab, close_tab, go_back, create_window, execute_js, get_cookies, set_cookie, delete_cookie, search_history, apply_list_action |

---

## Model Tiers

OpenSidebar uses separate runtime tiers for execution, planning, and visual perception:

| Model Tier | Model ID                           | Provider    | Use Case                           |
| ---------- | ---------------------------------- | ----------- | ---------------------------------- |
| **Executor** | `accounts/fireworks/models/kimi-k2p7-code` | Fireworks | Executor, everyday tasks (default) |
| **Planner**  | `accounts/fireworks/routers/kimi-k2p6-turbo` | Fireworks | Complex reasoning, escalated tasks |
| **Perception** | `unified_vl` by default; structured fallback is provider-specific | Configured provider | Vision-based page understanding |

The `escalate` tool switches execution onto the planner tier when needed.
