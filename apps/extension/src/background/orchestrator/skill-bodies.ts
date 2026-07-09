/**
 * Skill execution bodies (procedures, evidence, failure recovery) keyed by skill id (RFC LP-16 — skills.ts landmine decomposition).
 *
 * Pure data extracted verbatim from skills.ts; the module re-imports it. Types
 * come from ./skill-types to avoid an import cycle.
 */

import type {
  LoadedSkillContract,
  SkillDescriptor,
} from "./skill-types";

export const SKILL_BODIES: Record<
  string,
  Omit<LoadedSkillContract, keyof SkillDescriptor>
> = {
  "chart-value-extraction": {
    procedureMarkdown: [
      "1. Identify the requested metric, category, series, or chart segment before interacting.",
      "2. Call inspect_chart to extract chart titles, series, labels, counts, percentages, data rows, and point values from structured chart state or SVG text.",
      "3. If inspect_chart returns the requested label and value, answer from that evidence without clicking or refreshing the chart.",
      "4. Keep the workflow read-only: do not click Run, Refresh, report edit, drilldown, export, filter, or navigation controls just to reveal data.",
      "5. If inspect_chart lacks the requested value, read_page and read_element only to locate accessible chart text or labels.",
      "6. Store the extracted value and its evidence in notes when the workflow has more than one step. If a later action asks for extra items so one quantity matches another final quantity, store both the final target quantity and the extra quantity difference.",
      "7. For single-value questions, call done with exactly one numeric value and the requested unit; do not include supporting counts, totals, axis ranges, dates, or chart timestamps in the final answer.",
      "8. For label-and-count questions, call done with exactly 'Label: count' using one numeric count; do not repeat the count or include percentages, totals, axis ranges, dates, or tie details.",
      "9. Call done only when the final answer contains the requested value and names the chart/category it came from while the report/dashboard remains in a stable view state.",
    ].join("\n"),
    requiredEvidence: [
      "The requested chart metric or category",
      "Structured chart/SVG/label evidence containing the requested count, percentage, or point value",
      "A concrete value in the final answer",
    ],
    commonFailures: [
      {
        signal:
          "scrolling or hovering repeatedly without reading chart structure",
        recovery:
          "call inspect_chart and target only the missing series or category",
      },
      {
        signal:
          "clicking chart/report controls changes the report URL or opens editor/drilldown state",
        recovery:
          "return to the stable report/dashboard view and extract from read-only chart/page evidence",
      },
      {
        signal: "ending after reaching the chart page without a value",
        recovery: "extract a concrete value before done()",
      },
      {
        signal:
          "final answer includes supporting numbers such as count, total, axis range, or timestamp for a single-value question",
        recovery:
          "answer again with only the requested numeric chart value and unit",
      },
    ],
    executionContract: {
      sequencing: [
        "Inspect chart data first, then use page reads only for missing labels or accessible chart text.",
      ],
      toolDiscipline: [
        "Prefer inspect_chart before any other chart investigation.",
        "For min-to-max quantity tasks, distinguish final_target_quantity from order_extra_quantity_to_raise_min_to_max; use the extra quantity for an order of additional items.",
        "Avoid click_element, navigate, hover_element, and click_coordinates for read-only chart value tasks unless recovery is required.",
      ],
      completionChecks: [
        "Final answer includes the requested chart value and source label, and the current page is still the report/dashboard view.",
        "For single-value questions, the final answer contains only one numeric value.",
      ],
    },
  },
  "search-answer-extraction": {
    procedureMarkdown: [
      "1. Clarify the exact fact requested by the user before searching.",
      "2. For knowledge-base answer tasks, call search_knowledge_base first with the exact question and distinctive search terms.",
      "3. For ServiceNow knowledge tasks, prefer the Knowledge Portal search/results surface over filtered classic admin lists unless the user explicitly asks to edit records.",
      "4. Read the search result snippets or titles and choose the result whose content is most likely to contain the requested fact, not simply the first result.",
      "5. For numeric-answer questions, prefer candidates whose snippets contain the requested entity plus a number or a strong count cue; if the opened result has no answer, return to grounded results and try the next candidate.",
      "6. Read the selected result content or snippet that contains the requested fact.",
      "7. Store the fact in notes if another navigation step is needed.",
      "8. If the opened result does not contain the requested fact, return to results and try the next grounded candidate.",
      "9. Call done only with the actual answer, not with a statement that a result was opened.",
    ].join("\n"),
    requiredEvidence: [
      "Search query or visible result used",
      "Result content containing the requested fact",
      "Final answer containing the requested fact",
    ],
    commonFailures: [
      {
        signal: "opening or reading a result without answering",
        recovery: "extract the requested fact and call done with the answer",
      },
    ],
    executionContract: {
      sequencing: [
        "Search, read ranked results, extract the fact, then answer.",
      ],
      toolDiscipline: [
        "Use search_knowledge_base before manual search field clicks for explicit knowledge-base answer questions.",
        "When search_knowledge_base returns an answer candidate with evidence, call done with only the requested answer unless the user asked for explanation.",
      ],
      completionChecks: [
        "The final answer contains the requested fact or states that it was not found after grounded search.",
      ],
    },
  },
  "list-filter-workflow": {
    procedureMarkdown: [
      "1. If the request contains explicit field/operator/value conditions, call apply_list_filter with the structured conditions and the requested AND/OR join as the first mutation.",
      "2. Use inspect_table and inspect_filter_state to identify current list columns, active filters, and filter controls before or after applying the structured filter.",
      "3. Open and manipulate the filter builder only when apply_list_filter is unavailable or reports unsupported fields.",
      "4. Run or apply the filter, then re-inspect table/filter state.",
      "5. Call done only when the applied condition or filtered URL/rows prove the filter ran.",
    ].join("\n"),
    requiredEvidence: [
      "Requested field/operator/value",
      "Applied filter condition or query state",
      "List refreshed or rows filtered after applying",
    ],
    commonFailures: [
      {
        signal: "filter builder is open but no condition exists",
        recovery: "set a field, operator, and value, then run the filter",
      },
    ],
    executionContract: {
      sequencing: [
        "Inspect current state, set condition, run filter, verify applied state.",
      ],
      toolDiscipline: [
        "Use apply_list_filter before filter-builder clicks for structured filter requests.",
        "Prefer inspect_filter_state over repeated find_element for filter internals.",
      ],
      completionChecks: [
        "A filter condition is applied and the list has refreshed.",
      ],
    },
  },
  "list-sort-workflow": {
    procedureMarkdown: [
      "1. If the request contains explicit sort fields and directions, call apply_list_sort with all ordered clauses as the first mutation.",
      "2. For multi-field requests, preserve the original request scope even if the current planner wording names only one header; include every requested sort field/direction in a single apply_list_sort call.",
      "3. Use inspect_table to identify columns, sort indicators, and URL query state before or after applying the structured sort.",
      "4. Use manual column-header or list-menu sorting only when apply_list_sort is unavailable or reports unsupported fields.",
      "5. Re-run inspect_table and verify a sort indicator, URL parameter, or changed row order.",
      "6. Call done only when the requested sort is evidenced.",
    ].join("\n"),
    requiredEvidence: [
      "Requested sort column and direction",
      "Sort indicator, URL state, or row-order evidence",
    ],
    commonFailures: [
      {
        signal: "scrolling the list without changing sort state",
        recovery:
          "use apply_list_sort with the requested fields and directions before trying manual headers",
      },
      {
        signal:
          "opening personalization or column configuration while trying to sort",
        recovery:
          "close the configuration surface and apply the sort as query/list state",
      },
    ],
    executionContract: {
      sequencing: ["Inspect table, apply sort, verify sort state."],
      toolDiscipline: [
        "Use apply_list_sort before column-header, personalization, or list-menu clicks for explicit sort requests.",
        "For multi-field sort requests, send one apply_list_sort call containing all requested clauses in order.",
      ],
      completionChecks: [
        "Every requested column and direction is visible in sort evidence.",
      ],
    },
  },
  "list-row-action-workflow": {
    procedureMarkdown: [
      "1. Use inspect_table to identify the exact visible row identifiers or unique row text for the target records.",
      "2. If the target rows are not uniquely visible, filter or inspect further before mutating the list.",
      "3. For actions that relate one row to another, such as marking a duplicate, select the row to change and pass the other record as relatedRecord with relatedField when known.",
      "4. Call apply_list_action with the exact target row identifiers and the requested selected-row action.",
      "5. Confirm the dialog only when it matches the requested action and any required reference field has been filled.",
      "6. Re-inspect the list or result state before calling done.",
    ].join("\n"),
    requiredEvidence: [
      "Exact target row identifiers",
      "Related/reference record when the action requires one",
      "Selected-row action applied",
      "Post-action list or status evidence",
    ],
    commonFailures: [
      {
        signal: "acting before the target rows are uniquely identified",
        recovery:
          "inspect or filter the list until each target row can be named exactly",
      },
      {
        signal: "opening row details instead of using the selected-row action",
        recovery:
          "return to the list, select the row checkbox, and apply the visible list action",
      },
    ],
    executionContract: {
      sequencing: [
        "Identify rows, apply selected-row action, confirm if appropriate, verify changed state.",
      ],
      toolDiscipline: [
        "Use apply_list_action after inspect_table identifies the target rows.",
        'For "mark duplicate" workflows, do not open the row manually; call apply_list_action with one duplicate row in records and the other duplicate row in relatedRecord.',
        "Do not use hidden selectors or guessed row IDs when the row is not visible.",
      ],
      completionChecks: [
        "The requested selected-row action ran on the intended rows and the list or status reflects the change.",
      ],
    },
  },
  "catalog-order-workflow": {
    procedureMarkdown: [
      "1. For ServiceNow module paths such as Reports > View/Run or Self-Service > Service Catalog, call open_servicenow_module before manual All-menu navigation.",
      "2. If the target item name and requested quantity/options are already known and the item detail page is open, call configure_catalog_item immediately; pass expectedItem and submit=true when the order/request control is expected on the page.",
      "3. Use inspect_catalog_item only when the item identity, quantity controls, options, price/summary, or order controls are still unknown.",
      "4. On a catalog item detail page, prefer configure_catalog_item to set requested quantity, dropdown/radio-like options, checkbox states, and text requirements in one verified action. When the requested item name is known, pass it as expectedItem so lookalike catalog items are refused before submit.",
      "5. If configure_catalog_item reports missing controls, fall back to manual controls for only the missing fields.",
      "6. Re-inspect catalog state to verify the configuration before submitting when the helper did not submit.",
      "7. After Add to Cart, inspect the cart/order state before checkout; if checkout controls are visible, do not configure or add the same item again.",
      "8. Click the appropriate order, cart, checkout, or request control, or set submit=true in configure_catalog_item when the order/request button is visible.",
      "9. Continue until a request/order/cart confirmation is visible, then verify the confirmed line count and quantity match the request before calling done.",
      "10. Treat an Order Status page with a REQ request number as the final confirmation page; do not click request, item, or RITM links from it just to inspect.",
      "11. Do not open requested-item/detail links just to inspect after a request is submitted; if you do, return to the request/order confirmation page before calling done.",
    ].join("\n"),
    requiredEvidence: [
      "Requested item and configuration",
      "Configured quantity/options before submission",
      "Request/order confirmation after submission",
    ],
    commonFailures: [
      {
        signal: "ending on the product detail page",
        recovery: "configure the requested options and submit/order the item",
      },
      {
        signal:
          "cart or confirmation shows duplicate line items or a quantity different from the request",
        recovery:
          "do not call done; edit the cart if possible or escalate with the mismatch evidence",
      },
    ],
    executionContract: {
      sequencing: [
        "Inspect item, configure requested options, verify configuration, submit, verify confirmation.",
      ],
      toolDiscipline: [
        "For named ServiceNow module navigation inside a catalog-order task, prefer open_servicenow_module before clicking All, typing into navigator search, or using global search.",
        "When ordering an item chosen from prior evidence such as a chart, carry forward the exact item name and pass it to configure_catalog_item as expectedItem.",
        "When the request says to order extra items so an existing quantity reaches a target, configure the extra difference quantity, not the final target quantity.",
        "Do not call read_page or inspect_catalog_item on a catalog detail page when the target item and quantity/options are already known; call configure_catalog_item instead.",
        "Use inspect_catalog_item after a page transition only when visible quantity/options/order controls are unknown or configure_catalog_item reports missing controls.",
        "Prefer configure_catalog_item over separate select_option, radio-option clicks, set_checkbox, type_text, and submit clicks when the requested configuration is explicit, including dropdown/select/radio-like values.",
        "Once the cart contains the requested item and Proceed to Checkout is visible, avoid Add to Cart and repeated configure_catalog_item calls for that same item.",
        "Once an Order Status page with a REQ number is visible, avoid clicking request/item links and call done from that confirmation page.",
      ],
      completionChecks: [
        "A request/order/cart confirmation exists after submission.",
        "The confirmed item line count and quantity match the user's request.",
        "The current page remains the request/order confirmation page, not a requested-item detail page.",
      ],
    },
  },
  "servicenow-module-navigation": {
    procedureMarkdown: [
      "1. Parse the requested ServiceNow application name and module path from the task.",
      "2. Call open_servicenow_module with the application when named and the path labels in order, ending with the target module.",
      "3. Treat ServiceNow home, global search, or Configuration Hub as intermediate states, not completion.",
      "4. If open_servicenow_module cannot resolve confidently, use its candidate diagnostics to choose the closest module or fall back to visible navigator controls.",
      "5. Call done only after the resolved module URL, title, list heading, or tool output proves the target module is open.",
    ].join("\n"),
    requiredEvidence: [
      "Requested ServiceNow application or module path",
      "Resolved module target URL or page evidence",
      "Current ServiceNow page matches the requested module",
    ],
    commonFailures: [
      {
        signal: "navigate(query=...) is blocked or opens external search",
        recovery:
          "call open_servicenow_module from the current ServiceNow origin instead",
      },
      {
        signal: "spending turns in ServiceNow home/global search",
        recovery:
          "extract the application and path labels and resolve the module directly",
      },
    ],
    executionContract: {
      sequencing: [
        "Resolve the module with open_servicenow_module, then verify the resulting ServiceNow page.",
      ],
      toolDiscipline: [
        "Prefer open_servicenow_module before manual navigator clicks or search text entry.",
        "Do not use navigate with query for ServiceNow module lookup.",
      ],
      completionChecks: [
        "The current page or tool output identifies the requested ServiceNow module target.",
      ],
      failureRecovery: [
        "Use candidate diagnostics from open_servicenow_module before falling back to UI navigation.",
      ],
    },
  },
  "hover-reveal-navigation": {
    procedureMarkdown: [
      "1. Read the current page and identify the reveal trigger plus the expected revealed content.",
      "2. Hover the trigger deliberately rather than clicking it immediately.",
      "3. Re-read or inspect the revealed area to confirm the menu, tooltip, or flyout actually appeared.",
      "4. Only after the revealed target is visible, click or read the intended item.",
      "5. If the reveal collapses while switching focus, re-ground and repeat the reveal instead of guessing.",
      "6. Store the revealed target or extracted value before moving to the next step.",
      "7. If the revealed value is an input to a later action, transition immediately into that action instead of re-reading the same revealed UI.",
    ].join("\n"),
    requiredEvidence: [
      "The trigger element used for the reveal",
      "Visible evidence that the hover-dependent UI appeared",
      "The revealed target or value read from the revealed UI",
      "Evidence that any downstream action using the revealed value was actually started or completed",
    ],
    commonFailures: [
      {
        signal: "clicking the trigger instead of hovering it first",
        recovery:
          "re-ground the page and use hover before attempting the revealed target",
      },
      {
        signal:
          "assuming the hover succeeded without verifying the revealed UI",
        recovery: "read the revealed area before the next action",
      },
      {
        signal:
          "continuing to inspect the revealed UI after the needed value is already known",
        recovery:
          "capture the value once, then move directly into the downstream action that depends on it",
      },
    ],
    executionContract: {
      sequencing: [
        "Reveal first, then verify the revealed UI, then act on the revealed target.",
        "Capture any revealed value before leaving the revealed area.",
      ],
      toolDiscipline: [
        "Prefer hover_element before click_element when the target depends on hover.",
        "Use read_page or read_element after the hover to prove the UI appeared.",
      ],
      completionChecks: [
        "The revealed UI is visibly present before any downstream click or read.",
        "Any downstream action that depended on the revealed target actually started or completed.",
      ],
      failureRecovery: [
        "If the reveal collapses, re-ground and repeat the reveal instead of guessing.",
      ],
    },
  },
  "budget-aware-execution": {
    procedureMarkdown: [
      "1. Pause and restate the smallest remaining success target.",
      "2. Stop exploratory actions that are not producing new evidence.",
      "3. Prefer one verification-rich action over multiple speculative actions.",
      "4. Batch reading and note-taking before the next mutation where possible.",
      "5. If the task cannot reasonably complete within the remaining budget, preserve the best partial state and report what remains.",
      "6. Treat the final turns as a controlled recovery window, not as a place for blind retries.",
    ].join("\n"),
    requiredEvidence: [
      "Clear evidence that the workflow is near budget exhaustion",
      "Most recent verified page state",
      "The exact remaining sub-goal",
    ],
    commonFailures: [
      {
        signal:
          "continuing exploratory behavior after repeated non-progressing turns",
        recovery:
          "consolidate facts, narrow the target, and stop blind retries",
      },
      {
        signal: "spending final turns without new information",
        recovery:
          "switch to conservation mode and report the smallest unresolved step",
      },
    ],
  },
  "transactional-act-check-act": {
    procedureMarkdown: [
      "1. Ground the current page and identify the target control and expected state transition.",
      "2. Resolve blockers such as modals or overlays before acting.",
      "3. Perform exactly one state-changing action.",
      "4. Re-ground the page immediately after that action.",
      "5. Verify the expected state transition occurred.",
      "6. Only after verification, perform the next action.",
    ].join("\n"),
    requiredEvidence: [
      "Pre-action page state",
      "Post-action page state",
      "Evidence that the expected transition occurred",
    ],
    commonFailures: [
      {
        signal: "multiple mutations before checking the first result",
        recovery: "pause and re-read page state before further action",
      },
      {
        signal: "continuing after click without confirming state change",
        recovery: "verify state transition before the next mutation",
      },
    ],
    executionContract: {
      sequencing: [
        "Ground current state before the mutation.",
        "Perform one state-changing action at a time.",
        "Re-ground immediately after the mutation before any follow-up action.",
      ],
      toolDiscipline: [
        "Do not chain multiple click_element or type_text mutations without an intervening read_page or read_element.",
      ],
      completionChecks: [
        "The expected post-action state is visible before continuing.",
        "Call done() only after the post-action state satisfies the step success criteria.",
      ],
      failureRecovery: [
        "If the post-action state is unclear, pause and re-read instead of issuing another mutation.",
      ],
    },
  },
  "cart-modify-checkout": {
    procedureMarkdown: [
      "1. If the requested item state is already visible in the cart, call done() instead of mutating the cart again.",
      "2. If the requested item is absent, close only the drawer or overlay that blocks the catalog, then locate the requested product/add control.",
      "3. When the requested product's Add-to-Cart control is visible, click it immediately; do not keep inspecting unrelated cart controls.",
      "4. Re-read the cart once after mutation and confirm the requested item, quantity, price, and any visible coupon state.",
      "5. Apply coupon only after cart contents are correct unless the site clearly requires the reverse order.",
      "6. Proceed to checkout only after cart contents and pricing state match the request.",
    ].join("\n"),
    requiredEvidence: [
      "Cart contents after modification",
      "Visible coupon or discount state",
      "Checkout readiness only when the current objective includes checkout",
    ],
    commonFailures: [
      {
        signal: "additive request treated as replacement",
        recovery:
          "keep existing requested items unless the user explicitly asked to remove or replace them",
      },
      {
        signal: "coupon applied before cart state stabilizes",
        recovery: "confirm cart contents first, then apply coupon",
      },
    ],
    executionContract: {
      sequencing: [
        "For additive item requests: verify existing cart state, click the requested product's add control if needed, then verify the cart state.",
      ],
      toolDiscipline: [
        "If an Add-to-Cart control for the requested product is visible, prefer that direct click over more cart open/close inspection.",
        "Do not click plus, minus, or remove controls for existing cart items unless the objective explicitly asks for a quantity change, removal, or replacement.",
        "Avoid checkout actions until the requested cart state is visible.",
      ],
      completionChecks: [
        "The requested item state and pricing state are visible before checkout.",
      ],
      failureRecovery: [
        "If the cart shows both old and new requested items for an additive order, preserve them and continue.",
      ],
    },
  },
  "email-reply-careful": {
    procedureMarkdown: [
      "1. Read the full visible email context before drafting: sender, recipient, subject, body, and any visible prior thread.",
      "2. Determine send intent: draft-only/no-send instructions mean leave a draft; otherwise reply/respond/confirm/accept/decline to a sender means send the reply.",
      "3. Extract a reply checklist: requested answer, date or time, owners, deliverables, agenda items, constraints, language, and tone.",
      "4. Draft in the same language and a matching register unless the user explicitly requests a different style.",
      "5. Include only facts grounded in the email, the user's request, or visible page context.",
      "6. Re-read or inspect the draft before sending; verify recipient, subject or thread, and all checklist items.",
      "7. Send when the user requested sending or asked to reply/respond/confirm/accept/decline to the sender. Otherwise leave the composed draft visible.",
      "8. After sending, re-ground on the resulting page and verify application feedback such as sent-mail navigation, the reply appearing in a message list/thread, a toast, or the composer clearing.",
    ].join("\n"),
    requiredEvidence: [
      "Source email context was read before composing",
      "Recipient and subject or thread were identified",
      "Reply checklist covering language, tone, facts, and requested commitments",
      "Draft content verified before send or completion",
      "Final state matches draft-only versus send intent",
      "Post-send feedback was checked when the reply was sent",
    ],
    commonFailures: [
      {
        signal: "reply is composed before reading the source email",
        recovery:
          "read the email and rebuild the reply checklist before editing the draft",
      },
      {
        signal:
          "reply changes language, tone, dates, owners, or commitments without support",
        recovery:
          "revise the draft against the source email and remove unsupported claims",
      },
      {
        signal: "send action is attempted when the task only asked for a draft",
        recovery: "leave the reply as a draft and do not click send",
      },
      {
        signal:
          "task asks to reply/respond/confirm to a sender but completion happens with only a draft",
        recovery:
          "verify the recipient and draft, then click the visible Send button",
      },
      {
        signal:
          "send was clicked but no sent/list/thread/toast feedback was checked",
        recovery:
          "read the resulting page and verify concrete send feedback before calling done",
      },
    ],
    executionContract: {
      sequencing: [
        "Read the email, extract the reply checklist, draft, verify the draft and recipient, then send when the user asked to reply/respond/confirm/accept/decline.",
      ],
      toolDiscipline: [
        "Use update_notes for compact reply requirements before typing when the email contains multiple constraints.",
        "Use read_page or read_element after drafting to verify the composed text before any send action.",
        "Avoid press_key shortcuts for sending communication.",
        "When sending was requested and the draft has been verified, use the visible Send button directly.",
        "After the send click, prefer read_page over repeated draft inspection to verify the new state.",
      ],
      completionChecks: [
        "The reply is addressed to the correct recipient or thread.",
        "The language and tone fit the source email and user's instruction.",
        "The reply covers requested dates, owners, deliverables, agenda items, or constraints.",
        "No unsupported facts or commitments were introduced.",
        "The final state is sent when reply/respond/confirm/send was requested; otherwise the draft remains visible.",
        "A sent/list/thread/toast/composer-cleared feedback state is visible after send.",
      ],
      failureRecovery: [
        "If recipient or send permission is uncertain, do not send; clarify or leave a draft.",
        "If context is missing, re-read the email or visible thread before composing further.",
      ],
    },
  },
  "thread-message-careful": {
    procedureMarkdown: [
      "1. Read the visible thread or conversation before composing, including participants, recent messages, and the active channel or thread label.",
      "2. Identify the intended audience and whether the reply belongs in a thread, channel, direct message, or comment box.",
      "3. Extract a message checklist: question to answer, owners, deadlines, deliverables, blockers, decisions, language, and tone.",
      "4. Compose a concise reply that fits the conversation's language, tone, and level of formality unless the user requests otherwise.",
      "5. Preserve responsibilities and constraints exactly; do not assign owners, deadlines, or next steps that are not grounded.",
      "6. Re-read the composer content and visible target before posting.",
      "7. Post only when the target thread and audience are verified.",
      "8. After posting, re-ground and verify feedback such as the new message in the thread, composer clearing, list update, or a visible toast.",
    ].join("\n"),
    requiredEvidence: [
      "Thread or conversation context was read before composing",
      "Target channel, thread, or recipient was identified",
      "Checklist of question, owners, deadlines, deliverables, blockers, language, and tone",
      "Composed message verified before posting",
      "Visible evidence that the message was posted to the intended target, or left as draft if not posting",
    ],
    commonFailures: [
      {
        signal:
          "message answers the user request but not the thread's actual question",
        recovery:
          "re-read the latest relevant messages and revise around the unresolved question",
      },
      {
        signal: "message is posted to the wrong channel, thread, or recipient",
        recovery:
          "stop further posting, re-ground on the intended thread, and report uncertainty if it cannot be repaired",
      },
      {
        signal:
          "reply changes language or formality in a way that clashes with the thread",
        recovery:
          "revise to match the observed thread language and tone unless the user requested a different style",
      },
      {
        signal:
          "post was clicked but no new-message, list, toast, or composer-cleared feedback was checked",
        recovery:
          "read the resulting thread state and verify the post landed before calling done",
      },
    ],
    executionContract: {
      sequencing: [
        "Read the thread, identify the target and audience, extract the message checklist, draft, verify, then post.",
      ],
      toolDiscipline: [
        "Use update_notes for compact thread facts when several messages must be synthesized.",
        "Use read_page or read_element after composing to verify the active target and message text.",
        "Avoid coordinate clicks and send shortcuts when posting communication.",
        "When sending was requested and the draft has been verified, use the visible Send/Post button directly instead of Enter or coordinate clicks.",
        "After posting, prefer read_page over repeated composer inspection to verify the new state.",
      ],
      completionChecks: [
        "The reply is in the correct thread, channel, or recipient context.",
        "The reply matches the conversation's language, tone, and audience.",
        "The reply preserves owners, deadlines, deliverables, blockers, and open questions.",
        "No unsupported promises or decisions were introduced.",
        "A new-message, list-update, toast, or composer-cleared feedback state is visible after posting.",
      ],
      failureRecovery: [
        "If the target thread is uncertain, do not post; re-ground or clarify.",
        "If the conversation is too noisy, summarize observed facts in notes before drafting.",
      ],
    },
  },
  "crm-ticket-update": {
    procedureMarkdown: [
      "1. Read the ticket or case context before changing anything: requester, issue, customer impact, account context, current status, priority, and existing activity.",
      "2. Extract the requested record changes, such as status, priority, assignee, category, tags, escalation, and internal note content.",
      "3. If escalation is requested, use a visible escalation field when present; otherwise treat priority as the escalation-equivalent field and set it to Urgent when the impact supports escalation.",
      "4. For native selects, use select_option directly. For custom dropdowns, click to reveal options, click the exact option, then re-read the field label/value before moving on.",
      "5. Update only fields that are requested or directly supported by visible ticket context.",
      "6. Add an internal note grounded in the issue, impact, account context, and next step when those details are available.",
      "7. Save or submit changes using the page's normal controls.",
      "8. Re-read the ticket state after saving and verify field values and note visibility.",
    ].join("\n"),
    requiredEvidence: [
      "Ticket context and current properties were read before mutation",
      "Requested field changes were identified",
      "Internal note content is grounded in visible ticket facts",
      "Post-save ticket state verifies the requested field values",
      "Activity or note area confirms the note was added internally when requested",
    ],
    commonFailures: [
      {
        signal:
          "status or priority is changed without reading the ticket issue",
        recovery:
          "re-read ticket context and correct fields before saving further changes",
      },
      {
        signal:
          "internal note is generic or omits available impact/account/next-step context",
        recovery: "revise the note using visible ticket facts before posting",
      },
      {
        signal: "escalation was requested but only status was changed",
        recovery:
          "look for escalation, priority, severity, or SLA fields; if priority is the available control, set it to Urgent when justified by customer impact",
      },
      {
        signal:
          "status or priority dropdown was opened but the selected value was not verified",
        recovery:
          "re-read the field label/value after choosing the option and before saving",
      },
      {
        signal: "unrequested ticket fields are modified",
        recovery:
          "restore unrelated fields when possible and limit changes to the requested scope",
      },
    ],
    executionContract: {
      sequencing: [
        "Read ticket context, decide whether escalation is justified, update escalation-equivalent fields, add grounded note, save, then verify.",
      ],
      toolDiscipline: [
        "Use read_page or read_element before and after field mutations.",
        "Prefer select_option for native selects; use click_element for custom dropdowns only after the option list is visible.",
        "Use update_notes for the intended field and note checklist when multiple fields are involved.",
        "Avoid done until both field state and note state have been checked after save.",
      ],
      completionChecks: [
        "Requested status, priority, assignee, category, tag, or escalation state is visible; escalation requests require a visible escalation-equivalent field change.",
        "Internal note content reflects the issue, impact, account context, and next step when available.",
        "No unrelated ticket fields were changed.",
      ],
      failureRecovery: [
        "If save status is unclear, re-read activity and field panels before taking another action.",
        "If a note might have been posted as a public reply instead of internal note, stop and report uncertainty rather than posting again.",
      ],
    },
  },
  "structured-form-fill": {
    procedureMarkdown: [
      "1. Identify all relevant fields before typing.",
      "2. If the user references Profile Notes, a Profile Digest, or explicit profile fields, call get_profile_fields for exact needed facts before navigating away or inventing values.",
      "3. Map each requested value to a specific input, select, or checkbox.",
      "4. Prefer returned profile facts as the source of truth for name, email, and address fields; unresolved fields must be reported instead of guessed.",
      "5. Stay on the current form unless the page itself shows that login or authentication is required.",
      "6. For independent visible text, select, and checkbox fields that are already mapped, issue those field tools in the same tool-calling turn; submit later as a separate final action.",
      "7. Preserve quoted literals exactly, including punctuation, pipes, slashes, spacing, and long command strings.",
      '8. For textarea or long literal fields, verify the live value with read_element(attribute="value") or read_page evidence before submission.',
      "9. Re-check required fields and validation messages before submission.",
      "10. For product configurators or option forms, re-read the derived total, price, or summary after option changes before submission or completion.",
      "11. Submit only when all requested values are present and no obvious validation blocker remains.",
      "12. If submission returns same-page validation errors, re-read the current page, repair only the fields named by the validation feedback, verify the repaired values, then submit again with fresh element ids.",
    ].join("\n"),
    requiredEvidence: [
      "Field mapping for requested values",
      "Visible form state before submission",
      "Post-submit success or validation state",
      "Derived price, total, or summary state for configurator-style forms",
    ],
    commonFailures: [
      {
        signal: "pressing Enter too early",
        recovery: "continue field mapping and submit only at the end",
      },
      {
        signal: "wrong value in wrong field",
        recovery: "re-read labels and verify mapping before resubmitting",
      },
      {
        signal: "same-page validation errors remain after submit",
        recovery:
          "repair the named fields from current validation feedback, re-ground on the page, and resubmit with current element ids",
      },
    ],
    executionContract: {
      sequencing: [
        "Map fields before typing.",
        "Fill values field-by-field.",
        "Submit only after the full required set is present.",
        "Treat same-page validation feedback as part of the current form workflow until it is repaired or proven impossible.",
      ],
      toolDiscipline: [
        "Use get_profile_fields for exact Profile Digest facts when the task calls for them.",
        "Batch independent type_text, select_option, and set_checkbox calls in one executor turn after field mapping; re-ground once before submit instead of re-reading between every field.",
        "Avoid press_key submit shortcuts until field mapping and validation checks are complete.",
        'Use read_element(attribute="value") for filled textareas or long exact literals when read_page evidence is ambiguous.',
        'Use upload_file for input type="file" controls; do not click the file input or type a local path into it.',
        "For configurators, use read_page after option changes to verify the derived total or summary.",
        "After validation feedback changes the page, use read_page or read_element before reusing submit or field element ids.",
      ],
      completionChecks: [
        "All requested values are visibly present in the intended fields.",
        "Any derived total, price, or summary reflects the selected options when relevant.",
        "No obvious validation blocker remains before submit.",
        "After submit, a success state is visible when the user requested submission.",
        "Visible validation errors are repaired before done unless they make the task impossible.",
      ],
      failureRecovery: [
        "If a value lands in the wrong field, re-read labels and repair the mapping before resubmitting.",
        "If submission fires too early, return to the remaining fields and finish the mapping before trying again.",
        "If submit returns validation errors on the same page, correct the named values using current page state and submit again.",
      ],
    },
  },
  "progressive-repeatable-form": {
    procedureMarkdown: [
      "1. Identify the repeatable group name, the required item count, and the current visible item count.",
      "2. If the task references Profile Digest data for repeated rows, call get_profile_fields once for the exact labels before filling.",
      "3. Stay on the current form page; do not navigate to profile, workspace, account, or site-navigation pages to look for saved values.",
      "4. Add only the missing number of groups; after each Add another/Add item action, use fresh page state before reusing element ids.",
      "5. Bind each data item to its matching visible group by label or index, such as Experience 2 company, rather than by raw field order.",
      "6. Fill all visible fields for each group from the mapped data, preserving row order and copying profile strings exactly unless the user specifies another ordering or transformation.",
      "7. Verify the final group count, each group label/index, and each filled value by readback or visible page state. Long text fields must match the source profile text, not a paraphrase.",
      "8. Do not click final Submit/Send/Apply controls unless the current step explicitly asks for that final action and consent policy allows it.",
    ].join("\n"),
    requiredEvidence: [
      "Repeatable group name and required count",
      "Current count before adding and final count after adding",
      "Field/value mapping for each repeated group",
      "Readback evidence that each group contains its intended exact values",
      "Final submit state when a submit control exists",
    ],
    commonFailures: [
      {
        signal: "old Add button id is reused after a group appears",
        recovery:
          "call read_page and use the current Add control id before adding the next group",
      },
      {
        signal: "values are shifted into the wrong repeated group",
        recovery:
          "re-read labels such as item number, row heading, or aria-label and repair by group index",
      },
      {
        signal: "the final submit action is clicked during preparation",
        recovery:
          "stop after the requested groups are prepared and report ready state without submitting",
      },
    ],
    executionContract: {
      sequencing: [
        "Count existing groups, add only missing groups with fresh grounding after each mutation, map data by group index, fill fields, then verify the completed group set.",
      ],
      toolDiscipline: [
        "Use get_profile_fields once for exact repeated profile facts when needed.",
        "Treat profile values as literals: copy exact strings for text fields and do not summarize, embellish, or replace them with plausible alternatives.",
        "Do not navigate away from the form to find profile data; the profile tool and current Profile Digest context are the source of truth.",
        "Use read_page after Add another/Add item clicks before reusing the add control or filling newly inserted fields.",
        "Prefer labeled field ids or aria labels over positional guesses.",
        "Avoid press_key and click_coordinates for form progression or final submit.",
      ],
      completionChecks: [
        "The requested number of groups is visible.",
        "Each group label or index matches the intended data row.",
        "Each requested field value is present in the intended group and text values match the source profile strings exactly.",
        "No final submit action has been taken unless explicitly requested and approved.",
      ],
      failureRecovery: [
        "If the add control disappears or changes id, re-ground with read_page before continuing.",
        "If the page has fewer groups than requested after an add click, retry only after verifying current count.",
        "If group mapping is ambiguous, read group headings and labels before typing further.",
      ],
    },
  },
  "multi-step-form-wizard": {
    procedureMarkdown: [
      "1. Identify the current step, the visible required fields, and the final requested outcome.",
      "2. Fill only fields visible on the current step, preserving explicit user values exactly.",
      "3. Before clicking Next/Continue, verify the current step has no obvious missing required values or validation blockers.",
      "4. After every Next/Continue/Back transition, call read_page or otherwise re-ground before using element ids from the prior step.",
      "5. When a select, radio, checkbox, or toggle reveals conditional fields, fill those newly visible requirements before advancing.",
      "6. On review steps, compare the visible summary against the requested values before final submission.",
      "7. Submit only after the review or confirmation control is intentionally handled and the task asks for submission.",
    ].join("\n"),
    requiredEvidence: [
      "Current step and visible required fields",
      "Filled values on each step before advancement",
      "Conditional fields revealed by earlier choices",
      "Review-step summary before final submit",
      "Post-submit success or validation state",
    ],
    commonFailures: [
      {
        signal:
          "Next is clicked before conditional fields appear or are filled",
        recovery:
          "re-read the current step, fill the newly visible required fields, then continue",
      },
      {
        signal: "an element id from a prior step is reused after navigation",
        recovery:
          "re-ground on the current step and use current labels or ids before acting",
      },
      {
        signal: "review data does not match the requested values",
        recovery:
          "go back to the relevant step, repair the field, then return to review",
      },
    ],
    executionContract: {
      sequencing: [
        "Ground current step, fill visible fields, verify step readiness, advance, re-ground, handle conditional fields, review, then submit only when requested.",
      ],
      toolDiscipline: [
        "Use read_page after each step transition before reusing element ids.",
        "Use select_option and set_checkbox for option controls instead of keyboard shortcuts.",
        "Avoid press_key and click_coordinates for wizard progression and submit.",
        'Use read_element(attribute="value") for long text fields when visible readback is ambiguous.',
      ],
      completionChecks: [
        "Each requested value appears in the intended field or review summary.",
        "Conditional fields required by chosen options are completed.",
        "The review step is confirmed before final submission.",
        "After submit, success or concrete validation feedback is visible.",
      ],
      failureRecovery: [
        "If advancement fails, inspect validation messages and fill the missing visible field before retrying.",
        "If a conditional field was missed, return to the triggering step and complete it before submitting.",
      ],
    },
  },
  "servicenow-record-form": {
    procedureMarkdown: [
      "1. Parse the requested ServiceNow field/value pairs exactly, preserving quoted literals and empty values.",
      "2. Use configure_servicenow_form with the full requested field set before manual input tools.",
      "3. Treat the helper's configured/readback rows as the source of truth for form-fill completion.",
      "4. Do not submit while any requested field reports a mismatch or missing field.",
      "5. Submit by calling configure_servicenow_form with submit=true after all requested fields are verified; then verify a record detail, reset-to-next-record signal, or confirmation.",
      "6. If the helper reports missing fields, re-ground the form/module and retry once with corrected labels before falling back manually.",
      "7. If a requested field is still absent after helper readback plus bounded page/hidden-field search, do not submit a partial record; answer that the task is infeasible and name the missing field.",
    ].join("\n"),
    requiredEvidence: [
      "Requested field/value mapping",
      "ServiceNow form helper readback for every requested field",
      "Submit click evidence",
      "Created/updated record, confirmation, or reset-to-next-record evidence",
    ],
    commonFailures: [
      {
        signal: "broad continuation skill selected for a field/value form",
        recovery:
          "reroute to servicenow-record-form and configure fields through the ServiceNow form helper",
      },
      {
        signal: "form reset advances to the next blank record",
        recovery:
          "use the submitted record number from the pre-submit form state as validation evidence",
      },
      {
        signal: "field lives in a hidden tab or section",
        recovery:
          "set and verify it through g_form/readback instead of searching visible controls",
      },
    ],
    executionContract: {
      sequencing: [
        "Map fields, configure and read back all requested values, submit, then verify the submitted record state.",
      ],
      toolDiscipline: [
        "Prefer configure_servicenow_form over separate type_text, select_option, and tab clicks for ServiceNow record forms.",
        "For ServiceNow submit steps, use configure_servicenow_form with submit=true instead of raw button clicks.",
        "Use manual controls only for fields the helper reports as missing or mismatched.",
        "Do not use press_key as a submit shortcut.",
      ],
      completionChecks: [
        "Every requested field has helper readback evidence matching the requested value.",
        "The submit action happened after successful readback.",
        "The current page or trace evidence identifies the created/updated ServiceNow record or confirmation.",
      ],
      failureRecovery: [
        "If reference lookup fails, re-read the helper mismatch and retry with the visible display value from the prompt.",
        "If validation errors appear after submit, repair the named fields and submit once more.",
        "If the requested field does not exist on the record form after bounded search, stop and report the missing field as the reason instead of cycling.",
      ],
    },
  },
  "consequential-action-consent": {
    procedureMarkdown: [
      "1. Identify whether the task includes a consequential final action: submit, send, publish, buy, place order, delete, confirm, or approve.",
      "2. Determine the user's consent mode from the request: explicit go-ahead, prepare-only, forbidden, or unclear.",
      "3. If consent is unclear, ask the user whether final actions should be executed automatically or held for approval.",
      "4. Continue safe preparation: read context, fill drafts or forms, configure options, and collect verification evidence.",
      "5. Before any consequential final action, summarize what will happen and wait for approval when the user requested approval or the policy is unclear.",
      "6. Do not use test fixture wording, hidden selectors, or benchmark-specific assumptions to decide consent.",
      "7. After an approved final action, verify real page feedback such as confirmation, sent state, published item, order receipt, or deleted/changed state.",
    ].join("\n"),
    requiredEvidence: [
      "The consequential action type and target",
      "The user's consent mode or explicit approval request",
      "Prepared state before final action",
      "Post-action confirmation when execution is approved",
    ],
    commonFailures: [
      {
        signal: "final action is available but user consent is unclear",
        recovery:
          "ask a clarification or approval question instead of clicking the final action",
      },
      {
        signal: "task was prepare-only but the agent tries to submit",
        recovery:
          "stop after preparation, summarize ready state, and request approval",
      },
    ],
    executionContract: {
      sequencing: [
        "Classify consent mode, prepare safely, verify ready state, then request approval before final action when required.",
      ],
      toolDiscipline: [
        "Use clarify when the user's final-action policy is unclear.",
        "Avoid press_key shortcuts for final submit/send/publish/buy/delete actions.",
        "Prefer tagged click targets over coordinates for approval-gated final actions.",
      ],
      completionChecks: [
        "The final action was either approved and verified, or intentionally stopped pending approval.",
        "The final answer states whether the consequential action was executed or is waiting for approval.",
      ],
      failureRecovery: [
        "If approval is denied or absent, report the prepared state without executing the final action.",
        "If the final target is ambiguous, re-ground and ask which target should receive the action.",
      ],
    },
  },
  "job-application-assistant": {
    procedureMarkdown: [
      "1. Identify the job, role, company, and application page before filling fields.",
      "2. Read visible requirements and required fields; do not infer personal, legal, salary, sponsorship, availability, or eligibility answers that the user did not provide.",
      "3. Use the user's request, saved profile evidence, and visible page context for grounded application context.",
      "4. Fill fields only from the user's request, saved profile evidence, or visible page context.",
      "5. Preserve user-supplied prose answers verbatim, including paragraph breaks, sentence grouping, punctuation, and spacing unless the user explicitly asks for rewriting.",
      "6. Treat question-like application labels such as why you care about a company as form fields, not as instructions to produce a report or recommendation.",
      "7. When the user supplies a field/value table or long application answer, keep the whole application fill as one workflow and preserve the original request as the source of truth.",
      "8. Use update_notes to track missing user-supplied values and fields that are ready.",
      "9. Re-read the application before final submission and verify the visible values or attached resume/CV state.",
      '10. For textarea or long literal answers, verify the live value with read_element(attribute="value") before reporting ready state.',
      "11. Stop before the final Submit/Send/Apply action unless the user has approved that exact final submission.",
      "12. If approval is needed, summarize the target job and what will be submitted before requesting approval.",
      "13. After approved submission, verify confirmation, application received state, or equivalent page feedback.",
    ].join("\n"),
    requiredEvidence: [
      "Target job/application identity",
      "Field/value mapping from user request, saved profile, or page context",
      "Application ready-state before final submit",
      "User approval or confirmation evidence before final submit",
      "Post-submit confirmation if executed",
    ],
    commonFailures: [
      {
        signal: "guessing personal or eligibility answers",
        recovery:
          "leave the field unchanged and ask the user for the missing value or policy",
      },
      {
        signal: "clicking Submit/Apply as soon as the form looks filled",
        recovery:
          "re-read the prepared application and request approval before final submit",
      },
    ],
    executionContract: {
      sequencing: [
        "Identify job, map fields, fill known values, verify ready state, request approval, then submit only after approval.",
      ],
      toolDiscipline: [
        "Use read_page and read_element to verify required fields and final submit target.",
        "Use profile fields only as source evidence, then verify every value on the live page before treating it as done.",
        "Use type_text/select_option/set_checkbox for explicit values only.",
        "Paste long user-supplied application answers as exact literals; do not rewrap them into bullets or one sentence per line.",
        'Use upload_file with a provided file URL when the user asks to attach a CV or resume.',
        "Avoid press_key and click_coordinates for final application submission.",
      ],
      completionChecks: [
        "All known requested fields are filled or missing values are surfaced.",
        "Long textarea answers match the user-supplied source text instead of a rewritten or reformatted version.",
        "The final submit action is either waiting for approval or was approved and verified.",
        "The final answer clearly states submitted vs ready-for-approval.",
      ],
      failureRecovery: [
        "If the application page shows validation errors, report the exact missing fields and do not submit.",
        "If the submit target is ambiguous, ask for confirmation before proceeding.",
      ],
    },
  },
  "ashby-job-application-assistant": {
    procedureMarkdown: [
      "1. Confirm the current page is an Ashby job application, usually from jobs.ashbyhq.com, Ashby page title text, or a visible Submit Application control.",
      "2. Identify the role and company from the page title or header, then map every requested value to the visible Ashby field label before typing.",
      "3. Use the user's request, saved profile evidence, and visible Ashby page context for grounded answers.",
      "4. Treat Ashby prompts and labels, including question-style labels such as why the user cares about the company, as form fields to fill; do not answer them as a separate report task.",
      "5. Fill all user-supplied fields in one application workflow when possible, especially field/value tables and follow-up requests for remaining fields.",
      "6. Preserve user-supplied long-form answers verbatim, including paragraph breaks, sentence grouping, punctuation, and spacing.",
      '7. Verify text inputs and textareas with read_element(attribute="value"); verify radio/select choices from live selected state or visible selected styling.',
      '8. For resume/CV uploads, use upload_file with the provided file, then verify the displayed attachment filename.',
      "9. Never click Submit Application unless the user explicitly approved that exact final submission. If the task says do not send/submit, stop at ready state.",
      "10. Report only the prepared/submitted state and missing fields; do not add fit analysis or best-match comparisons unless the user explicitly requested that report.",
    ].join("\n"),
    requiredEvidence: [
      "Ashby application identity and target role/company",
      "Requested field/value mapping from user request or saved profile",
      "Live readback for typed inputs and long textareas",
      "Radio/select state evidence for eligibility or work-permit answers",
      "Attachment filename evidence when a resume/CV is requested",
      "Submit Application approval or explicit prepare-only instruction",
    ],
    commonFailures: [
      {
        signal: "turning an Ashby question label into a final analysis report",
        recovery:
          "return to the application field mapping and fill the requested literal answer instead",
      },
      {
        signal:
          "long textarea answer has been reformatted into one sentence per line",
        recovery:
          "clear the field, paste the exact source answer, and verify the value attribute",
      },
      {
        signal:
          "the final Submit Application button is visible but approval is absent",
        recovery:
          "stop and report ready-for-approval state without clicking Submit Application",
      },
    ],
    executionContract: {
      sequencing: [
        "Confirm Ashby page, map requested fields, fill explicit values, verify readback, verify ready state, then submit only after explicit approval.",
      ],
      toolDiscipline: [
        "Use read_page/read_element to verify Ashby field labels and values before done.",
        "Use profile values as source evidence only; page readback remains the execution truth.",
        "Use type_text for literal text values and textareas; do not summarize, rewrite, bulletize, or sentence-wrap supplied answers.",
        "Use click_element or set_checkbox for radio-style Yes/No choices, then verify selected state.",
        "Use upload_file for Ashby resume/CV controls only when the user supplied a file or requested saved CV use.",
        "Avoid press_key and click_coordinates for Submit Application.",
      ],
      completionChecks: [
        "Every requested Ashby field is filled exactly or listed as missing.",
        "Long textarea values match the user-supplied source text exactly.",
        "Submit Application was not clicked unless explicitly approved.",
        "Final answer states ready-for-review, waiting-for-approval, submitted, or blocked by missing fields.",
      ],
      failureRecovery: [
        "If Ashby validation names missing fields, fill only values supplied by the user/profile and report the rest as missing.",
        "If the field label is ambiguous, read nearby labels/help text and ask for clarification instead of guessing.",
      ],
    },
  },
  "inline-edit-surface": {
    procedureMarkdown: [
      "1. Identify the exact editable surface that must change: the target grid cell, table row, filename, or inline field.",
      "2. Focus the target directly with a tagged click instead of using coordinates when possible.",
      "3. Enter edit mode if needed, typically with Enter or a second focused click.",
      "4. Type the replacement value into the active inline editor.",
      "5. Commit the edit explicitly, for example with Enter, Tab, or the page's apply/rename control.",
      "6. Re-read the page and verify the committed value is visible in the non-editing surface.",
      "7. If an inline editor is still visible, the task is not done yet. Commit or apply the edit first.",
      "8. If the requested value is visible in the non-editing surface and no inline editor is active, call done() immediately instead of re-opening or probing the cell.",
    ].join("\n"),
    requiredEvidence: [
      "The target editable surface identified before editing",
      "The replacement value entered into the active inline editor",
      "Visible evidence that the edit was committed",
      "The committed value shown in the non-editing page state",
    ],
    commonFailures: [
      {
        signal: "typing into an inline editor but never committing the change",
        recovery:
          "commit explicitly with Enter, Tab, or the page's apply action before calling done",
      },
      {
        signal:
          "falling back to coordinate clicks while tagged targets are still available",
        recovery:
          "re-ground the page and use the tagged cell, row, or rename target directly",
      },
      {
        signal: "calling done while the editor input is still active",
        recovery:
          "commit the edit, then verify the value is visible in the committed page state",
      },
    ],
    executionContract: {
      sequencing: [
        "Focus the editable surface, enter edit mode, type the replacement, commit the edit, then verify the committed value.",
      ],
      toolDiscipline: [
        "Prefer click_element, press_key, and type_text over click_coordinates for inline editors.",
        "Use read_page or read_element after committing the edit to verify the non-editing state.",
        "After the committed non-editing state is verified, call done() instead of clicking or finding the edited value again.",
      ],
      completionChecks: [
        "The requested replacement value is visible in the committed page state.",
        "The inline editor is no longer active when done() is called.",
      ],
      failureRecovery: [
        "If the editor is still active, commit it explicitly instead of exploring elsewhere.",
        "If the target is lost, re-find the editable surface by text or row label rather than using coordinates first.",
      ],
    },
  },
  "continuation-edit": {
    procedureMarkdown: [
      "1. Re-ground on the current artifact and the user's requested change.",
      "2. Identify the current artifact being revised.",
      "3. Read the existing content before editing.",
      "4. Preserve prior requirements unless the user explicitly replaces them.",
      "5. Apply the requested delta in place when possible.",
      "6. Verify the requested change is present and no stable prior constraint was lost unintentionally.",
    ].join("\n"),
    requiredEvidence: [
      "Current artifact contents and visible context",
      "Artifact contents before editing",
      "Artifact contents after editing",
    ],
    commonFailures: [
      {
        signal: "overwriting stable prior constraints",
        recovery:
          "re-read the current artifact and apply only the requested delta",
      },
      {
        signal: "re-drafting from scratch instead of revising",
        recovery: "edit the existing artifact in place where possible",
      },
    ],
    executionContract: {
      sequencing: [
        "Read the current workspace context and artifact, then apply only the requested delta.",
      ],
      completionChecks: [
        "The requested change is present.",
        "Stable prior constraints are still preserved unless explicitly replaced.",
      ],
      failureRecovery: [
        "If the draft drifts, re-anchor on the prior artifact and re-apply only the requested delta.",
      ],
    },
  },
  "cross-tab-compare": {
    procedureMarkdown: [
      "1. Identify every comparison target up front.",
      "2. Visit each target and collect the requested facts before drawing conclusions.",
      "3. Normalize observations into notes using stable labels.",
      "4. Compare only after all required facts are gathered.",
      "5. If one target cannot be read, report partial completion rather than inventing a comparison.",
    ].join("\n"),
    requiredEvidence: [
      "Fact set for each comparison target",
      "Normalized labels for each fact",
      "Final comparison based on gathered evidence",
    ],
    commonFailures: [
      {
        signal: "comparing after reading only one target",
        recovery: "gather the remaining target facts before synthesizing",
      },
      {
        signal: "losing facts while switching tabs",
        recovery: "store normalized notes before leaving the tab",
      },
    ],
    executionContract: {
      sequencing: [
        "Collect evidence for every comparison target before synthesizing.",
        "Normalize findings into notes before switching away from a target.",
      ],
      toolDiscipline: [
        "Prefer read_page, read_element, switch_tab, and update_notes over early done().",
      ],
      completionChecks: [
        "Each comparison target has a fact set.",
        "The final comparison cites only gathered evidence.",
      ],
      failureRecovery: [
        "If one target is still unread, continue collecting instead of synthesizing early.",
      ],
    },
  },
  "modal-overlay-recovery": {
    procedureMarkdown: [
      "1. Read the page and identify ALL visible overlays, banners, and modals. Count them and note their close/dismiss/accept buttons.",
      "2. Dismiss the topmost overlay by clicking its close, dismiss, accept, or X button directly with click_element. Do NOT use dismiss_overlays — it hides elements visually but does not trigger application state changes, so overlays may reappear or remain functional.",
      "3. After each click, re-read the page immediately to confirm the overlay is actually gone (not just hidden).",
      "4. Repeat steps 2-3 for each remaining overlay. Handle them one at a time — do not batch.",
      "5. Only after ALL overlays are confirmed gone via re-read, proceed to the underlying task or call done.",
      "6. If an overlay reappears after dismissal, try press_key Escape, then re-read. If still present, find and click another dismiss target.",
    ].join("\n"),
    requiredEvidence: [
      "Count of overlays detected on initial page read",
      "Confirmation that each overlay was dismissed via re-read",
      "Final page state showing no blocking overlays remain",
    ],
    commonFailures: [
      {
        signal: "calling done after dismissing only one of multiple overlays",
        recovery:
          "re-read the page and dismiss remaining overlays before calling done",
      },
      {
        signal: "clicking stale element IDs after an overlay is removed",
        recovery:
          "re-read the page to get fresh element tags after each dismissal",
      },
      {
        signal:
          "assuming dismiss_overlays handled all overlays without re-reading",
        recovery:
          "always re-read after dismiss_overlays to verify and detect remaining overlays",
      },
    ],
    executionContract: {
      sequencing: [
        "Dismiss one overlay, re-read, then move to the next overlay.",
        "Do not return to the underlying task until all blocking overlays are gone.",
      ],
      toolDiscipline: [
        "Prefer click_element on the actual dismiss control over dismiss_overlays.",
        "Use done immediately after read_page or inspection confirms no blocking overlays remain.",
      ],
      completionChecks: [
        "Initial overlay count is known.",
        "Each dismissal is confirmed by a re-read.",
        "Final page state shows no blocking overlays remain.",
        "A no-match read_page or inspect_hidden check for overlay terms is sufficient final evidence.",
      ],
      failureRecovery: [
        "If an overlay remains, find a fresh dismiss target or use Escape, then re-read again.",
      ],
    },
  },
  "navigate-read-return": {
    procedureMarkdown: [
      "1. Record the current page URL and any relevant context before navigating away.",
      "2. Navigate to the target page using the most direct path available.",
      "3. Read the target page and extract the specific information needed.",
      "4. Store the extracted fact in notes before navigating back.",
      "5. Navigate back to the original page using go_back or direct navigation.",
      "6. Verify the return landed on the expected origin page.",
      "7. Continue the workflow using the extracted fact.",
    ].join("\n"),
    requiredEvidence: [
      "The origin page URL recorded before navigation",
      "The target page reached and the specific fact extracted",
      "Evidence that the fact was stored before returning",
      "The origin page verified after return",
    ],
    commonFailures: [
      {
        signal: "navigating back without capturing the needed fact first",
        recovery:
          "store the extracted fact in notes before leaving the target page",
      },
      {
        signal:
          "forgetting to verify the return page matches the expected origin",
        recovery:
          "read the page after returning and confirm the URL or content matches",
      },
      {
        signal:
          "over-decomposing the round trip into too many intermediate steps",
        recovery:
          "combine navigate and read into a bounded step where possible",
      },
    ],
    executionContract: {
      sequencing: [
        "Record the origin, navigate to the target, extract the fact, store it, then return and verify the origin.",
      ],
      toolDiscipline: [
        "Use update_notes before leaving the target page if the fact will be needed after return.",
      ],
      completionChecks: [
        "The target fact is captured before returning.",
        "The return page matches the expected origin.",
      ],
      failureRecovery: [
        "If the return lands on the wrong page, re-ground and restore the original context before proceeding.",
      ],
    },
  },
  "multi-tab-checklist-workflow": {
    procedureMarkdown: [
      "1. Start on the source list or checklist tab and identify the next requested item to process.",
      "2. Capture the item label, target link/page, requested action, and any constraints before leaving the source tab.",
      "3. Open or reuse the matching target page in another tab and switch into that tab directly.",
      "4. Complete the target-tab work for only that source item: purchase, review, extract, compare, or capture the requested evidence.",
      "5. Store compact completion facts in notes before leaving the target tab.",
      "6. Switch back to the original source tab and mark or record only that completed item before moving on.",
      "7. Repeat the bounded loop for the next requested source item.",
      "8. Call done only after every requested source item has target-tab evidence and the source page reflects the required progress.",
    ].join("\n"),
    requiredEvidence: [
      "The source list or checklist item identifying the target page and requested action",
      "Evidence that the matching target page was opened or reused in another tab",
      "Target-tab evidence for each completed item",
      "Evidence that the source item was marked, recorded, or otherwise accounted for after returning",
    ],
    commonFailures: [
      {
        signal:
          "browsing unrelated target pages after the requested item evidence is already visible",
        recovery:
          "complete the requested item immediately and stop exploratory tab opening",
      },
      {
        signal:
          "returning to the source list before target-tab evidence exists",
        recovery:
          "stay on the target tab until the item work is visibly complete or the requested evidence is captured, then return",
      },
      {
        signal:
          "using browser-history navigation between source and target tabs",
        recovery:
          "use create_tab and switch_tab so the source list tab remains stable",
      },
    ],
    executionContract: {
      sequencing: [
        "Read the source item, open or reuse the matching target page in another tab, complete or extract the target work, switch back, then mark or record the source item.",
        "Do not start the next item until the current item is either confirmed complete, recorded with evidence, or explicitly blocked.",
      ],
      toolDiscipline: [
        "Prefer create_tab and switch_tab over browser-history navigation.",
        "Reuse the known source tab and created target-tab IDs instead of repeatedly rediscovering tabs when they are already known.",
        "Prefer visible target-work controls or content over exploratory reads once the correct target page is on screen.",
        "Treat a source completion counter, reviewed marker, or row-complete state as stronger evidence than hidden attribute inspection.",
        "Use update_notes only for compact completion facts such as item, target page, extracted fact, or confirmation number.",
      ],
      completionChecks: [
        "Target-tab evidence exists before leaving the target tab.",
        "The corresponding source item is visibly marked, recorded, or accounted for after returning to the source tab.",
      ],
      failureRecovery: [
        "If the wrong target tab is active, switch back to the source tab, re-read the item, and open or switch to the correct target page.",
        "If target evidence is unclear, re-read the current target page instead of opening a new path.",
      ],
    },
  },
  "paginated-table-scan": {
    procedureMarkdown: [
      "1. Read the visible table or list page and identify the pagination state: visible row range, total rows, current page, page count, and next/previous controls when present.",
      "2. Extract the aggregate-relevant value from every visible row on the current page and record the current best candidate with the row identity and value.",
      "3. Update notes with compact scan state: seen row ranges or page numbers, total rows or pages when known, current best candidate, and the next missing range or page.",
      "4. Move sequentially with the page's visible Next control or the next visible page-number button to cover missing rows. Use Previous only when you intentionally need to recover a missed earlier page.",
      "5. After each page change, re-read the page once, merge the visible rows into the scan state, and update notes before moving again.",
      "6. Do not inspect pagination buttons with read_element, and do not jump to non-sequential page-number buttons such as 1 or 10 during normal scans; use only the next missing page number when Next is absent or fails to advance.",
      "7. Do not call done until the notes prove exhaustive coverage of the requested data scope and the final answer is tied to the strongest observed row evidence.",
    ].join("\n"),
    requiredEvidence: [
      "Pagination range or page-count evidence for the table or list",
      "Rows or pages already scanned",
      "Current aggregate candidate with row identity and value",
      "Evidence that all rows or pages in scope were covered before the final answer",
    ],
    commonFailures: [
      {
        signal:
          "answering from the first visible page when pagination shows more rows exist",
        recovery:
          "reject the answer, update notes with the visible range, and continue to the next unscanned page",
      },
      {
        signal:
          "using find_element to search for a page number or value in a paginated table",
        recovery:
          "use the visible Next control or the next sequential page-number button and update notes with the covered range",
      },
      {
        signal:
          "losing the current best candidate after a replan or page change",
        recovery:
          "restore the candidate and seen ranges from notes before continuing the scan",
      },
    ],
    executionContract: {
      sequencing: [
        "Read page, extract visible row values, update notes, then paginate to the next missing range.",
        "Keep a single compact aggregate record in notes across every page transition.",
        "Synthesize the final answer only after coverage is exhaustive.",
      ],
      toolDiscipline: [
        "Prefer read_page for each page of rows.",
        "Prefer click_element on the visible Next control or next sequential page-number button for forward scans.",
        "Avoid read_element, find_element, scroll_page, inspect_hidden, xray_page, execute_js, click_coordinates, tab tools, and non-sequential page-number jumps during normal table scans.",
      ],
      completionChecks: [
        "Seen ranges or pages cover the table total when the total is visible.",
        "If the total is not visible, both start and end boundaries are verified by disabled or absent previous/next controls.",
        "The final answer includes the winning row identity and aggregate value.",
      ],
      failureRecovery: [
        "If a page change does not advance the visible range, re-read once and then switch between Next and the next sequential page-number button instead of reversing or jumping.",
        "If pagination state is uncertain, update notes with the uncertainty and re-ground instead of answering.",
      ],
    },
  },
  "paginated-record-lookup": {
    procedureMarkdown: [
      "1. Read the current data surface and identify the target record identity plus the requested field or fact.",
      "2. Prefer a visible search, filter, or table search input for named records, IDs, post numbers, tickets, or employee names.",
      "3. If search/filter is available, enter the exact target text and re-read the results before opening or extracting anything.",
      "4. If no search/filter exists, use the visible Next control for explicit pagination or scroll_page for scroll-loaded feeds, then update notes with searched page numbers, ranges, or result counts.",
      "5. Stop only when the exact target row/item is visible, then extract the requested field from that same row or its detail view.",
      "6. If the target is not found after all visible pages/ranges are covered, report that directly instead of using a near match.",
      "7. Do not switch to aggregate scanning unless the user asks for highest, lowest, largest, smallest, or another all-row aggregate.",
    ].join("\n"),
    requiredEvidence: [
      "Target record identity and requested field or fact",
      "Search/filter attempt or searched pagination ranges",
      "Exact target row or item identity before extraction",
      "Extracted field tied to the verified target record",
    ],
    commonFailures: [
      {
        signal:
          "answering from a similar row without verifying the exact target identity",
        recovery:
          "re-read the visible row labels and continue searching until the exact target is visible",
      },
      {
        signal:
          "clicking page numbers or pagination controls repeatedly without tracking coverage",
        recovery:
          "use the visible Next control sequentially and update notes with searched ranges",
      },
      {
        signal: "manual pagination begins while a search/filter box is visible",
        recovery:
          "use the search/filter control first for the exact target text",
      },
    ],
    executionContract: {
      sequencing: [
        "Identify the target, search/filter if available, otherwise paginate sequentially, then extract from the verified row.",
        "Track searched pages or ranges in notes before moving past them.",
      ],
      toolDiscipline: [
        "Prefer read_page for result state and find_element/type_text for visible search controls.",
        "Prefer click_element on the visible Next control when manual pagination is required.",
        "Prefer scroll_page over press_key for lazy-loaded feeds or long result lists without a visible Next control.",
        "Avoid read_element, press_key, inspect_hidden, xray_page, execute_js, click_coordinates, tab tools, and early done during normal lookup.",
      ],
      completionChecks: [
        "The target identity is visible and exact before the answer is produced.",
        "The requested field or fact is read from the target record, not from a neighboring row.",
        "If not found, searched ranges or result state explain why.",
      ],
      failureRecovery: [
        "If pagination or scrolling does not advance, re-read once, then use the next available forward control or scroll_page direction before reporting uncertainty.",
        "If search results are empty, clear or adjust only the target text once before falling back to sequential pagination.",
      ],
    },
  },
  "list-detail-review-loop": {
    procedureMarkdown: [
      "1. Start on the visible list page and enumerate the requested review set once: item names, order, and the action that opens each detail view.",
      "2. Store the compact review checklist in notes before opening details, including which items are pending and which are reviewed.",
      "3. Open the next pending item directly. If the list already shows a tagged action such as View Details or Open, click it instead of reading button attributes or re-finding it.",
      "4. Once the detail view is open, use one read_page call to capture the requested facts from the detail page.",
      "5. Store only the essential facts in notes before returning. For fit or recommendation tasks, include the item name plus the facts that affect the ranking.",
      "6. Return to the list with the page's own back, return, or listings control, then verify the list is visible again.",
      "7. Continue with the next pending item from the checklist; do not reopen items already marked reviewed.",
      "8. Call done only after every requested item in the loop has been reviewed, the list has been restored for the final time, and any requested recommendation is grounded in the captured notes.",
    ].join("\n"),
    requiredEvidence: [
      "The requested list items were opened from the list view",
      "Facts extracted from each detail page",
      "Evidence that notes were updated before leaving a detail view",
      "The list view restored after each return",
      "For recommendation tasks, a final ranking or shortlist tied to the captured item facts",
    ],
    commonFailures: [
      {
        signal:
          "reading or inspecting list buttons instead of clicking visible tagged actions",
        recovery:
          "use the tagged View Details or Open button directly when it is already visible",
      },
      {
        signal: "remaining on the detail page after capturing the needed facts",
        recovery:
          "use the page's own back or return control immediately once the required facts are stored",
      },
      {
        signal:
          "re-reading the full list page between every item without using the visible next action",
        recovery:
          "continue directly to the next tagged list action when the list is already visible",
      },
      {
        signal:
          "the same list item is opened more than once without new user intent",
        recovery:
          "restore the checklist from notes and move to the next pending item",
      },
    ],
    executionContract: {
      sequencing: [
        "Open the next list item, read the detail page once, store the required fact, return to the list, then continue to the next item.",
        "For recommendation tasks, repeat the loop across the visible candidate set before synthesizing the final answer.",
        "Maintain reviewed and pending item names in notes so coverage is explicit.",
      ],
      toolDiscipline: [
        "Prefer click_element over read_element for visible list-entry actions.",
        "Prefer the list's own back or return control over browser-history go_back when returning from a detail view.",
        "Use update_notes only for compact extracted facts, not for rephrasing the whole page.",
        "Avoid re-reading already reviewed details unless the prior evidence is missing or contradictory.",
      ],
      completionChecks: [
        "Each requested item in the current loop segment has been opened and reviewed.",
        "The list page is visible again before the step is considered complete.",
        "The notes identify which items were reviewed and which item-level facts support the answer.",
        "Recommendations are based on reviewed item facts rather than list-page guesses.",
      ],
      failureRecovery: [
        "If the list is not visible after returning, re-ground and restore the list before continuing.",
        "If the next requested list item is off-screen, scroll to reveal it instead of re-reading unrelated content.",
      ],
    },
  },
};
