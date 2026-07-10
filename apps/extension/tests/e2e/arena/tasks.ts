export type ArenaTier = "easy" | "medium" | "hard";

export type ArenaValidatorKind =
  | "dom-state"
  | "final-answer"
  | "fixture-state"
  | "trace-diagnostic";

export interface ArenaTask {
  id: string;
  title: string;
  tier: ArenaTier;
  /** Relative to apps/extension/tests/e2e; may be a focused spec or fixture route source. */
  sourceFile: string;
  sourceCase: string;
  startRoute: string;
  prompt: string;
  maxTurns: number;
  tags: readonly string[];
  validator: string;
  validatorKind: ArenaValidatorKind;
  description: string;
  timeoutMs: number;
  allowNavigation?: boolean;
  notes?: string;
}

export const ARENA_TASKS: readonly ArenaTask[] = [
  {
    id: "support-ticket.triage-timeout-export",
    title: "Triage Support Ticket",
    tier: "easy",
    sourceFile: "fixtures/online-shop-pro/src/routes/support-ticket.tsx",
    sourceCase: "reads ticket, changes status, and adds internal comment",
    startRoute: "/support-ticket",
    prompt:
      "Set ticket TICKET-4271 to In Progress and add an internal note summarizing the issue and next steps.",
    maxTurns: 20,
    timeoutMs: 240_000,
    tags: ["record-update", "form", "workarena-like", "support", "workarena-category:form"],
    validator: "supportTicketTriaged",
    validatorKind: "fixture-state",
    description:
      "Reads a ticket, applies the correct status, and leaves an internal note grounded in the issue.",
  },
  {
    id: "multi-step-form.enterprise-request",
    title: "Complete Enterprise Request",
    tier: "easy",
    sourceFile: "fixtures/online-shop-pro/src/routes/form.tsx",
    sourceCase: "agent completes a 3-step wizard with conditional fields",
    startRoute: "/form",
    prompt:
      "Submit an enterprise request for Jane Smith at jane@example.com, phone 555-0123, company Acme Corp, premium budget, with Priority support needed as the special requirement.",
    maxTurns: 30,
    timeoutMs: 300_000,
    tags: ["form", "wizard", "conditional-fields", "workarena-like", "workarena-category:form"],
    validator: "enterpriseFormSubmitted",
    validatorKind: "fixture-state",
    description:
      "Completes a conditional multi-step form and verifies the submitted confirmation state.",
  },
  {
    id: "data-table.find-diana-salary",
    title: "Find Employee Salary",
    tier: "easy",
    sourceFile: "fixtures/online-shop-pro/src/routes/data-table.tsx",
    sourceCase: "agent navigates paginated table to find employee and extract salary",
    startRoute: "/data-table",
    prompt: "Search for Diana in the employee directory and tell me her salary.",
    maxTurns: 30,
    timeoutMs: 240_000,
    tags: ["table", "pagination", "lookup", "workarena-like", "workarena-category:list-filter"],
    validator: "dianaSalaryFound",
    validatorKind: "fixture-state",
    description:
      "Searches across paginated table data and returns the requested employee fact.",
  },
  {
    id: "article-research.footnote-source",
    title: "Find Article Source",
    tier: "medium",
    sourceFile: "fixtures/online-shop-pro/src/routes/article.tsx",
    sourceCase: "agent scrolls to find the Footnote 2 source and reports it",
    startRoute: "/article",
    prompt:
      "Find the source referenced by Footnote 2 in the article and tell me what source it cites.",
    maxTurns: 12,
    timeoutMs: 120_000,
    tags: ["research", "evidence", "scrolling", "final-answer", "workarena-category:information_retrieval"],
    validator: "articleFootnoteSourceAnswered",
    validatorKind: "final-answer",
    description:
      "Requires reading through a long page and reporting a specific cited source.",
  },
  {
    id: "tab-management.dashboard-metrics",
    title: "Compare Dashboard Metrics",
    tier: "medium",
    sourceFile: "fixtures/online-shop-pro/src/routes/dashboard-sales.tsx",
    sourceCase: "collects data from multiple dashboard tabs",
    startRoute: "/dashboard-sales",
    prompt:
      "Get the Open Tickets number from the support dashboard and the Active Campaigns number from the marketing dashboard, then tell me both numbers.",
    maxTurns: 25,
    timeoutMs: 240_000,
    allowNavigation: true,
    tags: ["multi-tab", "dashboard", "lookup", "planning", "workarena-category:dashboard"],
    validator: "dashboardMetricsAnswered",
    validatorKind: "final-answer",
    description:
      "Collects facts from separate dashboards without prescribing the tab strategy.",
    notes:
      "Arena variant removes the current procedural instruction to open each dashboard in a new tab.",
  },
  {
    id: "procurement.complete-first-two",
    title: "Complete Procurement Items",
    tier: "hard",
    sourceFile: "fixtures/online-shop-pro/src/routes/procurement-list.tsx",
    sourceCase: "processes procurement list across multiple tabs",
    startRoute: "/procurement",
    prompt:
      "Buy the first two items from the procurement list and mark them complete.",
    maxTurns: 40,
    timeoutMs: 480_000,
    allowNavigation: true,
    tags: ["workflow", "multi-tab", "planning", "workarena-like", "workarena-category:service catalog"],
    validator: "firstTwoProcurementItemsComplete",
    validatorKind: "fixture-state",
    description:
      "Completes a multi-record purchasing workflow while preserving state across pages.",
    notes:
      "Arena variant removes the current procedural instruction to open stores in new tabs.",
  },
  {
    id: "job-board.recommend-best-matches",
    title: "Recommend Job Matches",
    tier: "hard",
    sourceFile: "fixtures/online-shop-pro/src/routes/job-board.tsx",
    sourceCase: "reviews all job listings and recommends best matches for profile",
    startRoute: "/job-board",
    prompt:
      "I'm a senior frontend engineer with 5 years of experience specializing in React and TypeScript. I also have strong experience with Node.js and GraphQL. I'm looking for a fully remote position in the $120K-$160K salary range. Review the job listings and tell me which ones are the best matches for my profile and why.",
    maxTurns: 45,
    timeoutMs: 660_000,
    tags: [
      "long-horizon",
      "research",
      "planning",
      "recommendation",
      "workarena-category:planning_and_problem_solving",
      "workarena-category:sophisticated_memory",
    ],
    validator: "jobRecommendationsGrounded",
    validatorKind: "fixture-state",
    description:
      "Reviews a noisy list of opportunities and recommends relevant matches using gathered evidence.",
    notes:
      "Arena variant removes the current instruction to click into every listing and come back.",
  },
  {
    id: "online-shop.boundary-checkout",
    title: "Complete Checkout With Planning Boundaries",
    tier: "hard",
    sourceFile: "fixtures/online-shop-pro/src/routes/shop.tsx",
    sourceCase: "advances shopping steps without done() rejection churn",
    startRoute: "/shop",
    prompt:
      "Order the Novablast 4 in size 10, apply coupon SAVE10, choose standard shipping, and check out as alex@example.com.",
    maxTurns: 30,
    timeoutMs: 300_000,
    tags: ["checkout", "planning", "node-isolation", "workflow"],
    validator: "singleOrderPlaced",
    validatorKind: "fixture-state",
    description:
      "Completes checkout while diagnostics verify planner boundaries and duplicate-completion behavior.",
    notes:
      "Task success should remain the completed order; trace diagnostics are secondary planning metrics.",
  },
  {
    id: "workarena-gap.crm-ticket-escalation",
    title: "Escalate Ticket With Account Context",
    tier: "hard",
    sourceFile: "fixtures/online-shop-pro/src/routes/support-ticket.tsx",
    sourceCase: "reads ticket, changes status, and adds internal comment",
    startRoute: "/support-ticket",
    prompt:
      "Review TICKET-4271. If it needs escalation, set the ticket status to In Progress, raise the priority to Urgent, and leave an internal note with the customer impact, account context, and next step.",
    maxTurns: 30,
    timeoutMs: 360_000,
    tags: ["workarena-gap", "crm", "ticket", "record-update", "document"],
    validator: "ticketEscalatedWithAccountContext",
    validatorKind: "fixture-state",
    description:
      "Combines record review, priority/status update, and grounded internal documentation.",
  },
  {
    id: "workarena-gap.email-meeting-reply",
    title: "Reply To Meeting Request",
    tier: "hard",
    sourceFile: "fixtures/online-shop-pro/src/routes/email-compose.tsx",
    sourceCase: "agent reads email, composes contextual reply, and sends it",
    startRoute: "/email-compose",
    prompt:
      "Reply to David confirming Friday at 10 AM for the Q3 strategy review, and briefly acknowledge the main agenda items from his email.",
    maxTurns: 30,
    timeoutMs: 360_000,
    tags: ["workarena-gap", "email", "document", "crm", "communication"],
    validator: "emailMeetingReplySent",
    validatorKind: "fixture-state",
    description:
      "Reads a business email and sends a grounded reply with scheduling and agenda details.",
  },
  {
    id: "workarena-gap.chat-release-coordination",
    title: "Answer Release Coordination Thread",
    tier: "hard",
    sourceFile: "fixtures/online-shop-pro/src/routes/team-chat.tsx",
    sourceCase: "agent reads thread context and posts a grounded reply",
    startRoute: "/team-chat",
    prompt:
      "Reply in the project-updates channel with a concise release coordination update: answer Sarah's timing question from the conversation, say who should draft the changelog, and mention the remaining blocker.",
    maxTurns: 35,
    timeoutMs: 420_000,
    tags: ["workarena-gap", "chat", "workflow", "document", "coordination"],
    validator: "releaseCoordinationReplySent",
    validatorKind: "fixture-state",
    description:
      "Synthesizes a noisy team thread into an actionable coordination reply.",
  },
  {
    id: "workarena-gap.messaging-cost-plan-reply",
    title: "Reply With Migration Report Plan",
    tier: "hard",
    sourceFile: "fixtures/online-shop-pro/src/routes/messaging-thread.tsx",
    sourceCase: "agent reads message thread and sends a contextual reply",
    startRoute: "/messaging-thread",
    prompt:
      "Reply to Lisa in the Cloud-Migration Team thread. Confirm that the Friday update should include a progress summary, a revised cost plan, and Markus owning the technical part.",
    maxTurns: 35,
    timeoutMs: 420_000,
    tags: ["workarena-gap", "messaging", "crm", "document", "coordination"],
    validator: "migrationPlanReplySent",
    validatorKind: "fixture-state",
    description:
      "Reads a business message thread and sends a reply that preserves owners, deadline, and deliverables.",
  },
  {
    id: "workarena-gap.kanban-docs-ci-priority",
    title: "Prioritize Release Board Cards",
    tier: "hard",
    sourceFile: "fixtures/online-shop-pro/src/routes/kanban.tsx",
    sourceCase: "agent moves cards on a kanban board",
    startRoute: "/kanban",
    prompt:
      "The release needs documentation and CI work started. Move the API docs card and the CI pipeline card into In Progress.",
    maxTurns: 35,
    timeoutMs: 420_000,
    tags: ["workarena-gap", "workflow", "kanban", "planning", "record-update"],
    validator: "releaseBoardPrioritiesMoved",
    validatorKind: "fixture-state",
    description:
      "Updates a work board from a natural priority request without prescribing drag mechanics.",
  },
  {
    id: "workarena-gap.document-footnote-brief",
    title: "Prepare Document Research Brief",
    tier: "hard",
    sourceFile: "fixtures/online-shop-pro/src/routes/article.tsx",
    sourceCase: "agent scrolls to find a footnote source and reports it",
    startRoute: "/article",
    prompt:
      "Prepare a short note for the team: identify the source cited in Footnote 2 and include one documentation practice from the article that relates to remote-team work.",
    maxTurns: 20,
    timeoutMs: 240_000,
    tags: [
      "workarena-gap",
      "document",
      "research",
      "evidence",
      "final-answer",
      "workarena-category:knowledge",
    ],
    validator: "documentFootnoteBriefAnswered",
    validatorKind: "final-answer",
    description:
      "Combines document research, evidence grounding, and concise written synthesis.",
  },
  {
    id: "workarena-category.menu-product-lookup",
    title: "Use Product Menu And SKU Lookup",
    tier: "medium",
    sourceFile: "hover-menus.test.ts",
    sourceCase: "agent hovers to reveal menu, selects category, reads tooltip SKU, and searches",
    startRoute: "/hover-menus",
    prompt:
      "Open the product menu, choose Electronics, find the SKU for Widget X, and search for that SKU.",
    maxTurns: 25,
    timeoutMs: 240_000,
    tags: ["workarena-category", "menu", "lookup", "workarena-category:menu"],
    validator: "hoverMenuProductLookup",
    validatorKind: "fixture-state",
    description:
      "Covers menu navigation plus a small lookup/search action without relying on hidden selectors.",
  },
  {
    id: "workarena-category.highest-salary-analysis",
    title: "Analyze Employee Salary Records",
    tier: "hard",
    sourceFile: "fixtures/online-shop-pro/src/routes/data-table.tsx",
    sourceCase: "agent navigates paginated table and compares records",
    startRoute: "/data-table",
    prompt:
      "Review the employee directory and tell me which employee has the highest salary and what that salary is.",
    maxTurns: 40,
    timeoutMs: 480_000,
    tags: [
      "workarena-category",
      "table",
      "reasoning",
      "records",
      "workarena-category:data_driven_decision_making_and_reasoning",
      "workarena-category:list-sort",
    ],
    validator: "highestSalaryAnswered",
    validatorKind: "final-answer",
    description:
      "Covers data-driven reasoning over a paginated record set and a sort-like comparison objective.",
  },
  {
    id: "workarena-category.infeasible-workspace-choice",
    title: "Recognize Missing Workspace Context",
    tier: "medium",
    sourceFile: "clarification-recovery.test.ts",
    sourceCase: "agent should not choose when required context is absent",
    startRoute: "/workspace-choice",
    prompt:
      "Open the workspace I should use for this project.",
    maxTurns: 15,
    timeoutMs: 180_000,
    tags: [
      "workarena-category",
      "clarification",
      "infeasible",
      "workarena-category:contextual_understanding_infeasible_tasks",
      "workarena-category:uncategorized",
    ],
    validator: "workspaceChoiceDeferred",
    validatorKind: "fixture-state",
    description:
      "Covers contextual infeasibility: the correct action is to avoid guessing and ask for missing context.",
  },
  {
    id: "visual-canvas-small.fine-print-margin",
    title: "Read Canvas Fine Print",
    tier: "medium",
    sourceFile: "fixtures/online-shop-pro/src/routes/visual-canvas-small.tsx",
    sourceCase: "agent magnifies 8px canvas fine print to read a metric",
    startRoute: "/visual-canvas-small",
    prompt:
      "Read the fine print under the chart and tell me the Q3 net margin.",
    maxTurns: 12,
    timeoutMs: 240_000,
    tags: ["visual", "canvas", "region-zoom", "lp-13"],
    validator: "canvasFinePrintAnswered",
    validatorKind: "final-answer",
    description:
      "The value exists only as 8px canvas pixels (no DOM/aria text) — requires inspect_region magnification.",
  },
  {
    id: "job-pipeline.stage-two-applications",
    title: "Stage Two Job Applications",
    tier: "hard",
    sourceFile: "fixtures/online-shop-pro/src/routes/job-board.tsx",
    sourceCase: "picks best matches and stages applications in separate tabs",
    startRoute: "/job-board",
    prompt:
      "I'm a senior frontend engineer with 5 years of experience specializing in React and TypeScript, with strong Node.js and GraphQL experience, looking for a fully remote position in the $120K–$160K range. Review the job listings, pick the two best matches for my profile, and start an application for each in its own new tab — you have my permission to open tabs, no need to ask. Fill in every field using my details: Name: Jordan Reyes, Email: jordan.reyes@example.com, LinkedIn: https://www.linkedin.com/in/jordanreyes, Phone: +1 555 010 0199, Current Location: Denver, CO, EU Work Permit: No, Salary Expectation: $120,000–$160,000 depending on role, Earliest Start Date: 2026-08-03. For the 'why do you care' question write 2–3 sentences grounded in that job's posting. Leave the Resume/CV upload empty — I'll attach that myself — and do NOT submit either application; leave both ready for me to review and send.",
    // Budget: board research alone measures ~30-40 turns (the solo job-board
    // task passed at 42), and each application form costs ~15 more — run 2
    // completed research + one full form in 57 turns before running dry.
    maxTurns: 80,
    timeoutMs: 1_080_000,
    allowNavigation: true,
    tags: [
      "long-horizon",
      "multi-tab",
      "form",
      "planning",
      "recommendation",
      "workarena-category:planning_and_problem_solving",
    ],
    validator: "twoApplicationsStagedNotSubmitted",
    validatorKind: "fixture-state",
    description:
      "Full research→decide→stage pipeline: reads the board, opens the two best-match applications in separate tabs, fills all fields except the CV upload, and stops short of submitting.",
  },
];

export function getArenaTask(id: string): ArenaTask | undefined {
  return ARENA_TASKS.find((task) => task.id === id);
}

export function getArenaTasksByTier(tier: ArenaTier): ArenaTask[] {
  return ARENA_TASKS.filter((task) => task.tier === tier);
}

export function getArenaTasksByTag(tag: string): ArenaTask[] {
  return ARENA_TASKS.filter((task) => task.tags.includes(tag));
}

export function getArenaTags(): string[] {
  return [...new Set(ARENA_TASKS.flatMap((task) => task.tags))].sort();
}
