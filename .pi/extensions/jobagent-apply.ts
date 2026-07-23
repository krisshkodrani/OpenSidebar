/**
 * JobAgent apply-loop extension for pi (RFC LP-22) — the pi-side ADAPTER over
 * the JobAgent daemon's verb surface.
 *
 * This file deliberately contains no pipeline logic. Every tool forwards to a
 * daemon route and returns its JSON verbatim, so pi, Claude Code, and Codex all
 * drive one tested implementation instead of three prompt-shaped copies of it.
 * The judgment rules live in `skills/jobagent/SKILL.md`; the authority (criteria
 * matching, the status ratchet, both human gates) lives in the daemon.
 *
 * Note the split with `jobagent.ts`: that extension is the older data-layer +
 * board-sweep driver and talks to the host modules directly. This one talks
 * only HTTP, and is the path a skill should use.
 *
 * Removability: delete this file and pi knows nothing about it.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

const PORT = Number(process.env.JOBAGENT_CONSOLE_PORT ?? 7591);
const BASE = `http://127.0.0.1:${PORT}`;

function text(value: unknown): {
  content: Array<{ type: "text"; text: string }>;
  details: unknown;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    details: value,
  };
}

/**
 * Call the daemon. A refused connection is reported as an actionable message
 * rather than a stack trace: it means the daemon is not running, which is a
 * thing the operator fixes, not something pi should work around.
 */
async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        // The daemon's CSRF guard; mutations without it are 403.
        "X-JobAgent-Console": "1",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (e) {
    return {
      error: `no JobAgent daemon on ${BASE} — start it with \`pnpm run jobagent serve\``,
      cause: e instanceof Error ? e.message : String(e),
    };
  }
  const payload = await response.json().catch(() => ({ error: "unparseable daemon response" }));
  return response.ok ? payload : { status: response.status, ...(payload as object) };
}

const str = (params: unknown, key: string): string =>
  String(((params ?? {}) as Record<string, unknown>)[key] ?? "");

export default function jobagentApplyExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "jobagent_status",
    label: "JobAgent: status",
    description:
      "Daemon health, bridge ownership, and any active run. Call this FIRST — " +
      "if the daemon is not running, nothing else in this loop will work.",
    parameters: { type: "object", additionalProperties: false, properties: {} } as unknown as TSchema,
    async execute() {
      return text({
        health: await call("GET", "/api/health"),
        bridge: await call("GET", "/api/bridge"),
      });
    },
  });

  pi.registerTool({
    name: "jobagent_assess",
    label: "JobAgent: assess a posting URL",
    description:
      "Score ONE job posting URL against the human's search criteria and return " +
      "the verdict with reasons. Read-only: it opens the page but writes " +
      "nothing and creates no package. Use it to filter search results before " +
      "ingesting them. Do not re-assess a URL you already assessed.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["url"],
      properties: { url: { type: "string", description: "The posting URL." } },
    } as unknown as TSchema,
    async execute(_id, params) {
      return text(await call("POST", "/api/assess", { url: str(params, "url") }));
    },
  });

  pi.registerTool({
    name: "jobagent_ingest",
    label: "JobAgent: ingest a posting URL",
    description:
      "Create a review-queue package from ONE posting URL. The host applies the " +
      "same criteria matching, dedupe, and rejection rules a board sweep uses — " +
      "returns created / duplicate / rejected with auditable reasons. Never " +
      "fills or submits anything. Pass `source` to record where you found it.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["url"],
      properties: {
        url: { type: "string", description: "The posting URL." },
        source: { type: "string", description: "Where it came from, e.g. 'websearch'." },
        name: { type: "string", description: "Override the derived package name." },
      },
    } as unknown as TSchema,
    async execute(_id, params) {
      const body: Record<string, unknown> = { url: str(params, "url") };
      if (str(params, "source")) body.source = str(params, "source");
      if (str(params, "name")) body.name = str(params, "name");
      return text(await call("POST", "/api/ingest", body));
    },
  });

  pi.registerTool({
    name: "jobagent_questions",
    label: "JobAgent: read a form's questions",
    description:
      "Read the application form's fields into the package's questions.json so " +
      "the kit can be drafted. Structural only — it reports the labels, it does " +
      "not answer them, and it never fills or submits. If it reports the form " +
      "continues past page one, STOP for this package and report it: a kit " +
      "drafted from page one would silently omit the rest.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["name"],
      properties: {
        name: { type: "string", description: "The package name." },
        formUrl: { type: "string", description: "Override the form URL." },
      },
    } as unknown as TSchema,
    async execute(_id, params) {
      const name = str(params, "name");
      const body = str(params, "formUrl") ? { formUrl: str(params, "formUrl") } : {};
      return text(
        await call("POST", `/api/applications/${encodeURIComponent(name)}/questions`, body),
      );
    },
  });

  pi.registerTool({
    name: "jobagent_draft_kit",
    label: "JobAgent: draft the answer kit",
    description:
      "Map the form's questions onto the human's answer library and return the " +
      "draft with per-field provenance. Questions the library cannot answer come " +
      "back in `unresolved` — those need the CANDIDATE's judgment (salary, start " +
      "date, why-this-company). Do NOT answer them yourself; present them to the " +
      "human. Drafting invents nothing and approves nothing.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["name"],
      properties: { name: { type: "string", description: "The package name." } },
    } as unknown as TSchema,
    async execute(_id, params) {
      const name = str(params, "name");
      // POST with an empty body: the daemon drafts from the questions.json that
      // `jobagent_questions` extracted.
      return text(
        await call("POST", `/api/applications/${encodeURIComponent(name)}/kit-draft`, {}),
      );
    },
  });

  pi.registerTool({
    name: "jobagent_queue",
    label: "JobAgent: review queue",
    description:
      "List the application packages and their lifecycle status. Use it to see " +
      "what exists and what stage each package is at.",
    parameters: { type: "object", additionalProperties: false, properties: {} } as unknown as TSchema,
    async execute() {
      return text(await call("GET", "/api/queue"));
    },
  });
}
