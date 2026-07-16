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

export const BROWSER_TOOLS: BrowserToolDef[] = [
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
          description: "Capture the full scrollable page instead of the viewport.",
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
        url: { type: "string", description: "Optional URL to open before extracting." },
        schema: {
          type: "object",
          description: "Shape of the data to extract (field names → descriptions).",
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
        resume: { type: "string", description: "Resume text or a profile file alias (e.g. 'cv')." },
        cover_letter: { type: "string", description: "Cover letter text to use, if any." },
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
        instruction: { type: "string", description: "What to accomplish in the browser." },
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
          description: "true to approve and perform the action, false to refuse it.",
        },
      },
      required: ["approvalId", "approved"],
    },
  },
];
