import { ToolName } from "../../types";
import type { EvidenceEventType } from "../../types";
import type { ToolProfile } from "../tools/metadata";

export type SkillCapability =
  | "read_context"
  | "compose_response"
  | "submit_response"
  | "verify_posted"
  | "update_record"
  | "add_note"
  | "verify_saved";

export interface SkillDescriptor {
  id: string;
  name: string;
  description: string;
  tags: string[];
  triggers: string[];
  maturity: "draft" | "candidate" | "active";
  preferredTools?: string[];
  discouragedTools?: string[];
  capabilityNeeds?: SkillCapability[];
  contextScope?: "turn" | "workspace";
  verifierMode: "deterministic" | "hybrid" | "llm";
  atomic?: boolean;
  requiredEvidenceTypes?: EvidenceEventType[];
  notes?: string[];
  packId?: string;
}

export type SkillPackType = "core" | "enterprise" | "platform";

export interface SkillPack {
  id: string;
  name: string;
  description: string;
  type: SkillPackType;
  enabledByDefault: boolean;
  skillIds: string[];
}

export interface SkillCatalogOptions {
  enabledSkillPackIds?: readonly string[];
  candidateSkillIds?: readonly string[];
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

export interface SkillMatcherInput {
  query?: string;
  objective: string;
  successCriteria?: string;
  pageTitle?: string;
  pageUrl?: string;
  pageMarkers?: readonly string[];
  runtimeContext?: readonly string[];
  enabledSkillPackIds?: readonly string[];
  candidateSkillIds?: readonly string[];
}

export type SkillActivationSignalStrength = "always" | "weak" | "strong";

export interface SkillCandidateDescriptor {
  skill: SkillDescriptor;
  packId?: string;
  activationReason: string;
  signalStrength: SkillActivationSignalStrength;
}

export interface SkillMatcher {
  match(input: SkillMatcherInput): SkillSelection | null;
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
    contextScope: "turn",
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
    contextScope: "turn",
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
    contextScope: "turn",
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
    contextScope: "turn",
    verifierMode: "hybrid",
    notes: ["Read cart state before and after mutation."],
  },
  {
    id: "email-reply-careful",
    name: "Email Reply Careful",
    description:
      "Read an email, extract the reply requirements, preserve language and tone context, then draft or send only after verifying the recipient and content.",
    tags: ["workflow", "email", "communication", "composition", "safety"],
    packId: "communication-workflows",
    triggers: [
      "reply to email",
      "respond to mail",
      "draft an email reply",
      "send a contextual email response",
    ],
    maturity: "candidate",
    preferredTools: [
      "read_page",
      "read_element",
      "update_notes",
      "type_text",
      "click_element",
    ],
    discouragedTools: ["done", "click_coordinates", "press_key"],
    capabilityNeeds: [
      "read_context",
      "compose_response",
      "submit_response",
      "verify_posted",
    ],
    contextScope: "turn",
    verifierMode: "hybrid",
    notes: [
      "Match the source email's language and register unless the user asks otherwise.",
      "Do not invent facts, commitments, dates, names, or recipients.",
      "Verify the draft and recipient before any send action.",
      "If the user asks to reply, respond, confirm, accept, or decline to a sender and does not say draft-only, the task requires sending the reply.",
      "After sending, verify real feedback such as sent-mail navigation, the message in the thread, a toast, or a changed email list state instead of re-reading the old draft.",
    ],
  },
  {
    id: "thread-message-careful",
    name: "Thread Message Careful",
    description:
      "Read a chat, channel, comment, or message thread, preserve audience, language, and tone context, then post a grounded reply to the correct thread.",
    tags: ["workflow", "messaging", "thread", "communication", "context"],
    triggers: [
      "reply in the thread",
      "post to the channel",
      "respond in chat",
      "send a message in the team thread",
    ],
    maturity: "candidate",
    preferredTools: [
      "read_page",
      "read_element",
      "update_notes",
      "type_text",
      "click_element",
    ],
    discouragedTools: ["done", "click_coordinates", "press_key"],
    capabilityNeeds: [
      "read_context",
      "compose_response",
      "submit_response",
      "verify_posted",
    ],
    contextScope: "turn",
    verifierMode: "hybrid",
    notes: [
      "Identify the exact thread, speaker, audience, language, and tone before composing.",
      "Preserve owners, deadlines, deliverables, blockers, and unresolved questions.",
      "Do not post if the target thread or audience is uncertain.",
      "If the user explicitly asks to reply, send, or post, treat a visible verified draft plus a visible Send/Post button as ready to submit; do not keep re-reading the same draft.",
      "After posting, verify real feedback such as the new message in the thread, a list update, a toast, or composer clearing instead of re-reading the old draft.",
    ],
  },
  {
    id: "crm-ticket-update",
    name: "CRM Ticket Update",
    description:
      "Update a CRM or support ticket record by reading the case context, applying requested field changes, and adding a grounded internal note.",
    tags: ["workflow", "crm", "ticket", "record-update", "support"],
    triggers: [
      "update support ticket",
      "set ticket status",
      "set ticket priority",
      "change ticket dropdown",
      "add internal note",
      "escalate CRM case",
    ],
    maturity: "candidate",
    preferredTools: [
      "read_page",
      "read_element",
      "update_notes",
      "select_option",
      "type_text",
      "set_checkbox",
      "click_element",
    ],
    discouragedTools: ["done", "click_coordinates"],
    capabilityNeeds: [
      "read_context",
      "update_record",
      "add_note",
      "verify_saved",
    ],
    contextScope: "turn",
    verifierMode: "hybrid",
    notes: [
      "Read the customer issue and ticket properties before changing fields.",
      "Update only fields supported by the request or visible ticket context.",
      "Use select_option for native status, priority, assignee, or category controls; use click_element only for custom dropdowns after the options are visible.",
      "If escalation is requested and no explicit escalation field is visible, use the ticket's priority field as the escalation-equivalent control and set it to Urgent when the impact supports escalation.",
      "Internal notes should include issue, impact, account context, and next step when available.",
    ],
  },
  {
    id: "chart-value-extraction",
    name: "Chart Value Extraction",
    description:
      "Extract requested values from dashboards or charts using structured chart evidence before pointer exploration.",
    tags: ["workflow", "chart", "dashboard", "data-extraction"],
    triggers: [
      "chart value",
      "dashboard metric",
      "read the chart",
      "bar chart",
      "line chart",
      "pie chart",
    ],
    maturity: "candidate",
    preferredTools: [
      "inspect_chart",
      "read_page",
      "read_element",
      "update_notes",
    ],
    discouragedTools: [
      "click_element",
      "navigate",
      "type_text",
      "select_option",
      "click_coordinates",
      "done",
    ],
    contextScope: "turn",
    verifierMode: "hybrid",
    notes: [
      "Prefer structured chart and SVG evidence before any pointer exploration.",
      "Treat chart/dashboard extraction as read-only; do not click Run, Refresh, report edit, drilldown, export, filter, or navigation controls unless the user explicitly asks to change the chart.",
      "When the user asks for one chart value, answer with exactly one numeric value and the requested unit; keep supporting counts, totals, timestamps, and axis ranges out of the final answer.",
      "When the user asks for a chart label and count, answer as 'Label: count' with one numeric count; do not repeat the count or include percentages, totals, axis ranges, or tie details.",
      "Completion requires a concrete requested chart value, not just reaching the chart page.",
    ],
  },
  {
    id: "search-answer-extraction",
    name: "Search Answer Extraction",
    description:
      "Search, open or read the best result, extract the requested fact, then answer explicitly.",
    tags: ["workflow", "search", "knowledge", "answer-extraction"],
    triggers: [
      "search knowledge",
      "knowledge base",
      "search results",
      "find the answer",
      "look up and answer",
    ],
    maturity: "candidate",
    preferredTools: [
      "search_knowledge_base",
      "read_page",
      "find_element",
      "type_text",
      "click_element",
      "read_element",
      "update_notes",
    ],
    discouragedTools: ["scroll_page", "click_coordinates"],
    contextScope: "turn",
    verifierMode: "hybrid",
    notes: [
      "Opening a result is intermediate.",
      "Prefer exact-question terms over broad paraphrases when searching.",
      "For knowledge-base answer questions, call search_knowledge_base first so search, result ranking, article reading, and answer extraction happen as one grounded read-only workflow.",
      "Compare result snippets or titles before opening; do not assume the first result is the answer.",
      "Completion requires a final answer that contains the requested fact.",
    ],
  },
  {
    id: "list-filter-workflow",
    name: "List Filter Workflow",
    description:
      "Apply list or table filters by setting a condition, running it, and verifying filtered state.",
    tags: ["workflow", "list", "table", "filter"],
    triggers: [
      "filter list",
      "apply filter",
      "filter builder",
      "condition builder",
      "show records where",
    ],
    maturity: "candidate",
    preferredTools: [
      "apply_list_filter",
      "inspect_table",
      "inspect_filter_state",
      "read_page",
      "update_notes",
    ],
    discouragedTools: [
      "find_element",
      "click_element",
      "select_option",
      "type_text",
      "inspect_hidden",
      "xray_page",
      "scroll_page",
      "click_coordinates",
      "done",
    ],
    contextScope: "turn",
    verifierMode: "hybrid",
    notes: [
      "When the request gives explicit field/operator/value conditions, use apply_list_filter before manual filter-builder clicks.",
      "Do not open the filter builder for explicit structured conditions unless apply_list_filter reports it cannot apply the request.",
      "Opening the filter builder is not completion.",
      "Verify an applied condition through query state, filter chips, or changed rows.",
    ],
  },
  {
    id: "list-sort-workflow",
    name: "List Sort Workflow",
    description:
      "Sort a list or table by the requested column and verify resulting sort state.",
    tags: ["workflow", "list", "table", "sort"],
    triggers: [
      "sort list",
      "sort table",
      "order by",
      "ascending",
      "descending",
      "sort column",
    ],
    maturity: "candidate",
    preferredTools: [
      "apply_list_sort",
      "inspect_table",
      "read_page",
      "update_notes",
    ],
    discouragedTools: [
      "find_element",
      "click_element",
      "scroll_page",
      "type_text",
      "click_coordinates",
      "done",
    ],
    contextScope: "turn",
    verifierMode: "hybrid",
    notes: [
      "When the request gives explicit sort fields and directions, use apply_list_sort before manual column-header or list-menu clicks.",
      "For multi-field sort requests, include every requested field and direction in one apply_list_sort call rather than sorting one header at a time.",
      "Do not open personalization/list configuration for sorting unless the structured sort helper reports unsupported fields.",
      "Completion requires URL, header, or row-order evidence that sorting changed.",
    ],
  },
  {
    id: "catalog-order-workflow",
    name: "Catalog Order Workflow",
    description:
      "Configure a catalog item with requested quantity/options and continue through cart/order confirmation.",
    tags: ["workflow", "catalog", "order", "configuration"],
    triggers: [
      "order catalog item",
      "service catalog",
      "hardware catalog item",
      "hardware store",
      "catalog item with options",
      "configure item",
      "request item",
    ],
    maturity: "candidate",
    preferredTools: [
      "inspect_catalog_item",
      "configure_catalog_item",
      "set_checkbox",
      "type_text",
      "select_option",
      "click_element",
      "read_page",
      "update_notes",
    ],
    discouragedTools: ["scroll_page", "click_coordinates", "done"],
    contextScope: "turn",
    verifierMode: "hybrid",
    notes: [
      "Product detail page reached is intermediate.",
      "After reaching the item page, configure requested quantity/options and submit in the same workflow rather than reporting that the page is ready.",
      "Completion requires configured requested options and request/order confirmation.",
    ],
  },
  {
    id: "servicenow-module-navigation",
    name: "ServiceNow Module Navigation",
    description:
      "Resolve and open ServiceNow application navigator modules by metadata instead of manual menu or global search exploration.",
    tags: ["workflow", "servicenow", "navigation", "module"],
    packId: "servicenow-platform",
    triggers: [
      "ServiceNow module",
      "application navigator",
      "navigate to the module",
      "module of the application",
      "module in the application",
    ],
    maturity: "candidate",
    preferredTools: [
      "open_servicenow_module",
      "read_page",
      "done",
      "update_notes",
    ],
    discouragedTools: [
      "navigate",
      "type_text",
      "press_key",
      "scroll_page",
      "click_coordinates",
    ],
    contextScope: "turn",
    verifierMode: "deterministic",
    atomic: true,
    requiredEvidenceTypes: ["navigation_reached", "goal_state_verified"],
    notes: [
      "Use ServiceNow module metadata before manual application navigator clicks.",
      "Do not call navigate with a search query inside ServiceNow.",
    ],
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
      "configure product options",
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
    contextScope: "turn",
    verifierMode: "deterministic",
    notes: [
      "Map values to fields before typing.",
      "For configurators, verify any derived total, price, or summary after changing options before finishing.",
      "If same-page validation errors appear after submit, repair the named fields and resubmit instead of treating validation as completion.",
    ],
  },
  {
    id: "progressive-repeatable-form",
    name: "Progressive Repeatable Form",
    description:
      "Create, fill, and verify repeatable form groups that appear after Add another/Add item controls.",
    tags: ["workflow", "forms", "repeatable", "progressive", "data-entry"],
    triggers: [
      "add another section",
      "add multiple experience entries",
      "create repeated form sections",
      "fill repeatable rows in order",
      "add item three times then fill fields",
    ],
    maturity: "candidate",
    preferredTools: [
      "get_profile_fields",
      "read_page",
      "click_element",
      "type_text",
      "select_option",
      "set_checkbox",
      "update_notes",
    ],
    discouragedTools: ["press_key", "click_coordinates"],
    contextScope: "turn",
    verifierMode: "deterministic",
    notes: [
      "Count existing repeated groups before adding new ones.",
      "Re-ground after Add another/Add item controls because element ids and field groups can change.",
      "Map values by group label or index, not by field order alone.",
    ],
  },
  {
    id: "multi-step-form-wizard",
    name: "Multi-Step Form Wizard",
    description:
      "Complete forms split across Next/Back/Review steps, including conditional fields that appear after earlier choices.",
    tags: ["workflow", "forms", "wizard", "conditional", "data-entry"],
    triggers: [
      "multi-step form",
      "form wizard",
      "continue through review",
      "conditional fields",
      "next step then submit",
    ],
    maturity: "candidate",
    preferredTools: [
      "read_page",
      "type_text",
      "select_option",
      "set_checkbox",
      "click_element",
      "read_element",
      "update_notes",
    ],
    discouragedTools: ["press_key", "click_coordinates"],
    contextScope: "turn",
    verifierMode: "deterministic",
    notes: [
      "Treat each Next/Continue click as a state transition that requires fresh grounding.",
      "After selecting options that reveal conditional fields, fill and verify the revealed requirements before advancing.",
      "Use the review step as evidence before final submit.",
    ],
  },
  {
    id: "consequential-action-consent",
    name: "Consequential Action Consent",
    description:
      "Prepare workflows that may send, submit, publish, purchase, delete, confirm, or otherwise create real-world consequences, then stop for approval when user intent is unclear or approval is requested.",
    tags: ["workflow", "consent", "approval", "safety"],
    triggers: [
      "wait for approval before final action",
      "ask before submitting",
      "prepare but do not send",
      "draft and wait for confirmation",
      "final approval required",
    ],
    maturity: "candidate",
    preferredTools: [
      "read_page",
      "read_element",
      "update_notes",
      "type_text",
      "select_option",
      "set_checkbox",
      "click_element",
      "clarify",
    ],
    discouragedTools: ["done", "click_coordinates", "press_key"],
    contextScope: "turn",
    verifierMode: "hybrid",
    notes: [
      "Treat consequential final actions as approval-gated unless the user clearly authorized them.",
      "If the user's policy is unclear, ask whether to execute final actions or stop for approval.",
      "Preparation and verification may continue; final execution must wait for consent when requested or ambiguous.",
    ],
  },
  {
    id: "job-application-assistant",
    name: "Job Application Assistant",
    description:
      "Fill or prepare job, career, vacancy, CV, or resume application workflows, verify the application data, and stop before final submit unless explicit approval is obtained.",
    tags: ["workflow", "jobs", "application", "forms", "consent"],
    triggers: [
      "job application",
      "apply for a job",
      "career application",
      "submit resume",
      "fill job form and wait for approval",
    ],
    maturity: "candidate",
    preferredTools: [
      "read_page",
      "read_element",
      "update_notes",
      "type_text",
      "select_option",
      "set_checkbox",
      "click_element",
      "clarify",
    ],
    discouragedTools: ["done", "click_coordinates", "press_key"],
    capabilityNeeds: ["read_context", "update_record", "verify_saved"],
    contextScope: "turn",
    verifierMode: "hybrid",
    notes: [
      "Do not invent personal data, salary expectations, legal answers, or availability.",
      "Fill and verify requested fields, then summarize what is ready before final submit.",
      "Final application submission is a consequential action and must be approval-gated by runtime policy.",
    ],
  },
  {
    id: "servicenow-record-form",
    name: "ServiceNow Record Form",
    description:
      "Fill, verify, and submit ServiceNow record forms by field label/name with form-state readback.",
    tags: ["workflow", "forms", "servicenow", "record"],
    packId: "servicenow-platform",
    triggers: [
      "servicenow record form",
      "create a new incident",
      "create a new change request",
      "value for field",
    ],
    maturity: "candidate",
    preferredTools: [
      "configure_servicenow_form",
      "read_page",
      "open_servicenow_module",
      "done",
      "update_notes",
    ],
    discouragedTools: [
      "click_element",
      "type_text",
      "select_option",
      "press_key",
      "click_coordinates",
    ],
    contextScope: "turn",
    verifierMode: "deterministic",
    notes: [
      "Use the ServiceNow form helper for both field configuration and final submit.",
      "Verify field readback before submit and record evidence after submit.",
    ],
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
    contextScope: "turn",
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
    tags: ["workflow", "continuation", "editing", "context"],
    triggers: [
      "change previous draft",
      "revise prior answer",
      "continue previous task",
    ],
    maturity: "candidate",
    preferredTools: ["read_page", "update_notes", "type_text"],
    discouragedTools: ["navigate"],
    contextScope: "workspace",
    verifierMode: "hybrid",
    notes: ["Apply the requested delta, not a full rewrite unless necessary."],
  },
  {
    id: "cross-tab-compare",
    name: "Cross Tab Compare",
    description:
      "Collect facts from explicitly separate tabs or pages, normalize them, then compare or report the requested multi-source values after evidence is gathered.",
    tags: ["workflow", "comparison", "tabs", "context"],
    triggers: [
      "compare tabs",
      "read both tabs",
      "collect values from two pages",
      "compare page 1 and page N",
      "compare overview and reports",
    ],
    maturity: "candidate",
    preferredTools: ["read_page", "switch_tab", "read_element", "update_notes"],
    discouragedTools: [
      "navigate",
      "go_back",
      "click_coordinates",
      "right_click",
      "done",
    ],
    contextScope: "workspace",
    verifierMode: "deterministic",
    notes: [
      "Gather all required facts before synthesizing.",
      "Do not use for single-page configurators, ordinary report-tab navigation, inline edits, or list-review recommendations.",
      "Use list_tabs/switch_tab only for explicit browser-tab work. For in-page tabs such as Overview or Reports, use the visible page controls or previously gathered step results.",
      "When prior completed steps already contain the facts needed for the comparison, synthesize from that evidence before navigating or switching tabs.",
    ],
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
    preferredTools: ["read_page", "click_element", "press_key", "read_element"],
    discouragedTools: ["navigate", "type_text", "dismiss_overlays"],
    contextScope: "turn",
    verifierMode: "hybrid",
    notes: [
      "Click the overlay's close/dismiss/accept/X button directly — do not use dismiss_overlays.",
      "Dismiss one overlay at a time, re-read after each to verify it is gone.",
      "Call done after ALL blocking overlays are confirmed gone.",
      "If read_page or inspect_hidden shows no cookie, newsletter, popup, banner, modal, close, dismiss, or accept controls remain, stop searching and call done.",
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
    contextScope: "turn",
    verifierMode: "hybrid",
    notes: [
      "Capture the needed fact before navigating away from the target page.",
      "Verify the return landed on the expected origin page before continuing.",
    ],
  },
  {
    id: "multi-tab-checklist-workflow",
    name: "Multi-Tab Checklist Workflow",
    description:
      "Work through a source list or checklist where each item requires opening a target page in another tab, completing or extracting item-specific work, returning to the source tab, and recording progress before repeating.",
    packId: "procurement-workflows",
    tags: ["workflow", "tabs", "checklist", "multi-tab", "review"],
    triggers: [
      "open each item in a new tab",
      "open links in separate tabs then return to the list",
      "review checklist items across tabs and mark them done",
      "procurement list store tabs",
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
    contextScope: "workspace",
    verifierMode: "hybrid",
    notes: [
      "Use the source row or checklist item as the source of truth for the target page and item-specific objective.",
      "Open or reuse a target tab, complete the target work, record compact evidence in notes, then switch back to the source tab.",
      "Mark or record source progress only after the target tab work is actually completed or the required evidence is captured.",
    ],
  },
  {
    id: "paginated-table-scan",
    name: "Paginated Table Scan",
    description:
      "Scan a paginated table or data list exhaustively before answering aggregate questions such as highest, lowest, largest, or smallest value.",
    tags: ["workflow", "pagination", "table", "aggregate", "scan"],
    triggers: [
      "highest value in a paginated table",
      "lowest amount across all pages",
      "scan all table rows before answering",
      "showing rows X-Y of Z",
      "page through a directory or records table",
    ],
    maturity: "candidate",
    preferredTools: ["read_page", "click_element", "update_notes"],
    discouragedTools: [
      "find_element",
      "read_element",
      "type_text",
      "press_key",
      "select_option",
      "set_checkbox",
      "scroll_page",
      "inspect_hidden",
      "xray_page",
      "execute_js",
      "click_coordinates",
      "create_tab",
      "list_tabs",
      "done",
    ],
    contextScope: "workspace",
    verifierMode: "hybrid",
    notes: [
      "A visible page is only a sample unless the pagination range proves it is the whole dataset.",
      "Track seen ranges and the current best candidate in notes after each page.",
      "Use the visible Next control or the next sequential page-number button for forward coverage; if one does not advance the visible range, switch to the other.",
    ],
  },
  {
    id: "paginated-record-lookup",
    name: "Paginated Record Lookup",
    description:
      "Find one or a small number of named records in a paginated, searchable, or list-like data surface before extracting the requested field.",
    tags: ["workflow", "pagination", "table", "lookup", "search"],
    triggers: [
      "find a specific record in a table",
      "search for a named employee or ticket",
      "look up a row in a directory",
      "find post number in a feed",
      "locate an item across paginated results",
    ],
    maturity: "candidate",
    preferredTools: [
      "read_page",
      "find_element",
      "type_text",
      "click_element",
      "scroll_page",
      "wait",
      "update_notes",
    ],
    discouragedTools: [
      "read_element",
      "press_key",
      "inspect_hidden",
      "xray_page",
      "execute_js",
      "click_coordinates",
      "create_tab",
      "list_tabs",
      "done",
    ],
    contextScope: "workspace",
    verifierMode: "hybrid",
    notes: [
      "Use visible search or filter controls before manual pagination when the target is specific.",
      "When no search/filter exists, advance sequentially with Next or scroll_page for lazy-loaded feeds while tracking searched pages or ranges in notes.",
      "Do not answer from a near match; verify the target row identity before extracting the requested field.",
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
      "review the job listings and recommend matches",
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
    contextScope: "turn",
    verifierMode: "hybrid",
    notes: [
      "Enumerate the requested visible review set once before opening detail pages.",
      "Track reviewed item names in notes so an item is not reopened or skipped.",
      "When a tagged list action is already visible, click it directly instead of inspecting its attributes.",
      "Use one detail-page read to extract the facts, then return to the list immediately.",
      "Prefer the page's own back or return control over browser history when the detail view appears in-place.",
      "For recommendation or best-match tasks, treat the visible listings as the review set unless the user narrows the scope.",
    ],
  },
];

const MAX_ROUTED_SKILL_CANDIDATES = 32;

const BUILT_IN_SKILL_PACKS: SkillPack[] = [
  {
    id: "communication-workflows",
    name: "Communication Workflows",
    description:
      "Default communication skills for careful email and message composition workflows.",
    type: "enterprise",
    enabledByDefault: true,
    skillIds: ["email-reply-careful"],
  },
  {
    id: "procurement-workflows",
    name: "Multi-Tab Workflows",
    description:
      "Default checklist skills for source-list workflows that intentionally span multiple tabs.",
    type: "enterprise",
    enabledByDefault: true,
    skillIds: ["multi-tab-checklist-workflow"],
  },
  {
    id: "servicenow-platform",
    name: "ServiceNow Platform",
    description:
      "ServiceNow-specific platform semantics for application modules, record forms, reference fields, and Glide-backed commits.",
    type: "platform",
    enabledByDefault: true,
    skillIds: ["servicenow-module-navigation", "servicenow-record-form"],
  },
];

const SKILL_BODIES: Record<
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
      "6. Store the extracted value and its evidence in notes when the workflow has more than one step.",
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
  "catalog-order-workflow": {
    procedureMarkdown: [
      "1. Use inspect_catalog_item to read product name, quantity controls, options, price/summary, and order controls.",
      "2. On a catalog item detail page, prefer configure_catalog_item to set requested quantity, dropdown/radio-like options, checkbox states, and text requirements in one verified action.",
      "3. If configure_catalog_item reports missing controls, fall back to manual controls for only the missing fields.",
      "4. Re-inspect catalog state to verify the configuration before submitting when the helper did not submit.",
      "5. After Add to Cart, inspect the cart/order state before checkout; if checkout controls are visible, do not configure or add the same item again.",
      "6. Click the appropriate order, cart, checkout, or request control, or set submit=true in configure_catalog_item when the order/request button is visible.",
      "7. Continue until a request/order/cart confirmation is visible, then verify the confirmed line count and quantity match the request before calling done.",
      "8. Treat an Order Status page with a REQ request number as the final confirmation page; do not click request, item, or RITM links from it just to inspect.",
      "9. Do not open requested-item/detail links just to inspect after a request is submitted; if you do, return to the request/order confirmation page before calling done.",
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
        "Prefer inspect_catalog_item after each page transition so visible quantity/options/order controls are not missed.",
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
      "2. If the user references a saved profile or explicit profile field paths, call get_profile_fields for the exact needed fields before navigating away or inventing values.",
      "3. Map each requested value to a specific input, select, or checkbox.",
      "4. Prefer the returned profile values as the source of truth for name, email, and address fields.",
      "5. Stay on the current form unless the page itself shows that login or authentication is required.",
      "6. Fill fields one by one without submitting early.",
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
        "Use get_profile_fields for exact saved-profile values when the task calls for them.",
        "Avoid press_key submit shortcuts until field mapping and validation checks are complete.",
        'Use read_element(attribute="value") for filled textareas or long exact literals when read_page evidence is ambiguous.',
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
      "2. If the task references saved profile data for repeated rows, call get_profile_fields once for the exact array/path before filling.",
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
        "Use get_profile_fields once for exact repeated profile arrays when needed.",
        "Treat profile values as literals: copy exact strings for text fields and do not summarize, embellish, or replace them with plausible alternatives.",
        "Do not navigate away from the form to find saved profile data; the profile tool is the source of truth.",
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
        signal: "Next is clicked before conditional fields appear or are filled",
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
      "3. Fill fields only from the user's request, saved profile evidence, or visible page context.",
      "4. Use update_notes to track missing user-supplied values and fields that are ready.",
      "5. Re-read the application before final submission and verify the visible values or attached resume/CV state.",
      "6. Stop before the final Submit/Send/Apply action unless the user has approved that exact final submission.",
      "7. If approval is needed, summarize the target job and what will be submitted before requesting approval.",
      "8. After approved submission, verify confirmation, application received state, or equivalent page feedback.",
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
        "Use type_text/select_option/set_checkbox for explicit values only.",
        "Avoid press_key and click_coordinates for final application submission.",
      ],
      completionChecks: [
        "All known requested fields are filled or missing values are surfaced.",
        "The final submit action is either waiting for approval or was approved and verified.",
        "The final answer clearly states submitted vs ready-for-approval.",
      ],
      failureRecovery: [
        "If the application page shows validation errors, report the exact missing fields and do not submit.",
        "If the submit target is ambiguous, ask for confirmation before proceeding.",
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

const comparePattern =
  /\b(compare|based on both|across both|both tabs?|two tabs?|multiple tabs?|two pages?|multiple pages?|support dashboard.*marketing dashboard|marketing dashboard.*support dashboard)\b/i;
const hoverRevealPattern =
  /\b(hover|hover over|tooltip|flyout|reveal menu|products menu|under the .* menu)\b/i;
const budgetPattern =
  /\b(turn budget|remaining turns|max turns|max_turns|turn limit|budget exhaustion|conservation mode)\b/i;
const continuationPattern =
  /\b(change|revise|rewrite|edit|one more change|previous draft|draft reply|continue previous task|make (?:it|the tone)|reply|casual)\b/i;
const continuationArtifactPattern =
  /\b(draft|reply|tone|email|message|copy|text|wording|paragraph|sentence)\b/i;
const continuationRevisionPattern =
  /\b(change|revise|rewrite|edit|one more change|previous draft|current draft|make (?:it|the tone)|keep the rest|preserve)\b/i;
const gridEditPattern = /\b(spreadsheet|grid|cell|row|column|sheet|table)\b/i;
const inlineEditPattern =
  /\b(rename|inline edit|inline rename|change .* value|update .* value|replace .* value|edit .* cell|rename .* to|filename|file name|document name|table cell|grid cell)\b/i;
const cartPattern =
  /\b(cart|checkout|coupon|promo|discount|swap|replace|remove|add to cart)\b/i;
const emailReplyPattern =
  /\b(?:reply|respond|draft|compose)\b[\s\S]{0,100}\b(?:email|e-mail|mail|inbox|subject|sender|recipient)\b|\b(?:email|e-mail|mail|inbox)\b[\s\S]{0,100}\b(?:reply|response|draft)\b|\bsend\b[\s\S]{0,80}\b(?:email|e-mail|mail)\b[\s\S]{0,80}\b(?:reply|response|to|confirm|acknowledge)\b/i;
const threadMessagePattern =
  /\b(?:reply|respond|post|send|compose)\b[\s\S]{0,120}\b(?:thread|chat|channel|conversation|team thread|team chat|message thread|direct message|dm|comment)\b|\b(?:thread|chat|channel|conversation|messaging|message thread|team thread|project-updates)\b[\s\S]{0,120}\b(?:reply|respond|post|send|compose)\b/i;
const crmTicketPattern =
  /\b(?:crm|support\s+ticket|ticket|case|incident)\b[\s\S]{0,140}\b(?:status|priority|assignee|category|tag|triage|escalat\w*|internal note|comment|customer impact|account context|next step|update)\b|\b(?:set|update|triage|escalat\w*|add)\b[\s\S]{0,140}\b(?:support\s+ticket|ticket|case|incident|internal note)\b/i;
const chartValuePattern =
  /\b(chart|dashboard|graph|plot|bar chart|line chart|pie chart|highcharts|visualization|report widget)\b/i;
const chartValueIntentPattern =
  /\b(value|number|count|total|metric|data point|series|category|legend|axis|bar|slice|point|how many|amount)\b/i;
const searchAnswerPattern =
  /\b(knowledge base|kb article|search results?|search knowledge|find (?:the )?answer|look up|answer the question|article)\b/i;
const listFilterPattern =
  /\b(filter|condition builder|filter builder|show records where|query list|apply [^.\n]{0,80}filter|add [^.\n]{0,80}condition)\b/i;
const listSortPattern =
  /\b(sort|order by|ascending|descending|sort column|sort [^.\n]{0,80}list|sort [^.\n]{0,80}table)\b/i;
const catalogOrderPattern =
  /\b(service catalog|catalog item|request item|hardware store|hardware catalog|catalog option|optional software|add to cart|order now|place order|submit order|request [^.\n]{0,80}catalog|order\s+\d+\s+"[^"]{3,120}"\s+with\s+configuration)\b/i;
const serviceNowModuleNavigationPattern =
  /\b(application navigator|module of the|module in the|navigate to (?:the )?[^.\n]{0,120}module|open (?:the )?[^.\n]{0,120}module|(?:service\s*now|servicenow)[^.\n]{0,80}\bmodule\b|\bmodule\b[^.\n]{0,80}\b(?:service\s*now|servicenow))\b/i;
const formPattern =
  /\b(form|fill|input|field|dropdown|checkbox|select|budget|category|submit)\b/i;
const fieldValueRecordFormPattern =
  /\bvalue\s+of\s+(["'])[\s\S]*?\1\s+for\s+field\s+(["'])[\s\S]*?\2/i;
const serviceNowRecordFormPattern =
  /\b(?:service[-\s]*now|servicenow|incident|change request|problem|hardware asset|asset|user record|record)\b/i;
const configuratorPattern =
  /\b(configure|configurator|pick|choose|select|enable|disable)\b[\s\S]{0,120}\b(size|option|engraving|color|variant|total price|total|price|summary)\b/i;
const profileFieldPattern =
  /\b(saved profile|profile field|profile data|identity\.(?:first_name|last_name|email)|full name|email address)\b/i;
const progressiveRepeatableFormPattern =
  /\b(?:add|create|insert)\b[\s\S]{0,120}\b(?:another|multiple|several|\d+|two|three|four|five|sections?|roles?|experiences?|education|addresses?|dependents?)\b[\s\S]{0,120}\b(?:section|role|experience|education|address|dependent|form group|field group)s?\b|\b(?:add|create|insert)\b[\s\S]{0,120}\b(?:experience|education|address|dependent|role|work history|employment history)\s+entries\b|\b(?:experience|education|address|dependent|role|employment history|work history)\s+\d+\b|\b(?:roles?|experiences?|sections?)\b[\s\S]{0,80}\b(?:in order|repeatable|repeated|add another|add item|add experience)\b/i;
const multiStepFormWizardPattern =
  /\b(?:multi[-\s]?step|wizard|step\s+\d|next\s+step|continue\s+(?:to|through)|review\s+(?:step|details|page|summary))\b[\s\S]{0,160}\b(?:form|request|application|enrollment|intake|submit|submission)\b|\b(?:form|request|application|enrollment|intake)\b[\s\S]{0,160}\b(?:multi[-\s]?step|wizard|next|continue\s+(?:to|through)|review\s+(?:step|details|page|summary))\b/i;
const conditionalFormPattern =
  /\b(?:conditional|depends on|reveals?|appears?|hidden|required if|only if)\b[\s\S]{0,120}\b(?:field|fields|section|question|checkbox|dropdown|radio|select)\b|\b(?:field|fields|section|question)\b[\s\S]{0,120}\b(?:appears?|reveals?|required if|only if)\b/i;
const consequentialActionConsentPattern =
  /\b(?:wait for|ask for|request|get)\s+(?:my\s+|user\s+)?(?:approval|confirmation|permission|go-ahead)\b|\b(?:prepare|fill|draft|stage|review)\b[\s\S]{0,100}\b(?:but\s+)?(?:do not|don't|without)\s+(?:submit|send|post|publish|buy|purchase|place|delete|confirm|approve)\b|\b(?:final approval|required approval|approval required|ask before)\b/i;
const finalConsequentialActionPattern =
  /\b(?:submit|send|post|publish|buy|purchase|place order|delete|confirm|approve|apply)\b/i;
const jobApplicationPattern =
  /\b(?:job|career|position|vacancy|resume|cv)\b[\s\S]{0,160}\b(?:apply|application|submit|form|cover letter|resume|cv)\b|\b(?:apply|application|submit)\b[\s\S]{0,160}\b(?:job|career|position|vacancy|resume|cv)\b/i;
const transactionPattern =
  /\b(verify|confirm|check|delete account|dismiss popups?|inspect|status|activity feed|posted comment|ticket status)\b/i;
const navigateReturnPattern =
  /\b(go (?:to|back)|come back|return (?:to|after)|look up .* (?:then|and) return|check .* (?:then|and) (?:come|go) back|find .* details|job (?:listing|board|posting)|round.?trip)\b/i;
const listDetailReviewPattern =
  /\b(review|read|open|check)\b[\s\S]{0,120}\b(each|every|all)\b[\s\S]{0,120}\b(listing|listings|jobs|job listing|postings|items|results)\b/i;
const listReturnPattern =
  /\b(return|come back|go back|back to (?:the )?(?:list|listings)|one by one)\b/i;
const listReviewSurfacePattern =
  /\b(job board|job listings?|job postings?|jobs\b|listings?|results page|search results|candidate list)\b/i;
const listRecommendationIntentPattern =
  /\b(review|evaluate|compare|recommend|rank|shortlist|best matches?|best fit|which (?:ones|jobs|listings)|matches? (?:for|to)|fit (?:my|the|this) profile|why)\b/i;
const paginatedDataSurfacePattern =
  /\b(paginated|pagination|page\s+\d+\s+of\s+\d+|showing\s+\d+\s*(?:-|to|\u2012|\u2013|\u2014)\s*\d+\s+of\s+\d+|per\s+page|next\s+page|previous\s+page|table|directory|records?|rows?|employees?|items?|results?|data-table|feed)\b/i;
const tableAggregateIntentPattern =
  /\b(highest|max(?:imum)?|largest|most|lowest|min(?:imum)?|smallest|least)\b[\s\S]{0,120}\b(salar(?:y|ies)|pay|compensation|price|cost|amount|revenue|budget|value|total|score)\b|\b(salar(?:y|ies)|pay|compensation|price|cost|amount|revenue|budget|value|total|score)\b[\s\S]{0,120}\b(highest|max(?:imum)?|largest|most|lowest|min(?:imum)?|smallest|least)\b/i;
const paginatedRecordLookupIntentPattern =
  /\b(find|search for|look up|locate|open|review)\b[\s\S]{0,120}\b(?:#[0-9]+|[A-Z]+-\d+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?|post\s+#?\d+|record|row|ticket|employee|item)\b|\b(?:salary|status|priority|code|amount|email|owner|count)\b[\s\S]{0,120}\b(?:for|of)\b[\s\S]{0,80}\b(?:#[0-9]+|[A-Z]+-\d+|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i;
const procurementLoopPattern =
  /\b(procurement|purchase|buy)\b[\s\S]{0,160}\b(new tab|another tab|each store|store page|store link)\b[\s\S]{0,160}\b(check (?:it|them) off|mark (?:it|them) done|come back and check|return and check|checkbox)\b/i;
const naturalProcurementChecklistPattern =
  /\b(?:buy|purchase|procure)\b[\s\S]{0,120}\b(?:first\s+\w+|first\s+\d+|\d+)\s+items?\b[\s\S]{0,120}\bprocurement\s+list\b[\s\S]{0,120}\b(?:mark|check)\s+(?:them|items?|rows?)\s+(?:complete|done|off)\b/i;
const explicitTabIntentPattern =
  /\b(?:new|separate|another|other|multiple)\s+tabs?\b|\bopen\b[\s\S]{0,60}\b(?:tabs?|new windows?)\b|\bswitch\b[\s\S]{0,40}\btabs?\b|\bacross\s+tabs?\b/i;
const sourceListLoopPattern =
  /\b(?:source\s+)?(?:list|checklist|rows?|items?|links?|listings?|articles?|dashboards?|reports?|job listings?|research links?)\b/i;
const sourceProgressPattern =
  /\b(?:return|come back|switch back|go back)\b[\s\S]{0,120}\b(?:source|list|checklist|board|page|tab)\b|\b(?:mark|check|record|note)\b[\s\S]{0,80}\b(?:done|complete|reviewed|finished|progress|each|item|row|article)\b/i;
const repeatedItemPattern =
  /\b(?:first\s+\w+|first\s+\d+|\d+|two|three|four|five|six|seven|eight|nine|ten|all|each|every)\s+(?:items?|rows?|links?|listings?|articles?|dashboards?|dashboard\s+tabs?|reports?|jobs?)\b/i;
const overlayRecoveryPattern =
  /\b(close .* (?:banner|popup|modal|overlay|dialog)|dismiss .* (?:popup|modal|overlay|banner)|cookie (?:banner|consent|popup)|newsletter (?:popup|modal)|can'?t see the page|blocking (?:modal|overlay|popup)|popups? (?:blocking|covering|obscuring)|clear (?:the )?(?:popup|modal|overlay)s?)\b/i;

function buildCorpus(parts: Array<string | undefined>): string {
  return parts
    .filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    )
    .join("\n")
    .toLowerCase();
}

function buildRoutingCorpus(input: SkillMatcherInput): string {
  return buildCorpus([
    input.query,
    input.objective,
    input.successCriteria,
    input.pageTitle,
    ...(input.pageMarkers ?? []),
    ...(input.runtimeContext ?? []),
  ]);
}

function stripBenchmarkTaskIds(text: string): string {
  return text.replace(/\bworkarena\.[a-z0-9_.-]+\b/gi, " ");
}

function hasServiceNowUrlSignal(pageUrl?: string): boolean {
  if (!pageUrl) return false;
  try {
    const url = new URL(pageUrl);
    const host = url.hostname.toLowerCase();
    return (
      host.endsWith(".service-now.com") ||
      host.endsWith(".servicenow.com") ||
      host === "service-now.com" ||
      host === "servicenow.com"
    );
  } catch {
    return /\b(?:service-now|servicenow)\.com\b/i.test(pageUrl);
  }
}

function getServiceNowActivationReason(
  input: SkillMatcherInput,
): string | null {
  if (hasServiceNowUrlSignal(input.pageUrl)) {
    return "ServiceNow URL host is active.";
  }

  const markerCorpus = buildCorpus([
    input.pageTitle,
    ...(input.pageMarkers ?? []),
    ...(input.runtimeContext ?? []),
  ]);
  if (/\b(?:service\s*now|servicenow)\b/i.test(markerCorpus)) {
    return "ServiceNow page or runtime marker is active.";
  }

  const taskCorpus = stripBenchmarkTaskIds(
    buildCorpus([input.query, input.objective, input.successCriteria]),
  );
  if (/\b(?:service\s*now|servicenow)\b/i.test(taskCorpus)) {
    return "User explicitly named ServiceNow as the target environment.";
  }

  return null;
}

function hasCommunicationPackSignal(input: SkillMatcherInput): boolean {
  const corpus = buildRoutingCorpus(input);
  return emailReplyPattern.test(corpus) || threadMessagePattern.test(corpus);
}

function hasProcurementPackSignal(input: SkillMatcherInput): boolean {
  const corpus = buildRoutingCorpus(input);
  return (
    naturalProcurementChecklistPattern.test(corpus) ||
    procurementLoopPattern.test(corpus) ||
    (explicitTabIntentPattern.test(corpus) &&
      sourceListLoopPattern.test(corpus) &&
      repeatedItemPattern.test(corpus) &&
      sourceProgressPattern.test(corpus))
  );
}

function isPackPolicyEnabled(
  pack: SkillPack,
  options?: SkillCatalogOptions,
): boolean {
  const enabledSkillPackIds = resolveEnabledSkillPackIds(options);
  return !enabledSkillPackIds || enabledSkillPackIds.has(pack.id);
}

function getPackActivationReason(
  pack: SkillPack,
  input: SkillMatcherInput,
): { reason: string; strength: SkillActivationSignalStrength } | null {
  if (pack.id === "communication-workflows" && hasCommunicationPackSignal(input)) {
    return {
      reason: "Communication workflow signals are present.",
      strength: "weak",
    };
  }

  if (pack.id === "procurement-workflows" && hasProcurementPackSignal(input)) {
    return {
      reason: "Source-list or multi-tab checklist workflow signals are present.",
      strength: "weak",
    };
  }

  if (pack.id === "servicenow-platform") {
    const reason = getServiceNowActivationReason(input);
    return reason ? { reason, strength: "strong" } : null;
  }

  return null;
}

export function resolveEligibleSkillCandidates(
  input: SkillMatcherInput,
): SkillCandidateDescriptor[] {
  const candidates: SkillCandidateDescriptor[] = [];
  const seen = new Set<string>();
  const policyOptions: SkillCatalogOptions = {
    enabledSkillPackIds: input.enabledSkillPackIds,
  };

  const addSkill = (
    skill: SkillDescriptor,
    activationReason: string,
    signalStrength: SkillActivationSignalStrength,
  ) => {
    if (seen.has(skill.id)) return;
    seen.add(skill.id);
    candidates.push({
      skill: cloneSkillDescriptor(skill),
      packId: skill.packId,
      activationReason,
      signalStrength,
    });
  };

  for (const skill of SKILL_CATALOG) {
    if (!skill.packId) {
      addSkill(skill, "Core workflow skills are always eligible.", "always");
    }
  }

  for (const pack of BUILT_IN_SKILL_PACKS) {
    if (!isPackPolicyEnabled(pack, policyOptions)) continue;
    const activation = getPackActivationReason(pack, input);
    if (!activation) continue;
    for (const skillId of pack.skillIds) {
      const skill = SKILL_CATALOG.find((candidate) => candidate.id === skillId);
      if (skill) addSkill(skill, activation.reason, activation.strength);
    }
  }

  const activatedPackCandidates = candidates.filter(
    (candidate) => candidate.packId,
  );
  const coreCandidates = candidates.filter((candidate) => !candidate.packId);
  return [...activatedPackCandidates, ...coreCandidates].slice(
    0,
    MAX_ROUTED_SKILL_CANDIDATES,
  );
}

function cloneSkillPack(pack: SkillPack): SkillPack {
  return {
    ...pack,
    skillIds: [...pack.skillIds],
  };
}

function cloneSkillDescriptor(skill: SkillDescriptor): SkillDescriptor {
  return {
    ...skill,
    tags: [...skill.tags],
    triggers: [...skill.triggers],
    preferredTools: skill.preferredTools
      ? [...skill.preferredTools]
      : undefined,
    discouragedTools: skill.discouragedTools
      ? [...skill.discouragedTools]
      : undefined,
    capabilityNeeds: skill.capabilityNeeds
      ? [...skill.capabilityNeeds]
      : undefined,
    requiredEvidenceTypes: skill.requiredEvidenceTypes
      ? [...skill.requiredEvidenceTypes]
      : undefined,
    notes: skill.notes ? [...skill.notes] : undefined,
  };
}

function resolveEnabledSkillPackIds(
  options?: SkillCatalogOptions,
): Set<string> | null {
  if (!options?.enabledSkillPackIds) return null;
  return new Set(options.enabledSkillPackIds);
}

function isSkillDescriptorEnabled(
  skill: SkillDescriptor,
  options?: SkillCatalogOptions,
): boolean {
  if (
    options?.candidateSkillIds &&
    !new Set(options.candidateSkillIds).has(skill.id)
  ) {
    return false;
  }
  if (!skill.packId) return true;
  const enabledSkillPackIds = resolveEnabledSkillPackIds(options);
  if (!enabledSkillPackIds) return true;
  return enabledSkillPackIds.has(skill.packId);
}

function selectEnabledSkill(
  input: SkillCatalogOptions,
  id: string,
  reason: string,
): SkillSelection | null {
  if (!getSkillDescriptor(id, input)) return null;
  return { id, reason };
}

export function listSkillPacks(): SkillPack[] {
  return BUILT_IN_SKILL_PACKS.map(cloneSkillPack);
}

export function listDefaultEnabledSkillPackIds(): string[] {
  return BUILT_IN_SKILL_PACKS.filter((pack) => pack.enabledByDefault).map(
    (pack) => pack.id,
  );
}

export function getSkillPack(id: string): SkillPack | undefined {
  const pack = BUILT_IN_SKILL_PACKS.find((candidate) => candidate.id === id);
  return pack ? cloneSkillPack(pack) : undefined;
}

export function listSkillDescriptors(
  options?: SkillCatalogOptions,
): SkillDescriptor[] {
  return SKILL_CATALOG.filter((skill) =>
    isSkillDescriptorEnabled(skill, options),
  ).map(cloneSkillDescriptor);
}

export function getSkillDescriptor(
  id: string,
  options?: SkillCatalogOptions,
): SkillDescriptor | undefined {
  const skill = SKILL_CATALOG.find((candidate) => candidate.id === id);
  if (!skill || !isSkillDescriptorEnabled(skill, options)) return undefined;
  return cloneSkillDescriptor(skill);
}

export function getLoadedSkillContract(
  id?: string,
  options?: SkillCatalogOptions,
): LoadedSkillContract | null {
  if (!id) return null;
  const descriptor = getSkillDescriptor(id, options);
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
  options?: SkillCatalogOptions,
): SkillToolPolicy | null {
  const descriptor = getSkillDescriptor(id || "", options);
  if (!descriptor) return null;
  return {
    preferredTools: normalizeSkillTools(descriptor.preferredTools),
    discouragedTools: normalizeSkillTools(descriptor.discouragedTools),
  };
}

function hasCapability(
  descriptor: SkillDescriptor,
  capability: SkillCapability,
): boolean {
  return descriptor.capabilityNeeds?.includes(capability) ?? false;
}

function hasCommunicationWriteIntent(text: string): boolean {
  return (
    /\b(reply|respond|post|send|compose|write back)\b/i.test(text) ||
    /\bdraft\b[^.\n]{0,80}\b(reply|email|e-mail|message|comment|response)\b/i.test(
      text,
    ) ||
    /\b(reply|email|e-mail|message|comment|response)\b[^.\n]{0,80}\bdraft\b/i.test(
      text,
    ) ||
    /\bwrite\b[^.\n]{0,60}\b(message|comment|reply|response)\b/i.test(text)
  );
}

function hasRecordMutationIntent(text: string): boolean {
  return (
    /\b(update|set|change|assign|reassign|escalate|save|submit|mark|close|reopen)\b[^.\n]{0,100}\b(ticket|case|record|status|priority|assignee|owner|category|tag|field|escalation)\b/i.test(
      text,
    ) ||
    /\b(add|write|post)\b[^.\n]{0,80}\b(internal note|note|comment)\b/i.test(
      text,
    )
  );
}

function hasServiceNowRecordSubmitIntent(text: string): boolean {
  if (
    /\b(?:submit the form|form submission completes|submitted record|created record|created\/updated record|confirmation|resulting item page)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  if (
    /\b(?:do not submit|not submit|ready to submit|submit action has not been clicked|has not been submitted)\b/i.test(
      text,
    )
  ) {
    return false;
  }

  return /\bcreate\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:incident|change request|problem|record|user|hardware asset|asset)\b/i.test(
    text,
  );
}

export function resolveSkillToolProfile(
  id: string | null | undefined,
  objective: string,
  successCriteria: string,
  currentProfile?: ToolProfile,
  options?: SkillCatalogOptions,
): ToolProfile | undefined {
  const descriptor = getSkillDescriptor(id || "", options);
  if (!descriptor) return currentProfile;

  const text = `${objective}\n${successCriteria}`;

  if (descriptor.id === "catalog-order-workflow") {
    return "full";
  }

  if (descriptor.id === "servicenow-module-navigation") {
    return "navigate";
  }

  if (descriptor.id === "servicenow-record-form") {
    return hasServiceNowRecordSubmitIntent(text) ? "submit_form" : "form_fill";
  }

  if (
    descriptor.id === "progressive-repeatable-form" ||
    descriptor.id === "multi-step-form-wizard"
  ) {
    return "form_fill";
  }

  if (
    (hasCapability(descriptor, "compose_response") ||
      hasCapability(descriptor, "submit_response")) &&
    hasCommunicationWriteIntent(text)
  ) {
    return "submit_form";
  }

  if (
    (hasCapability(descriptor, "update_record") ||
      hasCapability(descriptor, "add_note")) &&
    hasRecordMutationIntent(text)
  ) {
    return "form_fill";
  }

  if (descriptor.id === "list-filter-workflow") {
    return "form_fill";
  }

  if (descriptor.id === "list-sort-workflow") {
    return "form_fill";
  }

  if (descriptor.id === "chart-value-extraction") {
    return "read_only";
  }

  return currentProfile;
}

const SKILL_TOOL_SUPPRESSION_POLICIES: Record<
  string,
  SkillToolSuppressionPolicy
> = {
  "structured-form-fill": {
    temporarilySuppressedTools: [
      ToolName.PRESS_KEY,
      ToolName.XRAY_PAGE,
      ToolName.CLICK_COORDINATES,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
  "progressive-repeatable-form": {
    temporarilySuppressedTools: [
      ToolName.NAVIGATE,
      ToolName.OPEN_SERVICENOW_MODULE,
      ToolName.GO_BACK,
      ToolName.CREATE_TAB,
      ToolName.LIST_TABS,
      ToolName.INSPECT_HIDDEN,
      ToolName.XRAY_PAGE,
      ToolName.PRESS_KEY,
      ToolName.CLICK_COORDINATES,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
  "multi-step-form-wizard": {
    temporarilySuppressedTools: [
      ToolName.NAVIGATE,
      ToolName.OPEN_SERVICENOW_MODULE,
      ToolName.GO_BACK,
      ToolName.CREATE_TAB,
      ToolName.LIST_TABS,
      ToolName.INSPECT_HIDDEN,
      ToolName.XRAY_PAGE,
      ToolName.PRESS_KEY,
      ToolName.CLICK_COORDINATES,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
  "servicenow-record-form": {
    temporarilySuppressedTools: [
      ToolName.CLICK_ELEMENT,
      ToolName.PRESS_KEY,
      ToolName.CLICK_COORDINATES,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
      ToolName.CONFIGURE_SERVICENOW_FORM,
    ],
  },
  "inline-edit-surface": {
    temporarilySuppressedTools: [ToolName.CLICK_COORDINATES],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
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
    ],
  },
  "multi-tab-checklist-workflow": {
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
    ],
  },
  "paginated-table-scan": {
    temporarilySuppressedTools: [
      ToolName.NAVIGATE,
      ToolName.GO_BACK,
      ToolName.READ_ELEMENT,
      ToolName.FIND_ELEMENT,
      ToolName.TYPE_TEXT,
      ToolName.PRESS_KEY,
      ToolName.SELECT_OPTION,
      ToolName.SET_CHECKBOX,
      ToolName.SCROLL_PAGE,
      ToolName.INSPECT_HIDDEN,
      ToolName.XRAY_PAGE,
      ToolName.EXECUTE_JS,
      ToolName.CLICK_COORDINATES,
      ToolName.CREATE_TAB,
      ToolName.LIST_TABS,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
    ],
  },
  "paginated-record-lookup": {
    temporarilySuppressedTools: [
      ToolName.NAVIGATE,
      ToolName.GO_BACK,
      ToolName.READ_ELEMENT,
      ToolName.PRESS_KEY,
      ToolName.INSPECT_HIDDEN,
      ToolName.XRAY_PAGE,
      ToolName.EXECUTE_JS,
      ToolName.CLICK_COORDINATES,
      ToolName.CREATE_TAB,
      ToolName.LIST_TABS,
    ],
    exemptTools: [
      ToolName.DONE,
      ToolName.ESCALATE,
      ToolName.CLARIFY,
      ToolName.UPDATE_NOTES,
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
    ],
  },
};

export function getSkillToolSuppressionPolicy(
  id?: string,
  options?: SkillCatalogOptions,
): SkillToolSuppressionPolicy | null {
  if (!id) return null;
  if (!getSkillDescriptor(id, options)) return null;
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

  if (contract.requiredEvidenceTypes?.length) {
    lines.push(
      "Required typed evidence:",
      ...contract.requiredEvidenceTypes.map((item) => `- ${item}`),
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

function selectPrimarySkillWithKeywordMatcher(
  input: SkillMatcherInput,
): SkillSelection | null {
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
  const currentStepLooksLikeContinuationRevision =
    continuationPattern.test(corpus) &&
    continuationArtifactPattern.test(corpus) &&
    continuationRevisionPattern.test(corpus) &&
    !gridEditPattern.test(stepCorpus) &&
    !crmTicketPattern.test(corpus);
  const currentStepLooksLikeFormFill =
    (formPattern.test(stepCorpus) &&
      /\b(fill|form|field|dropdown|checkbox|input|email|name|phone|category|budget)\b/i.test(
        stepCorpus,
      )) ||
    configuratorPattern.test(stepCorpus);
  const currentStepLooksLikeProgressiveRepeatableForm =
    progressiveRepeatableFormPattern.test(stepCorpus) ||
    (progressiveRepeatableFormPattern.test(corpus) &&
      /\b(?:fill|add|create|section|entry|row|item|role|experience|education|address|dependent|field)\b/i.test(
        stepCorpus,
      ));
  const currentStepLooksLikeMultiStepFormWizard =
    multiStepFormWizardPattern.test(stepCorpus) ||
    ((multiStepFormWizardPattern.test(corpus) ||
      conditionalFormPattern.test(corpus)) &&
      /\b(?:fill|form|field|request|application|enrollment|intake|continue|next|review|submit|confirm|checkbox|select|radio)\b/i.test(
        stepCorpus,
      ));
  const currentStepNeedsTransactionalCheck =
    transactionPattern.test(stepCorpus);
  const matchesMultiTabChecklistWorkflow =
    naturalProcurementChecklistPattern.test(corpus) ||
    procurementLoopPattern.test(corpus) ||
    (/\b(procurement list|store)\b/i.test(corpus) &&
      /\b(new tab|another tab)\b/i.test(corpus) &&
      /\b(buy|purchase)\b/i.test(corpus) &&
      /\b(check off|mark .* done|checkbox)\b/i.test(corpus)) ||
    (explicitTabIntentPattern.test(corpus) &&
      sourceListLoopPattern.test(corpus) &&
      repeatedItemPattern.test(corpus) &&
      sourceProgressPattern.test(corpus));

  if (
    fieldValueRecordFormPattern.test(corpus) &&
    serviceNowRecordFormPattern.test(corpus) &&
    !listFilterPattern.test(corpus) &&
    !listSortPattern.test(corpus) &&
    !catalogOrderPattern.test(corpus)
  ) {
    const selection = selectEnabledSkill(
      input,
      "servicenow-record-form",
      "Task contains explicit ServiceNow record field/value pairs and should use deterministic form configuration and submit evidence.",
    );
    if (selection) return selection;
  }

  if (currentStepLooksLikeProgressiveRepeatableForm) {
    const selection = selectEnabledSkill(
      input,
      "progressive-repeatable-form",
      "Current step targets repeated/progressive form groups and should count, add, map, fill, and verify groups by index or label.",
    );
    if (selection) return selection;
  }

  if (currentStepLooksLikeMultiStepFormWizard) {
    const selection = selectEnabledSkill(
      input,
      "multi-step-form-wizard",
      "Current step targets a multi-step or conditional form and should fill visible fields, re-ground after transitions, handle revealed fields, review, and submit when requested.",
    );
    if (selection) return selection;
  }

  if (jobApplicationPattern.test(corpus)) {
    const selection = selectEnabledSkill(
      input,
      "job-application-assistant",
      "Task is a job application workflow and should prepare, verify, and approval-gate final submission.",
    );
    if (selection) return selection;
  }

  if (
    catalogOrderPattern.test(corpus) &&
    /\b(order|request|catalog|quantity|configure|cart|hardware|software|item)\b/i.test(
      corpus,
    )
  ) {
    const selection = selectEnabledSkill(
      input,
      "catalog-order-workflow",
      "Task requires configuring and ordering a catalog item through request or order confirmation.",
    );
    if (selection) return selection;
  }

  if (
    consequentialActionConsentPattern.test(corpus) &&
    finalConsequentialActionPattern.test(stepCorpus)
  ) {
    const selection = selectEnabledSkill(
      input,
      "consequential-action-consent",
      "Current step includes a final consequential action with approval or prepare-only policy, so final execution must be consent-gated.",
    );
    if (selection) return selection;
  }

  if (chartValuePattern.test(corpus) && chartValueIntentPattern.test(corpus)) {
    const selection = selectEnabledSkill(
      input,
      "chart-value-extraction",
      "Task asks for a concrete value from a chart or dashboard and should use structured chart evidence before answering.",
    );
    if (selection) return selection;
  }

  if (
    listFilterPattern.test(corpus) &&
    /\b(list|table|records?|rows?|incidents?|tickets?|results?|filter)\b/i.test(
      corpus,
    )
  ) {
    const selection = selectEnabledSkill(
      input,
      "list-filter-workflow",
      "Task requires applying a list or table filter and verifying the applied filtered state.",
    );
    if (selection) return selection;
  }

  if (
    listSortPattern.test(corpus) &&
    /\b(list|table|records?|rows?|incidents?|tickets?|results?|column|order by)\b/i.test(
      corpus,
    )
  ) {
    const selection = selectEnabledSkill(
      input,
      "list-sort-workflow",
      "Task requires sorting a list or table and verifying the resulting sort state.",
    );
    if (selection) return selection;
  }

  if (matchesMultiTabChecklistWorkflow) {
    const selection = selectEnabledSkill(
      input,
      "multi-tab-checklist-workflow",
      "Task requires repeating a source-list workflow across tabs: open or reuse a target tab, complete or capture item evidence, return to the source, and record progress.",
    );
    if (selection) return selection;
  }

  if (
    searchAnswerPattern.test(corpus) &&
    /\b(answer|article|knowledge|result|search|find|look up|question)\b/i.test(
      corpus,
    )
  ) {
    const selection = selectEnabledSkill(
      input,
      "search-answer-extraction",
      "Task requires searching or reading a knowledge source and returning the requested answer, not just opening a result.",
    );
    if (selection) return selection;
  }

  if (
    serviceNowModuleNavigationPattern.test(corpus) &&
    /\b(module|application navigator)\b/i.test(corpus)
  ) {
    const selection = selectEnabledSkill(
      input,
      "servicenow-module-navigation",
      "Task requires opening a ServiceNow application module and should resolve the module target directly from ServiceNow metadata.",
    );
    if (selection) return selection;
  }

  if (
    paginatedDataSurfacePattern.test(corpus) &&
    tableAggregateIntentPattern.test(corpus)
  ) {
    const selection = selectEnabledSkill(
      input,
      "paginated-table-scan",
      "Task asks for an aggregate value from a table, directory, or paginated data surface and needs exhaustive row coverage before answering.",
    );
    if (selection) return selection;
  }

  if (
    overlayRecoveryPattern.test(stepCorpus) ||
    (overlayRecoveryPattern.test(corpus) &&
      !currentStepLooksLikeInlineEdit &&
      !currentStepLooksLikeFormFill &&
      !currentStepNeedsTransactionalCheck)
  ) {
    const selection = selectEnabledSkill(
      input,
      "modal-overlay-recovery",
      "Task requires dismissing blocking overlays before the underlying content is accessible.",
    );
    if (selection) return selection;
  }

  if (
    hoverRevealPattern.test(corpus) &&
    /\b(menu|tooltip|reveal|hover|dropdown|flyout)\b/i.test(corpus)
  ) {
    const selection = selectEnabledSkill(
      input,
      "hover-reveal-navigation",
      "Task depends on revealing a hidden menu or tooltip through hover before acting.",
    );
    if (selection) return selection;
  }

  if (currentStepLooksLikeInlineEdit) {
    const selection = selectEnabledSkill(
      input,
      "inline-edit-surface",
      "Current step edits a value directly inside an inline editor, grid cell, table row, or rename surface.",
    );
    if (selection) return selection;
  }

  if (currentStepLooksLikeContinuationRevision) {
    const selection = selectEnabledSkill(
      input,
      "continuation-edit",
      "Task requests revising prior work while preserving earlier intent.",
    );
    if (selection) return selection;
  }

  if (emailReplyPattern.test(corpus)) {
    const selection = selectEnabledSkill(
      input,
      "email-reply-careful",
      "Task requires drafting or sending an email reply with recipient, source context, language, and tone checks.",
    );
    if (selection) return selection;
  }

  if (threadMessagePattern.test(corpus)) {
    const selection = selectEnabledSkill(
      input,
      "thread-message-careful",
      "Task requires posting a grounded reply in a message or thread while preserving audience, language, and tone context.",
    );
    if (selection) return selection;
  }

  if (crmTicketPattern.test(corpus)) {
    const selection = selectEnabledSkill(
      input,
      "crm-ticket-update",
      "Task requires updating a CRM or support ticket record after reading case context and verifying field or note changes.",
    );
    if (selection) return selection;
  }

  if (
    continuationPattern.test(corpus) &&
    continuationArtifactPattern.test(corpus) &&
    !gridEditPattern.test(stepCorpus) &&
    !crmTicketPattern.test(corpus)
  ) {
    const selection = selectEnabledSkill(
      input,
      "continuation-edit",
      "Task requests revising prior work while preserving earlier intent.",
    );
    if (selection) return selection;
  }

  if (budgetPattern.test(corpus)) {
    const selection = selectEnabledSkill(
      input,
      "budget-aware-execution",
      "Task context explicitly calls for conserving remaining turns and avoiding blind retries.",
    );
    if (selection) return selection;
  }

  const explicitListDetailLoop =
    listDetailReviewPattern.test(corpus) &&
    listReturnPattern.test(corpus) &&
    /\b(detail|details|view details|open)\b/i.test(corpus);
  const naturalListDetailRecommendation =
    listReviewSurfacePattern.test(corpus) &&
    listRecommendationIntentPattern.test(corpus) &&
    /\b(review|evaluate|compare|recommend|rank|best matches?|best fit|which (?:ones|jobs|listings))\b/i.test(
      corpus,
    );
  if (explicitListDetailLoop || naturalListDetailRecommendation) {
    const selection = selectEnabledSkill(
      input,
      "list-detail-review-loop",
      explicitListDetailLoop
        ? "Task requires reviewing multiple visible list items by opening each detail view and returning to the list in sequence."
        : "Task requires reviewing visible list items and grounding a recommendation in item-level detail facts.",
    );
    if (selection) return selection;
  }

  if (
    paginatedDataSurfacePattern.test(corpus) &&
    paginatedRecordLookupIntentPattern.test(corpus)
  ) {
    const selection = selectEnabledSkill(
      input,
      "paginated-record-lookup",
      "Task asks for a specific record or item from a paginated, searchable, or list-like data surface and should verify the exact target before extracting the requested field.",
    );
    if (selection) return selection;
  }

  if (comparePattern.test(corpus)) {
    const selection = selectEnabledSkill(
      input,
      "cross-tab-compare",
      "Comparison-oriented task spans multiple tabs or pages.",
    );
    if (selection) return selection;
  }

  if (
    navigateReturnPattern.test(corpus) &&
    /\b(return|come back|go back|round.?trip|then)\b/i.test(corpus)
  ) {
    const selection = selectEnabledSkill(
      input,
      "navigate-read-return",
      "Task requires navigating to a target page, extracting information, and returning.",
    );
    if (selection) return selection;
  }

  if (configuratorPattern.test(stepCorpus)) {
    const selection = selectEnabledSkill(
      input,
      "structured-form-fill",
      "Current step configures product options and must verify the derived total or summary before completion.",
    );
    if (selection) return selection;
  }

  if (
    profileFieldPattern.test(stepCorpus) &&
    /\b(fill|checkout|form|field|name|email|submit|place order)\b/i.test(
      stepCorpus,
    )
  ) {
    const selection = selectEnabledSkill(
      input,
      "structured-form-fill",
      "Current step requires filling form fields from saved profile data before submission.",
    );
    if (selection) return selection;
  }

  if (currentStepNeedsTransactionalCheck) {
    const selection = selectEnabledSkill(
      input,
      "transactional-act-check-act",
      "Current step requires an action followed by explicit intermediate verification.",
    );
    if (selection) return selection;
  }

  if (cartPattern.test(stepCorpus) || cartPattern.test(corpus)) {
    const selection = selectEnabledSkill(
      input,
      "cart-modify-checkout",
      "Task modifies an in-progress shopping or checkout state before completion.",
    );
    if (selection) return selection;
  }

  if (currentStepLooksLikeFormFill) {
    const selection = selectEnabledSkill(
      input,
      "structured-form-fill",
      "Task requires disciplined multi-field form entry before submission.",
    );
    if (selection) return selection;
  }

  if (transactionPattern.test(corpus)) {
    const selection = selectEnabledSkill(
      input,
      "transactional-act-check-act",
      "Task requires an action followed by explicit intermediate verification.",
    );
    if (selection) return selection;
  }

  return null;
}

export class KeywordSkillMatcher implements SkillMatcher {
  match(input: SkillMatcherInput): SkillSelection | null {
    return selectPrimarySkillWithKeywordMatcher(input);
  }
}

export const keywordSkillMatcher = new KeywordSkillMatcher();

export function selectPrimarySkill(
  input: SkillMatcherInput,
): SkillSelection | null {
  if (input.candidateSkillIds) return keywordSkillMatcher.match(input);

  const candidateSkillIds = resolveEligibleSkillCandidates(input).map(
    (candidate) => candidate.skill.id,
  );
  return keywordSkillMatcher.match({ ...input, candidateSkillIds });
}
