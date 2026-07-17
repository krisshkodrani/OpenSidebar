/**
 * JobAgent workspace extension for pi (pi-backend Phase 5) — the single-package
 * apply loop. pi is the brain; the OpenSidebar extension (see opensidebar.ts) is
 * the hands. This extension adds the DATA layer: it reads one pre-approved job
 * application from the workspace (`~/.opensidebar/seed/applications/<name>/`),
 * hands pi a fill-only mission brief to run via `browser_run_task`, and records
 * the application's status. It never touches the browser bridge itself and never
 * invents personal data — answers come only from the approved manifest.
 *
 * The loop: jobagent_load_application → browser_run_task(brief) → on a paused
 * consequential submit, verify the dry-run and browser_respond_approval →
 * jobagent_record_status. The submit stays a human-gated step (Phase 4); this
 * extension adds no auto-submit.
 *
 * Removability: delete this file (or `.pi/`) and pi knows nothing about it.
 * Nothing here is imported by extension or scripts code.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { resolve } from "node:path";

import {
  assembleFillBrief,
  listApplications,
  loadApplication,
  recordStatus,
  startCvServer,
  type ApplicationStatus,
  type CvServer,
} from "../../scripts/jobagent/index";

/** CV servers stay alive for the pi process; one per application, replaced on reload. */
const cvServers = new Map<string, CvServer>();

async function closeCvServer(name: string): Promise<void> {
  const existing = cvServers.get(name);
  if (existing) {
    cvServers.delete(name);
    await existing.close().catch(() => {});
  }
}

function text(value: unknown): {
  content: Array<{ type: "text"; text: string }>;
  details: unknown;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    details: value,
  };
}

const APPLY_STATUSES: ApplicationStatus[] = [
  "reviewing",
  "ready",
  "filled-awaiting-submit",
  "submitted-by-user",
  "applied",
  "archived",
  "duplicate-risk",
];

export default function jobagentExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "jobagent_list_applications",
    label: "JobAgent: list applications",
    description:
      "List the job applications in the workspace with their company, role, " +
      "and status. Use this to pick which application to work on.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
    } as unknown as TSchema,
    async execute() {
      return text({ applications: listApplications() });
    },
  });

  pi.registerTool({
    name: "jobagent_load_application",
    label: "JobAgent: load application",
    description:
      "Load one application by name. Returns a fill-only mission brief (the " +
      "exact instruction to pass to browser_run_task), the application " +
      "metadata (company, role, form URL, status), and a loopback URL for the " +
      "CV. The brief contains every approved answer — fill verbatim, never " +
      "invent personal data.",
    promptGuidelines: [
      "JobAgent single-application apply loop: (1) jobagent_load_application to " +
        "get the fill brief + metadata; (2) browser_run_task with the brief " +
        "VERBATIM — it fills the form and stops before submitting; (3) if the " +
        "response is needs_human WITHOUT an approval block, read " +
        "response.handoff and continue; (4) if it has an `approval` block, the " +
        "submit is paused — byte-check approval.dryRun.entries against the " +
        "answers in the brief, present them to the human, and only on their " +
        "go-ahead call browser_respond_approval; (5) after a successful submit " +
        "call jobagent_record_status(name, 'submitted-by-user'); if you leave " +
        "it filled without submitting, call jobagent_record_status(name, " +
        "'filled-awaiting-submit'). Never invent personal data; if a required " +
        "answer is missing from the brief, stop and ask the human.",
    ],
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["name"],
      properties: {
        name: { type: "string", description: "Application directory name." },
      },
    } as unknown as TSchema,
    async execute(_id, params) {
      const name = String((params as { name?: unknown })?.name ?? "");
      if (!name) throw new Error("jobagent_load_application needs { name }");
      const app = loadApplication(name);

      let cvUrl: string | undefined;
      if (app.manifest.cvServe) {
        await closeCvServer(name);
        const cvDir = resolve(app.dir, app.manifest.cvServe.dir);
        const server = await startCvServer(cvDir, app.manifest.cvServe.file);
        cvServers.set(name, server);
        cvUrl = server.url;
      }

      return text({
        name,
        company: app.package.company,
        roleTitle: app.package.roleTitle,
        formUrl: app.manifest.formUrl,
        status: app.package.status ?? "reviewing",
        cvVariant: app.package.cv?.selectedVariant,
        cvUrl,
        maxTurns: app.manifest.maxTurns,
        brief: assembleFillBrief(app.package, app.manifest, cvUrl),
      });
    },
  });

  pi.registerTool({
    name: "jobagent_record_status",
    label: "JobAgent: record status",
    description:
      "Record the application's status. The lifecycle is enforced: " +
      "ready→filled-awaiting-submit (after you fill), " +
      "filled-awaiting-submit→submitted-by-user (after a human approves the " +
      "submit), submitted-by-user→applied. Illegal jumps are rejected.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["name", "status"],
      properties: {
        name: { type: "string", description: "Application directory name." },
        status: {
          type: "string",
          enum: APPLY_STATUSES,
          description: "The new status.",
        },
      },
    } as unknown as TSchema,
    async execute(_id, params) {
      const p = (params ?? {}) as { name?: unknown; status?: unknown };
      const name = String(p.name ?? "");
      const status = String(p.status ?? "") as ApplicationStatus;
      if (!name || !status) {
        throw new Error("jobagent_record_status needs { name, status }");
      }
      const updated = recordStatus(loadApplication(name).dir, status);
      if (status === "submitted-by-user" || status === "archived") {
        await closeCvServer(name);
      }
      return text({ name, status: updated.status });
    },
  });
}
