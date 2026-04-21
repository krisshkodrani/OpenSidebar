import { ToolName } from "../../types";

export interface SkillDescriptor {
  id: string;
  name: string;
  description: string;
  tags: string[];
  triggers: string[];
  maturity: "draft" | "candidate" | "active";
  preferredTools?: string[];
  discouragedTools?: string[];
  memoryScope?: "turn" | "workspace";
  verifierMode: "deterministic" | "hybrid" | "llm";
  notes?: string[];
}

export interface SkillToolPolicy {
  preferredTools: ToolName[];
  discouragedTools: ToolName[];
}

export interface SkillToolSuppressionPolicy {
  temporarilySuppressedTools: ToolName[];
  exemptTools: ToolName[];
}

export interface SkillSelection {
  id: string;
  reason: string;
}

export interface SkillExecutionContract {
  sequencing?: string[];
  toolDiscipline?: string[];
  completionChecks?: string[];
  failureRecovery?: string[];
}

export interface LoadedSkillContract extends SkillDescriptor {
  procedureMarkdown: string;
  requiredEvidence?: string[];
  commonFailures?: Array<{
    signal: string;
    recovery: string;
  }>;
  executionContract?: SkillExecutionContract;
}

const SKILL_CATALOG: SkillDescriptor[] = [
  {
    id: "hover-reveal-navigation",
    name: "Hover Reveal Navigation",
    description:
      "Expose hover-dependent menus or hidden targets with an explicit hover, verify, then act sequence.",
    tags: ["workflow", "hover", "navigation", "reveal"],
    triggers: [
      "hover menus",
      "dropdown appears on hover",
      "hidden target must be revealed before click",
    ],
    maturity: "candidate",
    preferredTools: [
      "read_page",
      "hover_element",
      "click_element",
      "read_element",
      "update_notes",
    ],
    discouragedTools: ["done"],
    memoryScope: "turn",
    verifierMode: "hybrid",
    notes: [
      "Do not assume hover succeeded just because the pointer moved.",
      "Verify revealed content before clicking into it.",
    ],
  },
  {
    id: "budget-aware-execution",
    name: "Budget Aware Execution",
    description:
      "Shift into a conservation mode when the workflow is at risk of exhausting turn budget before completion.",
    tags: ["workflow", "budget", "planning", "verification"],
    triggers: [
      "remaining turns are low",
      "hover or exploratory workflow is eating budget",
      "must avoid max-turns waste",
    ],
    maturity: "candidate",
    preferredTools: [
      "read_page",
      "read_element",
      "update_notes",
      "click_element",
    ],
    discouragedTools: ["done"],
    memoryScope: "turn",
    verifierMode: "hybrid",
    notes: [
      "Prefer consolidation over exploration.",
      "Surface partial progress rather than burning the final turns on blind retries.",
    ],
  },
  {
    id: "transactional-act-check-act",
    name: "Transactional Act Check Act",
    description:
      "Execute a state-changing action, verify the page state, then continue with fresh grounding.",
    tags: ["workflow", "transactional", "verification", "mutation"],
    triggers: [
      "act then verify then continue",
      "inspect before mutating",
      "confirm-gated workflow",
    ],
    maturity: "candidate",
    preferredTools: [
      "read_page",
      "read_element",
      "click_element",
      "type_text",
      "dismiss_overlays",
      "update_notes",
    ],
    discouragedTools: ["done"],
    memoryScope: "turn",
    verifierMode: "hybrid",
    notes: [
      "Prefer sequential execution.",
      "Require fresh grounding after mutation.",
    ],
  },
  {
    id: "cart-modify-checkout",
    name: "Cart Modify Checkout",
    description:
      "Modify an existing cart state, verify the result, then apply incentives and proceed to checkout safely.",
    tags: ["workflow", "shopping", "cart", "checkout"],
    triggers: [
      "swap item in cart",
      "replace product and keep cart state",
      "apply coupon and checkout",
    ],
    maturity: "candidate",
    preferredTools: [
      "read_page",
      "find_element",
      "click_element",
      "type_text",
      "read_element",
      "update_notes",
    ],
    memoryScope: "turn",
    verifierMode: "hybrid",
    notes: ["Read cart state before and after mutation."],
  },
  {
    id: "structured-form-fill",
    name: "Structured Form Fill",
    description:
      "Fill a multi-field form with explicit field mapping and submit-last discipline.",
    tags: ["workflow", "forms", "data-entry"],
    triggers: [
      "fill form",
      "multi-field data entry",
      "choose values then submit",
    ],
    maturity: "candidate",
    preferredTools: [
      "read_page",
      "type_text",
      "select_option",
      "set_checkbox",
      "click_element",
    ],
    discouragedTools: ["press_key"],
    memoryScope: "turn",
    verifierMode: "deterministic",
    notes: ["Map values to fields before typing."],
  },
  {
    id: "inline-edit-surface",
    name: "Inline Edit Surface",
    description:
      "Edit a value directly inside a grid cell, table row, inline rename field, or other in-place editor, then commit and verify the change.",
    tags: ["workflow", "editing", "inline-edit", "grid", "rename"],
    triggers: [
      "edit spreadsheet cell",
      "rename inline",
      "update table cell value",
      "change a value in place",
    ],
    maturity: "candidate",
    preferredTools: [
      "click_element",
      "press_key",
      "type_text",
      "read_page",
      "read_element",
      "find_element",
    ],
    discouragedTools: ["click_coordinates", "done"],
    memoryScope: "turn",
    verifierMode: "deterministic",
    notes: [
      "Commit the edit before calling done.",
      "Prefer tagged targets over coordinate clicks for inline editors.",
    ],
  },
  {
    id: "continuation-edit",
    name: "Continuation Edit",
    description:
      "Revise prior work in the same workspace while preserving stable prior constraints unless explicitly overridden.",
    tags: ["workflow", "continuation", "editing", "memory"],
    triggers: [
      "change previous draft",
      "revise prior answer",
      "continue previous task",
    ],
    maturity: "candidate",
    preferredTools: ["read_page", "update_notes", "type_text"],
    discouragedTools: ["navigate"],
    memoryScope: "workspace",
    verifierMode: "hybrid",
    notes: ["Apply the requested delta, not a full rewrite unless necessary."],
  },
  {
    id: "cross-tab-compare",
    name: "Cross Tab Compare",
    description:
      "Collect facts from multiple tabs or pages, normalize them, then compare after evidence is gathered.",
    tags: ["workflow", "comparison", "tabs", "memory"],
    triggers: [
      "compare tabs",
      "compare page 1 and page N",
      "compare overview and reports",
    ],
    maturity: "candidate",
    preferredTools: ["read_page", "switch_tab", "read_element", "update_notes"],
    discouragedTools: ["navigate", "go_back", "click_coordinates", "done"],
    memoryScope: "workspace",
    verifierMode: "deterministic",
    notes: ["Gather all required facts before synthesizing."],
  },
  {
    id: "modal-overlay-recovery",
    name: "Modal Overlay Recovery",
    description:
      "Detect and dismiss blocking overlays one at a time by clicking their close buttons, re-grounding after each dismissal before proceeding.",
    tags: ["workflow", "modal", "overlay", "popup", "banner", "recovery"],
    triggers: [
      "close popup",
      "dismiss modal",
      "cookie banner",
      "newsletter popup",
      "blocking overlay",
    ],
    maturity: "candidate",
    preferredTools: [
      "read_page",
      "click_element",
      "press_key",
      "read_element",
    ],
    discouragedTools: ["done", "navigate", "type_text", "dismiss_overlays"],
    memoryScope: "turn",
    verifierMode: "hybrid",
    notes: [
      "Click the overlay's close/dismiss/accept/X button directly — do not use dismiss_overlays.",
      "Dismiss one overlay at a time, re-read after each to verify it is gone.",
      "Do not call done until ALL blocking overlays are confirmed gone.",
    ],
  },
  {
    id: "navigate-read-return",
    name: "Navigate Read Return",
    description:
      "Navigate to a target page, extract the needed information, then return to the original page to continue.",
    tags: ["workflow", "navigation", "lookup", "round-trip"],
    triggers: [
      "go to page and come back",
      "look up information then return",
      "find details on another page",
      "check job listing and return",
      "round-trip lookup",
    ],
    maturity: "candidate",
    preferredTools: [
      "read_page",
      "navigate",
      "go_back",
      "click_element",
      "read_element",
      "update_notes",
    ],
    discouragedTools: ["done"],
    memoryScope: "turn",
    verifierMode: "hybrid",
    notes: [
      "Capture the needed fact before navigating away from the target page.",
      "Verify the return landed on the expected origin page before continuing.",
    ],
  },
  {
    id: "multi-tab-procurement-loop",
    name: "Multi-Tab Procurement Loop",
    description:
      "Work through a checklist that requires opening store pages in new tabs, completing a purchase, returning to the source tab, and marking the completed item before repeating.",
    tags: ["workflow", "procurement", "tabs", "shopping", "checklist"],
    triggers: [
      "procurement list",
      "open each store in a new tab",
      "purchase the item then check it off",
      "buy from multiple stores and return to the list",
    ],
    maturity: "candidate",
    preferredTools: [
      "read_page",
      "create_tab",
      "switch_tab",
      "click_element",
      "type_text",
      "set_checkbox",
      "update_notes",
    ],
    discouragedTools: ["navigate", "go_back", "click_coordinates", "done"],
    memoryScope: "workspace",
    verifierMode: "hybrid",
    notes: [
      "Use the checklist row as the source of truth for the target item, store, and quantity.",
      "Return to the source checklist tab only after the purchase is actually confirmed.",
      "If the checklist counter increases after marking the row complete, treat that as authoritative completion evidence instead of probing checkbox internals.",
    ],
  },
  {
    id: "list-detail-review-loop",
    name: "List Detail Review Loop",
    description:
      "Review a series of visible list items by opening each detail view, capturing the requested facts, and returning to the list before continuing.",
    tags: ["workflow", "list", "detail", "review", "round-trip"],
    triggers: [
      "review all listings",
      "open each item and come back",
      "read each detail page then return to the list",
      "review job listings one by one",
    ],
    maturity: "candidate",
    preferredTools: [
      "click_element",
      "read_page",
      "update_notes",
      "scroll_page",
      "find_element",
    ],
    discouragedTools: ["read_element", "navigate", "go_back", "done"],
    memoryScope: "turn",
    verifierMode: "hybrid",
    notes: [
      "When a tagged list action is already visible, click it directly instead of inspecting its attributes.",
      "Use one detail-page read to extract the facts, then return to the list immediately.",
      "Prefer the page's own back or return control over browser history when the detail view appears in-place.",
    ],
  },
];

