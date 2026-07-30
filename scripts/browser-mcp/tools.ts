/**
 * Thick, intent-level browser tools (RFC LP-8, M2 "The Bridge").
 *
 * These are deliberately NOT DOM primitives (`click`, `type`). Each tool maps to
 * a full internal `AgentLoop` run inside the OpenSidebar extension — the caller
 * issues one intent and gets one result. This keeps the strategic/tactical
 * boundary clean: the external brain decides *what*, OpenSidebar owns *how*.
 *
 * `mechanical` tools are direct page operations; `intent` tools wrap a multi-turn
 * agent run that may return `needs_human` (CAPTCHA/auth/ambiguity).
 */

export interface BrowserToolDef {
  name: string;
  kind: "mechanical" | "intent";
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

const TASK_FIRST_TOOLS: BrowserToolDef[] = [
  {
    name: "get_active_browser_tab",
    kind: "mechanical",
    description:
      "Return the active Chrome tab id, URL, title, and window id directly from the extension without invoking a model or opening a tab.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "delegate_browser_task",
    kind: "intent",
    description:
      "Delegate a complete bounded browser goal to OpenSidebar's autonomous agent runtime. Returns a task_id immediately.",
    inputSchema: {
      type: "object",
      properties: {
        goal: {
          type: "string",
          description: "Complete browser outcome to achieve.",
        },
        context: {
          type: "string",
          description: "Optional trusted task context.",
        },
        constraints: {
          type: "array",
          description: "Explicit behavioral constraints.",
        },
        preferred_tab_id: {
          type: "number",
          description: "Existing tab to prefer.",
        },
        allowed_domains: {
          type: "array",
          description: "Hostnames the task may navigate to.",
        },
        approval_policy: {
          type: "object",
          description:
            "Mandatory-checkpoint policy and whether exact approvals may be relayed.",
        },
        max_steps: { type: "number", description: "Maximum agent turns." },
        max_cost_usd: {
          type: "number",
          description: "Maximum provider cost in USD.",
        },
        timeout_seconds: { type: "number", description: "Wall-clock timeout." },
        allowed_model_roles: {
          type: "array",
          description:
            "Allowed planner/executor/verifier/writer/judge/observation roles.",
        },
      },
      required: ["goal", "allowed_domains", "approval_policy"],
    },
  },
  {
    name: "request_browser_file_upload",
    kind: "mechanical",
    description:
      "Prepare a local file for a one-time, human-approved attachment to an exact file input. The task must already be paused for clarification.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Paused delegated task id." },
        file_path: {
          type: "string",
          description:
            "Absolute local path. The host validates, hashes, and caps it at 10MB.",
        },
        tab_id: {
          type: "number",
          description: "Exact destination browser tab id.",
        },
        origin: {
          type: "string",
          description:
            "Exact expected page origin, for example https://play.google.com.",
        },
        input_id: {
          type: "number",
          description:
            "Exact tagged <input type=file> id reported by the browser task.",
        },
      },
      required: ["task_id", "file_path", "tab_id", "origin", "input_id"],
    },
  },
  {
    name: "get_browser_task",
    kind: "mechanical",
    description:
      "Get lifecycle, plan, pending interaction, evidence, usage, and result.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Delegated task id." },
      },
      required: ["task_id"],
    },
  },
  {
    name: "continue_browser_task",
    kind: "mechanical",
    description:
      "Answer the exact clarification a delegated task is waiting on.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Delegated task id." },
        response: { type: "string", description: "Clarification response." },
      },
      required: ["task_id", "response"],
    },
  },
  {
    name: "approve_browser_checkpoint",
    kind: "mechanical",
    description:
      "Approve or deny the exact pending consequential-action checkpoint.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Delegated task id." },
        checkpoint_id: {
          type: "string",
          description: "Exact pending checkpoint id.",
        },
        approved: { type: "boolean", description: "Approve or deny." },
      },
      required: ["task_id", "checkpoint_id", "approved"],
    },
  },
  {
    name: "cancel_browser_task",
    kind: "mechanical",
    description: "Cancel a delegated task and prevent subsequent actions.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Delegated task id." },
      },
      required: ["task_id"],
    },
  },
  {
    name: "list_browser_tasks",
    kind: "mechanical",
    description: "List delegated browser tasks, optionally filtered by status.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Optional lifecycle status." },
        limit: { type: "number", description: "Maximum summaries, up to 100." },
      },
    },
  },
  {
    name: "get_browser_task_trace",
    kind: "mechanical",
    description: "Get the compact redacted trace for a delegated task.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Delegated task id." },
      },
      required: ["task_id"],
    },
  },
  {
    name: "browser_bridge_status",
    kind: "mechanical",
    description:
      "Report bridge and delegated-task capacity without requiring provider keys.",
    inputSchema: { type: "object", properties: {} },
  },
];

