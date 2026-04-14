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

export interface SkillSelection {
  id: string;
  reason: string;
}

export interface LoadedSkillContract extends SkillDescriptor {
  procedureMarkdown: string;
  requiredEvidence?: string[];
  commonFailures?: Array<{
    signal: string;
    recovery: string;
  }>;
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
  },
  "structured-form-fill": {
    procedureMarkdown: [
      "1. Identify all relevant fields before typing.",
      "2. Map each requested value to a specific input, select, or checkbox.",
      "3. Fill fields one by one without submitting early.",
      "4. Re-check required fields and validation messages before submission.",
      "5. Submit only when all requested values are present and no obvious validation blocker remains.",
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
  },
};

const comparePattern =
  /\b(compare|based on both|across both|which (?:is|looks) strongest|highest on page|last page|both tabs?|overview|reports?)\b/i;
const hoverRevealPattern =
  /\b(hover|hover over|tooltip|flyout|dropdown|drop-down|reveal menu|products menu|under the .* menu)\b/i;
const budgetPattern =
  /\b(turn budget|remaining turns|max turns|max_turns|turn limit|budget exhaustion|conservation mode)\b/i;
const continuationPattern =
  /\b(change|revise|rewrite|edit|make (?:it|the tone)|one more change|previous draft|draft reply|reply|casual)\b/i;
const cartPattern =
  /\b(cart|checkout|coupon|promo|discount|swap|replace|remove|add to cart)\b/i;
const formPattern =
  /\b(form|fill|input|field|dropdown|checkbox|select|budget|category|submit)\b/i;
const transactionPattern =
  /\b(verify|confirm|check|delete account|dismiss popups?|inspect|status|activity feed|posted comment|ticket status)\b/i;
const navigateReturnPattern =
  /\b(go (?:to|back)|come back|return (?:to|after)|look up .* (?:then|and) return|check .* (?:then|and) (?:come|go) back|find .* details|job (?:listing|board|posting)|round.?trip)\b/i;
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

  if (budgetPattern.test(corpus)) {
    return {
      id: "budget-aware-execution",
      reason:
        "Task context explicitly calls for conserving remaining turns and avoiding blind retries.",
    };
  }

  if (overlayRecoveryPattern.test(corpus)) {
    return {
      id: "modal-overlay-recovery",
      reason:
        "Task requires dismissing blocking overlays before the underlying content is accessible.",
    };
  }

  if (comparePattern.test(corpus)) {
    return {
      id: "cross-tab-compare",
      reason: "Comparison-oriented task spans multiple tabs or pages.",
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

  if (
    continuationPattern.test(corpus) &&
    /\b(draft|reply|tone|previous|change|revise|rewrite|edit)\b/i.test(corpus)
  ) {
    return {
      id: "continuation-edit",
      reason: "Task requests revising prior work while preserving earlier intent.",
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

  if (cartPattern.test(corpus)) {
    return {
      id: "cart-modify-checkout",
      reason:
        "Task modifies an in-progress shopping or checkout state before completion.",
    };
  }

  if (
    formPattern.test(corpus) &&
    /\b(fill|form|field|dropdown|checkbox|input)\b/i.test(corpus)
  ) {
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