const SKILL_BODIES: Record<string, Omit<LoadedSkillContract, keyof SkillDescriptor>> = {
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
        recovery: "re-ground the page and use hover before attempting the revealed target",
      },
      {
        signal: "assuming the hover succeeded without verifying the revealed UI",
        recovery: "read the revealed area before the next action",
      },
      {
        signal: "continuing to inspect the revealed UI after the needed value is already known",
        recovery: "capture the value once, then move directly into the downstream action that depends on it",
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
        signal: "continuing exploratory behavior after repeated non-progressing turns",
        recovery: "consolidate facts, narrow the target, and stop blind retries",
      },
      {
        signal: "spending final turns without new information",
        recovery: "switch to conservation mode and report the smallest unresolved step",
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
      "1. Read current cart contents before making changes.",
      "2. Record item, quantity, price, and any visible coupon state.",
      "3. Perform the minimum mutation needed to reach the requested cart state.",
      "4. Re-read the cart and confirm the requested item is present and the old item is removed or replaced.",
      "5. Apply coupon only after cart contents are correct unless the site clearly requires the reverse order.",
      "6. Proceed to checkout only after cart contents and pricing state match the request.",
    ].join("\n"),
    requiredEvidence: [
      "Cart contents before modification",
      "Cart contents after modification",
      "Visible coupon or discount state",
      "Checkout readiness",
    ],
    commonFailures: [
      {
        signal: "new item added without removing old item",
        recovery: "re-read cart and correct the cart state before checkout",
      },
      {
        signal: "coupon applied before cart state stabilizes",
        recovery: "confirm cart contents first, then apply coupon",
      },
    ],
    executionContract: {
      sequencing: [
        "Read the cart before mutation, mutate the cart, verify the new cart state, then proceed to coupon or checkout.",
      ],
      toolDiscipline: [
        "Avoid checkout actions until the requested cart state is visible.",
      ],
      completionChecks: [
        "The requested item state and pricing state are visible before checkout.",
      ],
      failureRecovery: [
        "If the cart shows both old and new items, repair the cart before any checkout action.",
      ],
    },
  },
  "structured-form-fill": {
    procedureMarkdown: [
      "1. Identify all relevant fields before typing.",
      "2. If the user references a saved profile or explicit profile field paths, call get_profile_fields for the exact needed fields before navigating away or inventing values.",
      "3. Map each requested value to a specific input, select, or checkbox.",
      "4. Prefer the returned profile values as the source of truth for name, email, and address fields.",
      "5. Stay on the current form unless the page itself shows that login or authentication is required.",
      "6. Fill fields one by one without submitting early.",
      "7. Re-check required fields and validation messages before submission.",
      "8. Submit only when all requested values are present and no obvious validation blocker remains.",
    ].join("\n"),
    requiredEvidence: [
      "Field mapping for requested values",
      "Visible form state before submission",
      "Post-submit success or validation state",
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
    ],
    executionContract: {
      sequencing: [
        "Map fields before typing.",
        "Fill values field-by-field.",
        "Submit only after the full required set is present.",
      ],
      toolDiscipline: [
        "Use get_profile_fields for exact saved-profile values when the task calls for them.",
        "Avoid press_key submit shortcuts until field mapping and validation checks are complete.",
      ],
      completionChecks: [
        "All requested values are visibly present in the intended fields.",
        "No obvious validation blocker remains before submit.",
        "After submit, either a success state or a concrete validation state is visible.",
      ],
      failureRecovery: [
        "If a value lands in the wrong field, re-read labels and repair the mapping before resubmitting.",
        "If submission fires too early, return to the remaining fields and finish the mapping before trying again.",
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
        recovery: "commit explicitly with Enter, Tab, or the page's apply action before calling done",
      },
      {
        signal: "falling back to coordinate clicks while tagged targets are still available",
        recovery: "re-ground the page and use the tagged cell, row, or rename target directly",
      },
      {
        signal: "calling done while the editor input is still active",
        recovery: "commit the edit, then verify the value is visible in the committed page state",
      },
    ],
    executionContract: {
      sequencing: [
        "Focus the editable surface, enter edit mode, type the replacement, commit the edit, then verify the committed value.",
      ],
      toolDiscipline: [
        "Prefer click_element, press_key, and type_text over click_coordinates for inline editors.",
        "Use read_page or read_element after committing the edit to verify the non-editing state.",
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
      "1. Load relevant workspace turn memory.",
      "2. Identify the current artifact being revised.",
      "3. Read the existing content before editing.",
      "4. Preserve prior requirements unless the user explicitly replaces them.",
      "5. Apply the requested delta in place when possible.",
      "6. Verify the requested change is present and no stable prior constraint was lost unintentionally.",
    ].join("\n"),
    requiredEvidence: [
      "Relevant prior-turn memory",
      "Artifact contents before editing",
      "Artifact contents after editing",
    ],
    commonFailures: [
      {
        signal: "overwriting stable prior constraints",
        recovery: "re-read prior-turn memory and apply only the requested delta",
      },
      {
        signal: "re-drafting from scratch instead of revising",
        recovery: "edit the existing artifact in place where possible",
      },
    ],
    executionContract: {
      sequencing: [
        "Read prior workspace context, read the current artifact, then apply only the requested delta.",
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
        recovery: "re-read the page and dismiss remaining overlays before calling done",
      },
      {
        signal: "clicking stale element IDs after an overlay is removed",
        recovery: "re-read the page to get fresh element tags after each dismissal",
      },
      {
        signal: "assuming dismiss_overlays handled all overlays without re-reading",
        recovery: "always re-read after dismiss_overlays to verify and detect remaining overlays",
      },
    ],
    executionContract: {
      sequencing: [
        "Dismiss one overlay, re-read, then move to the next overlay.",
        "Do not return to the underlying task until all blocking overlays are gone.",
      ],
      toolDiscipline: [
        "Prefer click_element on the actual dismiss control over dismiss_overlays.",
      ],
      completionChecks: [
        "Initial overlay count is known.",
        "Each dismissal is confirmed by a re-read.",
        "Final page state shows no blocking overlays remain.",
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
        recovery: "store the extracted fact in notes before leaving the target page",
      },
      {
        signal: "forgetting to verify the return page matches the expected origin",
        recovery: "read the page after returning and confirm the URL or content matches",
      },
      {
        signal: "over-decomposing the round trip into too many intermediate steps",
        recovery: "combine navigate and read into a bounded step where possible",
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
  "multi-tab-procurement-loop": {
    procedureMarkdown: [
      "1. Start on the checklist tab and identify the next requested row to fulfill.",
      "2. Capture the target item, store, quantity, and any budget constraint from that row before leaving it.",
      "3. Open the matching store page in a new tab and switch into that tab directly.",
      "4. On the store page, buy only the requested item and quantity instead of browsing unrelated products.",
      "5. As soon as the purchase is confirmed, store the essential completion facts in notes before leaving the store tab.",
      "6. Switch back to the original checklist tab and mark only the completed row as done.",
      "7. Repeat the same bounded loop for the next requested row.",
      "8. Call done only after every requested checklist row is marked complete on the source page.",
    ].join("\n"),
    requiredEvidence: [
      "The checklist row identifying the requested item and store",
      "Evidence that the matching store page was opened in a new tab",
      "Visible order or purchase confirmation for each completed item",
      "Evidence that the completed checklist row was marked done after returning",
    ],
    commonFailures: [
      {
        signal: "browsing or comparing unrelated products after the target item is already visible",
        recovery: "buy the requested item immediately and stop exploratory shopping behavior",
      },
      {
        signal: "returning to the checklist before purchase confirmation exists",
        recovery: "stay on the store tab until the purchase is visibly confirmed, then return",
      },
      {
        signal: "using browser-history navigation between source and store tabs",
        recovery: "use create_tab and switch_tab so the source checklist tab remains stable",
      },
    ],
    executionContract: {
      sequencing: [
        "Read the checklist row, open the matching store in a new tab, complete the purchase, switch back, then mark the row done.",
        "Do not start the next row until the current row is either confirmed complete or explicitly blocked.",
      ],
      toolDiscipline: [
        "Prefer create_tab and switch_tab over browser-history navigation.",
        "Reuse the known checklist tab and created store-tab IDs instead of repeatedly rediscovering tabs when they are already known.",
        "Prefer visible purchase controls over exploratory reads once the correct product is on screen.",
        "Treat a checklist completion counter or row-complete state as stronger evidence than checkbox attribute inspection.",
        "Use update_notes only for compact completion facts such as item, store, and order number.",
      ],
      completionChecks: [
        "A visible order or purchase confirmation exists before leaving the store tab.",
        "The corresponding checklist row is visibly marked complete after returning to the source tab.",
      ],
      failureRecovery: [
        "If the wrong store tab is active, switch back to the checklist tab, re-read the target row, and reopen the correct store.",
        "If the purchase confirmation is unclear, re-read the current store page instead of opening a new path.",
      ],
    },
  },
  "list-detail-review-loop": {
    procedureMarkdown: [
      "1. Start on the visible list page and identify the next requested item in sequence.",
      "2. If the list already shows a tagged action such as View Details or Open, click it directly instead of reading button attributes or re-finding it.",
      "3. Once the detail view is open, use one read_page call to capture the requested facts from the detail page.",
      "4. Store only the essential facts in notes before returning.",
      "5. Return to the list with the page's own back, return, or listings control, then verify the list is visible again.",
      "6. Continue immediately with the next requested list item instead of re-reading the whole list page when the next tagged action is already visible.",
      "7. Call done only after every requested item in the loop has been reviewed and the list has been restored for the final time.",
    ].join("\n"),
    requiredEvidence: [
      "The requested list items were opened from the list view",
      "Facts extracted from each detail page",
      "Evidence that notes were updated before leaving a detail view",
      "The list view restored after each return",
    ],
    commonFailures: [
      {
        signal: "reading or inspecting list buttons instead of clicking visible tagged actions",
        recovery: "use the tagged View Details or Open button directly when it is already visible",
      },
      {
        signal: "remaining on the detail page after capturing the needed facts",
        recovery: "use the page's own back or return control immediately once the required facts are stored",
      },
      {
        signal: "re-reading the full list page between every item without using the visible next action",
        recovery: "continue directly to the next tagged list action when the list is already visible",
      },
    ],
    executionContract: {
      sequencing: [
        "Open the next list item, read the detail page once, store the required fact, return to the list, then continue to the next item.",
      ],
      toolDiscipline: [
        "Prefer click_element over read_element for visible list-entry actions.",
        "Prefer the list's own back or return control over browser-history go_back when returning from a detail view.",
        "Use update_notes only for compact extracted facts, not for rephrasing the whole page.",
      ],
      completionChecks: [
        "Each requested item in the current loop segment has been opened and reviewed.",
        "The list page is visible again before the step is considered complete.",
      ],
      failureRecovery: [
        "If the list is not visible after returning, re-ground and restore the list before continuing.",
        "If the next requested list item is off-screen, scroll to reveal it instead of re-reading unrelated content.",
      ],
    },
  },
};

const comparePattern =
  /\b(compare|based on both|across both|which (?:is|looks) strongest|highest on page|last page|both tabs?|overview|reports?)\b/i;
const hoverRevealPattern =
  /\b(hover|hover over|tooltip|flyout|dropdown|drop-down|reveal menu|products menu|under the .* menu)\b/i;
const budgetPattern =
  /\b(turn budget|remaining turns|max turns|max_turns|turn limit|budget exhaustion|conservation mode)\b/i;
const continuationPattern =
  /\b(change|revise|rewrite|edit|one more change|previous draft|draft reply|continue previous task|make (?:it|the tone)|reply|casual)\b/i;
const continuationArtifactPattern =
  /\b(draft|reply|tone|email|message|copy|text|wording|paragraph|sentence)\b/i;
const gridEditPattern =
  /\b(spreadsheet|grid|cell|row|column|sheet|table)\b/i;
const inlineEditPattern =
  /\b(rename|inline edit|inline rename|change .* value|update .* value|replace .* value|edit .* cell|rename .* to|filename|file name|document name|table cell|grid cell)\b/i;
const cartPattern =
  /\b(cart|checkout|coupon|promo|discount|swap|replace|remove|add to cart)\b/i;
const formPattern =
  /\b(form|fill|input|field|dropdown|checkbox|select|budget|category|submit)\b/i;
const profileFieldPattern =
  /\b(saved profile|profile field|profile data|identity\.(?:first_name|last_name|email)|full name|email address)\b/i;
const transactionPattern =
  /\b(verify|confirm|check|delete account|dismiss popups?|inspect|status|activity feed|posted comment|ticket status)\b/i;
const navigateReturnPattern =
  /\b(go (?:to|back)|come back|return (?:to|after)|look up .* (?:then|and) return|check .* (?:then|and) (?:come|go) back|find .* details|job (?:listing|board|posting)|round.?trip)\b/i;
const listDetailReviewPattern =
  /\b(review|read|open|check)\b[\s\S]{0,120}\b(each|every|all)\b[\s\S]{0,120}\b(listing|listings|jobs|job listing|postings|items|results)\b/i;
const listReturnPattern =
  /\b(return|come back|go back|back to (?:the )?(?:list|listings)|one by one)\b/i;
const procurementLoopPattern =
  /\b(procurement|purchase|buy)\b[\s\S]{0,160}\b(new tab|another tab|each store|store page|store link)\b[\s\S]{0,160}\b(check (?:it|them) off|mark (?:it|them) done|come back and check|return and check|checkbox)\b/i;
const overlayRecoveryPattern =
  /\b(close .* (?:banner|popup|modal|overlay|dialog)|dismiss .* (?:popup|modal|overlay|banner)|cookie (?:banner|consent|popup)|newsletter (?:popup|modal)|can'?t see the page|blocking (?:modal|overlay|popup)|popups? (?:blocking|covering|obscuring)|clear (?:the )?(?:popup|modal|overlay)s?)\b/i;

function buildCorpus(parts: Array<string | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n")
    .toLowerCase();
}

export function listSkillDescriptors(): SkillDescriptor[] {
  return SKILL_CATALOG.map((skill) => ({ ...skill }));
}

export function getSkillDescriptor(
  id: string,
): SkillDescriptor | undefined {
  return SKILL_CATALOG.find((skill) => skill.id === id);
}

export function getLoadedSkillContract(
  id?: string,
): LoadedSkillContract | null {
  if (!id) return null;
  const descriptor = getSkillDescriptor(id);
  const body = SKILL_BODIES[id];
  if (!descriptor || !body) return null;
  return {
    ...descriptor,
    ...body,
  };
}

const TOOL_NAME_VALUES = new Set<string>(Object.values(ToolName));

function normalizeSkillTools(tools?: string[]): ToolName[] {
  if (!Array.isArray(tools)) return [];
  return tools.filter(
    (tool): tool is ToolName =>
      typeof tool === "string" && TOOL_NAME_VALUES.has(tool),
  );
}

export function getSkillToolPolicy(
  id?: string,
): SkillToolPolicy | null {
  const descriptor = getSkillDescriptor(id || "");
  if (!descriptor) return null;
  return {
    preferredTools: normalizeSkillTools(descriptor.preferredTools),
    discouragedTools: normalizeSkillTools(descriptor.discouragedTools),
  };
}

const SKILL_TOOL_SUPPRESSION_POLICIES: Record<
  string,
  SkillToolSuppressionPolicy
> = {
  "structured-form-fill": {
    temporarilySuppressedTools: [ToolName.PRESS_KEY],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
      ToolName.SCHEDULE_TASK,
    ],
  },
  "inline-edit-surface": {
    temporarilySuppressedTools: [ToolName.CLICK_COORDINATES],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
      ToolName.SCHEDULE_TASK,
    ],
  },
  "modal-overlay-recovery": {
    temporarilySuppressedTools: [
      ToolName.DISMISS_OVERLAYS,
      ToolName.NAVIGATE,
      ToolName.TYPE_TEXT,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
      ToolName.SCHEDULE_TASK,
    ],
  },
  "multi-tab-procurement-loop": {
    temporarilySuppressedTools: [
      ToolName.NAVIGATE,
      ToolName.GO_BACK,
      ToolName.READ_ELEMENT,
      ToolName.LIST_TABS,
      ToolName.INSPECT_HIDDEN,
      ToolName.XRAY_PAGE,
      ToolName.CLICK_COORDINATES,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
      ToolName.SCHEDULE_TASK,
    ],
  },
  "list-detail-review-loop": {
    temporarilySuppressedTools: [
      ToolName.NAVIGATE,
      ToolName.GO_BACK,
      ToolName.PRESS_KEY,
      ToolName.READ_ELEMENT,
      ToolName.FIND_ELEMENT,
      ToolName.INSPECT_HIDDEN,
      ToolName.XRAY_PAGE,
      ToolName.CLICK_COORDINATES,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
      ToolName.SCHEDULE_TASK,
    ],
  },
  "cross-tab-compare": {
    temporarilySuppressedTools: [
      ToolName.NAVIGATE,
      ToolName.GO_BACK,
      ToolName.CLICK_COORDINATES,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
      ToolName.SCHEDULE_TASK,
    ],
  },
};

export function getSkillToolSuppressionPolicy(
  id?: string,
): SkillToolSuppressionPolicy | null {
  if (!id) return null;
  return SKILL_TOOL_SUPPRESSION_POLICIES[id] ?? null;
}

export function summarizeSkillForVerifier(
  contract: LoadedSkillContract | null,
): string {
  if (!contract) return "";

  const lines = [
    `Selected skill: ${contract.id}`,
    `Description: ${contract.description}`,
    `Verifier mode: ${contract.verifierMode}`,
  ];

  if (contract.requiredEvidence?.length) {
    lines.push(
      "Required evidence:",
      ...contract.requiredEvidence.map((item) => `- ${item}`),
    );
  }

  if (contract.executionContract?.completionChecks?.length) {
    lines.push(
      "Completion checks:",
      ...contract.executionContract.completionChecks.map((item) => `- ${item}`),
    );
  }

  if (contract.executionContract?.failureRecovery?.length) {
    lines.push(
      "Failure recovery:",
      ...contract.executionContract.failureRecovery.map((item) => `- ${item}`),
    );
  }

  if (contract.notes?.length) {
    lines.push("Skill notes:", ...contract.notes.map((item) => `- ${item}`));
  }

  return lines.join("\n");
}

export function selectPrimarySkill(input: {
  query?: string;
  objective: string;
  successCriteria?: string;
  pageTitle?: string;
  pageUrl?: string;
}): SkillSelection | null {
  const corpus = buildCorpus([
    input.query,
    input.objective,
    input.successCriteria,
    input.pageTitle,
    input.pageUrl,
  ]);
  const stepCorpus = buildCorpus([input.objective, input.successCriteria]);
  const currentStepLooksLikeInlineEdit =
    (gridEditPattern.test(stepCorpus) || inlineEditPattern.test(stepCorpus)) &&
    /\b(change|edit|update|set|replace|rename|enter|type)\b/i.test(stepCorpus);
  const currentStepLooksLikeFormFill =
    formPattern.test(stepCorpus) &&
    /\b(fill|form|field|dropdown|checkbox|input|email|name|phone|category|budget)\b/i.test(
      stepCorpus,
    );
  const currentStepNeedsTransactionalCheck =
    transactionPattern.test(stepCorpus);

  if (budgetPattern.test(corpus)) {
    return {
      id: "budget-aware-execution",
      reason:
        "Task context explicitly calls for conserving remaining turns and avoiding blind retries.",
    };
  }

  if (
    overlayRecoveryPattern.test(stepCorpus) ||
    (overlayRecoveryPattern.test(corpus) &&
      !currentStepLooksLikeInlineEdit &&
      !currentStepLooksLikeFormFill &&
      !currentStepNeedsTransactionalCheck)
  ) {
    return {
      id: "modal-overlay-recovery",
      reason:
        "Task requires dismissing blocking overlays before the underlying content is accessible.",
    };
  }

  if (
    hoverRevealPattern.test(corpus) &&
    /\b(menu|tooltip|reveal|hover|dropdown|flyout)\b/i.test(corpus)
  ) {
    return {
      id: "hover-reveal-navigation",
      reason:
        "Task depends on revealing a hidden menu or tooltip through hover before acting.",
    };
  }

  if (currentStepLooksLikeInlineEdit) {
    return {
      id: "inline-edit-surface",
      reason:
        "Current step edits a value directly inside an inline editor, grid cell, table row, or rename surface.",
    };
  }

  if (
    continuationPattern.test(corpus) &&
    continuationArtifactPattern.test(corpus) &&
    !gridEditPattern.test(stepCorpus)
  ) {
    return {
      id: "continuation-edit",
      reason: "Task requests revising prior work while preserving earlier intent.",
    };
  }

  if (comparePattern.test(corpus)) {
    return {
      id: "cross-tab-compare",
      reason: "Comparison-oriented task spans multiple tabs or pages.",
    };
  }

  if (
    procurementLoopPattern.test(corpus) ||
    (/\b(procurement list|store)\b/i.test(corpus) &&
      /\b(new tab|another tab)\b/i.test(corpus) &&
      /\b(buy|purchase)\b/i.test(corpus) &&
      /\b(check off|mark .* done|checkbox)\b/i.test(corpus))
  ) {
    return {
      id: "multi-tab-procurement-loop",
      reason:
        "Task requires repeating a checklist workflow across store tabs: open, purchase, return, and mark complete.",
    };
  }

  if (
    listDetailReviewPattern.test(corpus) &&
    listReturnPattern.test(corpus) &&
    /\b(detail|details|view details|open)\b/i.test(corpus)
  ) {
    return {
      id: "list-detail-review-loop",
      reason:
        "Task requires reviewing multiple visible list items by opening each detail view and returning to the list in sequence.",
    };
  }

  if (
    navigateReturnPattern.test(corpus) &&
    /\b(return|come back|go back|round.?trip|then)\b/i.test(corpus)
  ) {
    return {
      id: "navigate-read-return",
      reason:
        "Task requires navigating to a target page, extracting information, and returning.",
    };
  }

  if (
    profileFieldPattern.test(stepCorpus) &&
    /\b(fill|checkout|form|field|name|email|submit|place order)\b/i.test(stepCorpus)
  ) {
    return {
      id: "structured-form-fill",
      reason:
        "Current step requires filling form fields from saved profile data before submission.",
    };
  }

  if (currentStepNeedsTransactionalCheck) {
    return {
      id: "transactional-act-check-act",
      reason:
        "Current step requires an action followed by explicit intermediate verification.",
    };
  }

  if (cartPattern.test(stepCorpus) || cartPattern.test(corpus)) {
    return {
      id: "cart-modify-checkout",
      reason:
        "Task modifies an in-progress shopping or checkout state before completion.",
    };
  }

  if (currentStepLooksLikeFormFill) {
    return {
      id: "structured-form-fill",
      reason:
        "Task requires disciplined multi-field form entry before submission.",
    };
  }

  if (transactionPattern.test(corpus)) {
    return {
      id: "transactional-act-check-act",
      reason:
        "Task requires an action followed by explicit intermediate verification.",
    };
  }

  return null;
}