const COMPATIBILITY_TOOLS: BrowserToolDef[] = [
  {
    name: "browser_ping",
    kind: "mechanical",
    description:
      "Liveness check — confirms the OpenSidebar extension is connected and able to act on the browser.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "browser_navigate",
    kind: "mechanical",
    description: "Navigate the active tab to a URL and wait for it to settle.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute URL to open." },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_screenshot",
    kind: "mechanical",
    description: "Capture a screenshot of the visible area of the active tab.",
    inputSchema: {
      type: "object",
      properties: {
        fullPage: {
          type: "boolean",
          description:
            "Capture the full scrollable page instead of the viewport.",
        },
      },
    },
  },
  {
    name: "browser_extract_structured",
    kind: "intent",
    description:
      "Extract structured data from a page according to a JSON-shaped schema. Optionally navigates to `url` first.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Optional URL to open before extracting.",
        },
        schema: {
          type: "object",
          description:
            "Shape of the data to extract (field names → descriptions).",
        },
      },
      required: ["schema"],
    },
  },
  {
    name: "browser_research_company",
    kind: "intent",
    description:
      "Research a company from its site and return a structured profile (summary, products, size, links). Provide a `url` or a `name`.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Company website URL." },
        name: { type: "string", description: "Company name (used if no URL)." },
      },
    },
  },
  {
    name: "browser_apply_to_job",
    kind: "intent",
    description:
      "Apply to a job posting using the authenticated session. Returns `needs_human` on CAPTCHA/auth/ambiguous fields rather than guessing.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Job posting / application URL." },
        resume: {
          type: "string",
          description: "Resume text or a profile file alias (e.g. 'cv').",
        },
        cover_letter: {
          type: "string",
          description: "Cover letter text to use, if any.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_run_task",
    kind: "intent",
    description:
      "Generic fallback: run a natural-language browser task with the authenticated session. Use the typed tools above when one fits.",
    inputSchema: {
      type: "object",
      properties: {
        instruction: {
          type: "string",
          description: "What to accomplish in the browser.",
        },
      },
      required: ["instruction"],
    },
  },
  {
    name: "browser_respond_approval",
    kind: "mechanical",
    description:
      "Answer a consequential-action approval that a mission is paused on (a response with status 'needs_human' and an 'approval' block). Review the approval's context and dry-run evidence, then approve or deny. Approving resumes the mission and performs the action; denying refuses it and the mission continues without it. Answer before the approval's expiresAt, and do not start a new mission on the same session while one is pending — that stops the paused mission.",
    inputSchema: {
      type: "object",
      properties: {
        approvalId: {
          type: "string",
          description: "The approvalId from the response's approval block.",
        },
        approved: {
          type: "boolean",
          description:
            "true to approve and perform the action, false to refuse it.",
        },
      },
      required: ["approvalId", "approved"],
    },
  },
];

export const BROWSER_TOOLS: BrowserToolDef[] = [
  ...TASK_FIRST_TOOLS,
  ...COMPATIBILITY_TOOLS,
];
