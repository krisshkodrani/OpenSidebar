/**
 * JobAgent CLI — the headless verb surface over the loopback daemon.
 *
 * This is the seam the agent-platform skills sit on. The daemon
 * (`server.ts`) owns the things a prompt cannot: the WS bridge to the
 * extension, the single-active-run mutex, and the run/approval registries.
 * Everything a human or an agent wants to *do* is a verb here, so a skill is
 * a thin markdown wrapper — "call these verbs, judge the output" — rather
 * than a second implementation of the pipeline in prompt form. One tested
 * surface, many front-ends.
 *
 * Design rules:
 *  - No npm dependencies (bare node:http), same as the daemon.
 *  - Every verb prints human-readable text by default and raw API JSON under
 *    `--json`, so the same command serves a terminal and a tool runner.
 *  - Read verbs are safe to run at any time; the consequential ones
 *    (`fill`, `submit`, `decide`) go through the daemon's existing gates —
 *    this CLI adds no authority of its own and cannot bypass the ratchet.
 *  - Exit codes are meaningful: 0 success, 1 request/usage error, 2 daemon
 *    unreachable. A skill can branch on them without parsing prose.
 *
 * Usage: `pnpm run jobagent <verb> [args]` (`pnpm run jobagent help`).
 */
import { readFileSync } from "node:fs";
import { request } from "node:http";

import { at, fields, table, took } from "./cli-format";

const PORT = Number(process.env.JOBAGENT_CONSOLE_PORT ?? 7591);
const HOST = "127.0.0.1";
const POLL_MS = 1_000;

/* ── Payload shapes ───────────────────────────────────────── */

/**
 * The parts of the daemon's payloads this CLI actually reads. Declared as
 * type aliases (not interfaces) so they stay assignable to the renderers'
 * `Record<string, unknown>` rows. Deliberately partial: the daemon owns the
 * full schemas, and `--json` passes them through untouched — these exist so
 * the columns a skill depends on are checked, not to mirror the API.
 */
type Health = { port: number; seedDir: string; applicationsDir: string };
type Bridge = { owner: string; extensionConnected: boolean; wsPort: number };
type RunSummary = {
  id: string;
  kind: string;
  name?: string;
  state: string;
  startedAt: number;
  endedAt?: number;
  outcomeSummary?: string;
  traceServer?: string;
};
type Approval = {
  approvalId: string;
  runId: string;
  name: string;
  toolName: string;
  context: string;
  expiresAt: number;
  state: string;
};
type QueueApp = {
  name: string;
  status?: string;
  dateFound?: string;
  hasKitDraft: boolean;
  hasRunConfig: boolean;
};
type FieldSource = {
  kind: string;
  key?: string;
  tag?: string;
  note?: string;
  basis?: string;
  accepted?: true;
  acceptedVia?: "single" | "bulk";
};
type KitField = {
  question?: { label: string; kind?: string; options?: string[] };
  answer?: string;
  source?: FieldSource;
};
type KitDraft = {
  perField?: KitField[];
  unresolved?: string[];
  unreviewed?: string[];
};

/** Render a field's provenance compactly: where the answer actually came from. */
function describeSource(source: FieldSource | undefined): string {
  if (!source) return "—";
  if (source.kind === "identity") return `identity:${source.key}`;
  if (source.kind === "answer") return `answer:${source.tag}`;
  if (source.kind === "default") return `default:${source.key}`;
  if (source.kind === "proposed") {
    // The distinction the whole LP-23 design rides on: the reviewer must
    // always be able to tell the platform's words from the owner's.
    return source.accepted
      ? `proposed✓ (${source.acceptedVia ?? "single"})`
      : `PROPOSED ⚠ ${source.basis ? `(${source.basis})` : "(no basis!)"}`;
  }
  if (source.kind === "skip") return source.note ? `skip: ${source.note}` : "skip";
  return source.kind;
}
/** The kit table plus its two review lists — shared by draft/set/accept. */
function renderDraft(body: KitDraft): string {
  const lines = [
    table(
      (body.perField ?? []).map((f) => ({
        label: f.question?.label ?? "",
        answer: f.answer || "—",
        source: describeSource(f.source),
      })),
      ["label", "answer", "source"],
    ),
    `\nunresolved (need the candidate's own judgment): ` +
      `${(body.unresolved ?? []).join(", ") || "none"}`,
  ];
  if ((body.unreviewed ?? []).length > 0) {
    lines.push(
      `unreviewed proposals (accept or overwrite before approve-kit): ` +
        body.unreviewed!.join(", "),
    );
  }
  return lines.join("\n");
}

type AppDetail = {
  name: string;
  package: {
    status?: string;
    title?: string;
    company?: string;
    url?: string;
    risks?: string[];
  };
  kitDraft?: KitDraft;
};
type AssessResult = {
  url: string;
  listing: { title: string; company: string; location?: string };
  match: boolean;
  reasons: string[];
  risks: string[];
  applyUrl: string;
};
type IngestResult = {
  outcome: "created" | "duplicate" | "rejected";
  name?: string;
  reasons?: string[];
  risks?: string[];
  existing?: { name: string; status: string };
  applyUrl?: string;
  /** Set when the page named no company and the URL host was recorded instead. */
  inferredCompany?: string;
};
type QuestionsResult = {
  name: string;
  formUrl: string;
  count: number;
  questions: Array<{ label: string; kind?: string; required?: boolean }>;
};
type RunView = { run: RunSummary; log: string[]; nextOffset: number };
type ApprovalsView = { pending: Approval[]; resolved: Approval[] };
type Criteria = {
  roles: string[];
  remoteOk?: boolean;
  boards: Array<{ name: string }>;
};
type AnswerLibrary = {
  identity?: { fullName?: string; email?: string };
  answers?: Array<{ tag: string; question: string }>;
  cvVariants?: Array<{ name: string; file: string }>;
};

/* ── Transport ────────────────────────────────────────────── */

interface Reply {
  status: number;
  body: { error?: string } & Record<string, unknown>;
}

/** Daemon is not listening — distinct from an error the daemon returned. */
class DaemonDown extends Error {}

function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        host: HOST,
        port: PORT,
        method,
        path,
        headers: {
          // The daemon's CSRF guard: mutations without this header are 403.
          "X-JobAgent-Console": "1",
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: Reply["body"];
          try {
            parsed = text ? JSON.parse(text) : {};
          } catch {
            parsed = { error: text.slice(0, 400) };
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ECONNREFUSED") {
        return reject(
          new DaemonDown(
            `no JobAgent daemon on ${HOST}:${PORT} — start one with ` +
              `\`pnpm run jobagent serve\` (or set JOBAGENT_CONSOLE_PORT).`,
          ),
        );
      }
      reject(e);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

/** Call and throw on any non-2xx, surfacing the daemon's own error text. */
async function ok<T>(method: string, path: string, body?: unknown): Promise<T> {
  const reply = await call(method, path, body);
  if (reply.status < 200 || reply.status >= 300) {
    throw new Error(
      `${method} ${path} → ${reply.status}: ${reply.body?.error ?? JSON.stringify(reply.body)}`,
    );
  }
  return reply.body as T;
}

/* ── Arg handling ─────────────────────────────────────────── */

export interface Args {
  positional: string[];
  flags: Record<string, string | true>;
}

/** `--flag value`, `--flag=value`, and bare `--flag` (true); rest positional. */
export function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const [name, inline] = token.slice(2).split("=", 2);
    if (inline !== undefined) flags[name] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) flags[name] = argv[++i];
    else flags[name] = true;
  }
  return { positional, flags };
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`cannot read JSON from ${path}: ${e instanceof Error ? e.message : e}`);
  }
}

function need(args: Args, index: number, what: string): string {
  const value = args.positional[index];
  if (!value) throw new Error(`missing <${what}>`);
  return value;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ── Verbs ────────────────────────────────────────────────── */

type Verb = (args: Args, json: boolean) => Promise<void>;

const out = (json: boolean, payload: unknown, human: () => string): void => {
  console.log(json ? JSON.stringify(payload, null, 2) : human());
};

export const verbs: Record<string, { help: string; run: Verb }> = {
  status: {
    help: "Daemon health, seed dirs, bridge owner, and any active run",
    run: async (_a, json) => {
      const [health, bridge, runs] = await Promise.all([
        ok<Health>("GET", "/api/health"),
        ok<Bridge>("GET", "/api/bridge"),
        ok<{ runs: RunSummary[] }>("GET", "/api/runs"),
      ]);
      const active = runs.runs.find(
        (r) => r.state === "running" || r.state === "awaiting-approval",
      );
      out(json, { health, bridge, active: active ?? null }, () =>
        fields({
          daemon: `up on ${HOST}:${health.port}`,
          seedDir: health.seedDir,
          applicationsDir: health.applicationsDir,
          bridgeOwner: bridge.owner,
          extensionConnected: bridge.extensionConnected,
          wsPort: bridge.wsPort,
          activeRun: active ? `${active.id} (${active.kind}, ${active.state})` : "none",
        }),
      );
    },
  },

  queue: {
    help: "List every application package with its lifecycle status",
    run: async (_a, json) => {
      const body = await ok<{ applications: QueueApp[] }>("GET", "/api/queue");
      out(json, body, () =>
        table(
          body.applications,
          ["name", "status", "dateFound", "hasKitDraft", "hasRunConfig"],
          "(no application packages — run `jobagent discover`)",
        ),
      );
    },
  },

  assess: {
    help: "<url> — score a posting against the criteria; writes nothing",
    run: async (a, json) => {
      const url = need(a, 0, "url");
      const body = await ok<AssessResult>("POST", "/api/assess", { url });
      out(json, body, () =>
        [
          fields({
            verdict: body.match ? "MATCH" : "reject",
            title: body.listing.title,
            company: body.listing.company,
            location: body.listing.location,
            applyUrl: body.applyUrl,
          }),
          `\nreasons: ${body.reasons.join("; ") || "—"}`,
          body.risks.length ? `risks:   ${body.risks.join("; ")}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
  },

  ingest: {
    help: "<url> [--source <s>] [--name <n>] — create a package from one posting URL",
    run: async (a, json) => {
      const url = need(a, 0, "url");
      const body = await ok<IngestResult>("POST", "/api/ingest", {
        url,
        source: typeof a.flags.source === "string" ? a.flags.source : undefined,
        name: typeof a.flags.name === "string" ? a.flags.name : undefined,
      });
      out(json, body, () => {
        if (body.outcome === "duplicate") {
          return `duplicate — already tracked as ${body.existing?.name} (${body.existing?.status})`;
        }
        if (body.outcome === "rejected") {
          return `rejected — ${body.reasons?.join("; ") ?? "no reason given"}`;
        }
        return [
          `created ${body.name}`,
          `reasons: ${body.reasons?.join("; ") ?? "—"}`,
          body.risks?.length ? `risks:   ${body.risks.join("; ")}` : "",
          body.inferredCompany
            ? `WARNING: the page did not state a company — recorded as ` +
              `"${body.inferredCompany}" (the URL host). Fix it in ` +
              `application-package.json before this reaches a form.`
            : "",
          `\nnext: pnpm run jobagent questions ${body.name}`,
        ]
          .filter(Boolean)
          .join("\n");
      });
    },
  },

  questions: {
    help: "<name> [--form-url <url>] — read the form's fields into questions.json",
    run: async (a, json) => {
      const name = need(a, 0, "name");
      const body = await ok<QuestionsResult>(
        "POST",
        `/api/applications/${encodeURIComponent(name)}/questions`,
        typeof a.flags["form-url"] === "string" ? { formUrl: a.flags["form-url"] } : {},
      );
      out(json, body, () =>
        [
          `${body.count} fields from ${body.formUrl}`,
          table(
            body.questions.map((q) => ({
              label: q.label,
              kind: q.kind ?? "text",
              required: q.required === true,
            })),
            ["label", "kind", "required"],
          ),
          `\nnext: pnpm run jobagent draft ${name}`,
        ].join("\n"),
      );
    },
  },

  show: {
    help: "<name> — full package, discovery, kit draft, and run config",
    run: async (a, json) => {
      const name = need(a, 0, "name");
      const body = await ok<AppDetail>(
        "GET",
        `/api/applications/${encodeURIComponent(name)}`,
      );
      out(json, body, () => {
        const parts = [
          fields({
            name: body.name,
            status: body.package.status ?? "reviewing",
            title: body.package.title,
            company: body.package.company,
            url: body.package.url,
            risks: body.package.risks,
          }),
        ];
        if (body.kitDraft) {
          parts.push(
            "\nkit draft:",
            table(body.kitDraft.perField ?? [], ["label", "answer", "source"]),
            `unresolved: ${(body.kitDraft.unresolved ?? []).join(", ") || "none"}`,
          );
        }
        return parts.join("\n");
      });
    },
  },

  "set-status": {
    help: "<name> <status> — advance lifecycle status (ratchet-enforced)",
    run: async (a, json) => {
      const name = need(a, 0, "name");
      const status = need(a, 1, "status");
      const body = await ok<{ name: string; status: string }>(
        "POST",
        `/api/applications/${encodeURIComponent(name)}/status`,
        { status },
      );
      out(json, body, () => `${body.name}: ${body.status}`);
    },
  },

  criteria: {
    help: "[<file.json>] — print search criteria, or replace them from a file",
    run: async (a, json) => {
      const file = a.positional[0];
      const body = file
        ? await ok<Criteria>("PUT", "/api/criteria", readJsonFile(file))
        : await ok<Criteria>("GET", "/api/criteria");
      out(json, body, () =>
        fields({
          roles: body.roles,
          remoteOk: body.remoteOk,
          boards: body.boards?.map((b) => b.name),
        }),
      );
    },
  },

  answers: {
    help: "[<file.json>] — print the answer library, or replace it from a file",
    run: async (a, json) => {
      const file = a.positional[0];
      const body = file
        ? await ok<AnswerLibrary>("PUT", "/api/answers", readJsonFile(file))
        : await ok<AnswerLibrary>("GET", "/api/answers");
      out(json, body, () =>
        [
          fields({ fullName: body.identity?.fullName, email: body.identity?.email }),
          "\nanswers:",
          table(body.answers ?? [], ["tag", "question"]),
          "\ncv variants:",
          table(body.cvVariants ?? [], ["name", "file"]),
        ].join("\n"),
      );
    },
  },

  draft: {
    help: "<name> [<questions.json>] [--show] — build a kit draft from the extracted questions; --show prints the current one",
    run: async (a, json) => {
      const name = need(a, 0, "name");
      const path = `/api/applications/${encodeURIComponent(name)}/kit-draft`;
      const file = a.positional[1];
      // Default is to BUILD: with no file the daemon uses the questions.json
      // that `questions` extracted, so the common path needs no arguments.
      const body = a.flags.show
        ? await ok<KitDraft>("GET", path)
        : await ok<KitDraft>("POST", path, file ? { questions: readJsonFile(file) } : {});
      out(json, body, () => renderDraft(body));
    },
  },

  set: {
    help: '<name> "<label>" ["<text>" | --file <path>] [--proposed --basis "<why>"] — write one field; without --proposed it is the owner\'s final answer',
    run: async (a, json) => {
      const name = need(a, 0, "name");
      const label = need(a, 1, "label");
      const fromFile = typeof a.flags.file === "string" ? a.flags.file : undefined;
      const inline = a.positional[2];
      if ((fromFile && inline !== undefined) || (!fromFile && inline === undefined)) {
        throw new Error('provide the text either inline or via --file, not both/neither');
      }
      const text = fromFile ? readFileSync(fromFile, "utf8").trim() : inline!;
      const proposed = a.flags.proposed === true;
      const basis = typeof a.flags.basis === "string" ? a.flags.basis : "";
      if (proposed && !basis) {
        // A proposal with no stateable grounding is exactly the
        // confident-wrong shape the review gate exists to catch.
        throw new Error("--proposed requires --basis naming what the answer is grounded in");
      }

      const body = await mutateDraft(name, (field, all) => {
        if (!field) {
          throw new Error(
            `no field labelled "${label}" — labels are: ` +
              all.map((f) => JSON.stringify(f.question?.label)).join(", "),
          );
        }
        const options = field.question?.options;
        if (field.question?.kind === "select" && options?.length) {
          const match = options.find((o) => o.toLowerCase() === text.toLowerCase());
          if (!match) {
            throw new Error(
              `"${text}" is not one of the select's options: ${options.join(" | ")}`,
            );
          }
          field.answer = match; // snap to the option's canonical casing
        } else {
          field.answer = text;
        }
        field.source = proposed
          ? { kind: "proposed", basis }
          : { kind: "answer", tag: "owner" };
      }, label);
      out(json, body, () => renderDraft(body));
    },
  },

  accept: {
    help: '<name> ["<label>" | --all-proposed] — adopt proposed answer(s) as reviewed',
    run: async (a, json) => {
      const name = need(a, 0, "name");
      const all = a.flags["all-proposed"] === true;
      const label = a.positional[1];
      if (all === !!label || (!all && !label)) {
        throw new Error('provide exactly one of "<label>" or --all-proposed');
      }
      const body = await mutateDraftFields(name, (fields) => {
        const targets = fields.filter(
          (f) =>
            f.source?.kind === "proposed" &&
            f.source.accepted !== true &&
            (all || f.question?.label === label),
        );
        if (targets.length === 0) {
          throw new Error(
            all
              ? "no unaccepted proposals in this kit"
              : `no unaccepted proposal labelled "${label}"`,
          );
        }
        for (const field of targets) {
          field.source!.accepted = true;
          // The audit distinction the owner chose: bulk adoption is a
          // legitimate but DISTINCT act, recorded as such.
          field.source!.acceptedVia = all ? "bulk" : "single";
        }
      });
      out(json, body, () => renderDraft(body));
    },
  },

  "edit-draft": {
    help: "<name> <draft.json> — replace a kit draft (how a human resolves TODO answers)",
    run: async (a, json) => {
      const name = need(a, 0, "name");
      const body = await ok<KitDraft>(
        "PUT",
        `/api/applications/${encodeURIComponent(name)}/kit-draft`,
        readJsonFile(need(a, 1, "draft.json")),
      );
      out(json, body, () => `unresolved: ${(body.unresolved ?? []).join(", ") || "none"}`);
    },
  },

  "approve-kit": {
    help: "<name> [--promote] [--force] — freeze the draft into a run config",
    run: async (a, json) => {
      const name = need(a, 0, "name");
      const body = await ok<{ name: string; status: string }>(
        "POST",
        `/api/applications/${encodeURIComponent(name)}/kit-approve`,
        { promote: a.flags.promote === true, force: a.flags.force === true },
      );
      out(json, body, () => `${body.name}: kit approved, status ${body.status}`);
    },
  },

  discover: {
    help: "[--follow] — spawn a pi discovery sweep over the configured boards",
    run: (a, json) => startRun(a, json, "POST", "/api/runs/discovery", {}),
  },

  fill: {
    help: "<name> [--follow] — fill the form (needs status \"ready\"); never submits",
    run: (a, json) =>
      startRun(a, json, "POST", "/api/runs/fill", {
        name: need(a, 0, "name"),
        mode: "fill",
      }),
  },

  submit: {
    help: "<name> [--follow] — submit a filled form; pauses for human approval",
    run: (a, json) =>
      startRun(a, json, "POST", "/api/runs/fill", {
        name: need(a, 0, "name"),
        mode: "submit",
      }),
  },

  runs: {
    help: "List runs, newest first",
    run: async (_a, json) => {
      const body = await ok<{ runs: RunSummary[] }>("GET", "/api/runs");
      out(json, body, () =>
        table(
          body.runs.map((r) => ({
            ...r,
            started: at(r.startedAt),
            elapsed: took(r.startedAt, r.endedAt),
          })),
          ["id", "kind", "name", "state", "started", "elapsed", "outcomeSummary"],
          "(no runs this daemon session)",
        ),
      );
    },
  },

  run: {
    help: "<runId> [--follow] — run record plus its log",
    run: async (a, json) => {
      const id = need(a, 0, "runId");
      if (a.flags.follow) return follow(id, json, 0);
      const body = await ok<RunView>("GET", `/api/runs/${encodeURIComponent(id)}`);
      out(json, body, () =>
        [
          fields({
            id: body.run.id,
            kind: body.run.kind,
            name: body.run.name,
            state: body.run.state,
            started: at(body.run.startedAt),
            elapsed: took(body.run.startedAt, body.run.endedAt),
            traceServer: body.run.traceServer,
            outcome: body.run.outcomeSummary,
          }),
          "\nlog:",
          body.log.join("\n") || "(empty)",
        ].join("\n"),
      );
    },
  },

  cancel: {
    help: "<runId> — cancel an active run",
    run: async (a, json) => {
      const id = need(a, 0, "runId");
      const body = await ok<{ canceled: boolean }>(
        "POST",
        `/api/runs/${encodeURIComponent(id)}/cancel`,
      );
      out(json, body, () => `${id}: canceled`);
    },
  },

  approvals: {
    help: "List pending and resolved approval requests",
    run: async (_a, json) => {
      const body = await ok<ApprovalsView>("GET", "/api/approvals");
      out(json, body, () =>
        [
          "pending:",
          table(
            body.pending.map((p) => ({ ...p, expires: at(p.expiresAt) })),
            ["approvalId", "name", "toolName", "context", "expires"],
            "(none)",
          ),
          "\nresolved:",
          table(body.resolved, ["approvalId", "name", "toolName", "state"], "(none)"),
        ].join("\n"),
      );
    },
  },

  decide: {
    help: "<approvalId> approve|deny — resolve a pending approval (the human gate)",
    run: async (a, json) => {
      const id = need(a, 0, "approvalId");
      const decision = need(a, 1, "approve|deny");
      if (decision !== "approve" && decision !== "deny") {
        throw new Error(`decision must be "approve" or "deny", got "${decision}"`);
      }
      const body = await ok<{ approvalId: string; state: string }>(
        "POST",
        `/api/approvals/${encodeURIComponent(id)}`,
        { approved: decision === "approve" },
      );
      out(json, body, () => `${body.approvalId}: ${body.state}`);
    },
  },

  serve: {
    help: "Start the daemon in the foreground (owns the WS bridge)",
    run: async () => {
      const { startConsoleServer, CONSOLE_PORT } = await import("./server");
      const server = await startConsoleServer(CONSOLE_PORT, { ownBridge: true });
      console.log(`[jobagent] daemon listening on ${server.url}`);
      console.log(
        `[jobagent] WS bridge owned on port ${process.env.OPENSIDEBAR_WS_PORT ?? 8917} — ` +
          `launch the browser side with: node .artifacts/pi-live/launch-chrome.mjs`,
      );
      await new Promise(() => {}); // run until killed
    },
  },
};

/* ── Draft mutation helpers (set / accept) ────────────────── */

/** GET the draft, mutate one labelled field, PUT it back. */
async function mutateDraft(
  name: string,
  mutate: (field: KitField | undefined, all: KitField[]) => void,
  label: string,
): Promise<KitDraft> {
  return mutateDraftFields(name, (fields) => {
    mutate(fields.find((f) => f.question?.label === label), fields);
  });
}

/** GET the draft, run a mutation over its fields, PUT it back. */
async function mutateDraftFields(
  name: string,
  mutate: (fields: KitField[]) => void,
): Promise<KitDraft> {
  const path = `/api/applications/${encodeURIComponent(name)}/kit-draft`;
  const draft = await ok<KitDraft>("GET", path);
  mutate(draft.perField ?? []);
  return ok<KitDraft>("PUT", path, draft);
}

/* ── Run helpers ──────────────────────────────────────────── */

/** POST a start-run route, then optionally stream the run to a decision point. */
async function startRun(
  args: Args,
  json: boolean,
  method: string,
  path: string,
  body: unknown,
): Promise<void> {
  const started = await ok<{ runId: string }>(method, path, body);
  if (!args.flags.follow) {
    return out(json, started, () =>
      `started ${started.runId} — follow with \`pnpm run jobagent run ${started.runId} --follow\``,
    );
  }
  if (!json) console.log(`started ${started.runId}`);
  await follow(started.runId, json, 0);
}

/**
 * Poll a run until it either finishes or pauses at the human gate.
 *
 * Returning control at `awaiting-approval` is deliberate: an agent driving
 * this must hand the decision to its human and come back, not sit in a loop
 * pretending to supervise. The pending approval and the exact `decide`
 * command are printed so the next step is unambiguous.
 */
async function follow(runId: string, json: boolean, from: number): Promise<void> {
  let offset = from;
  const deadline = Date.now() + 15 * 60 * 1000;
  for (;;) {
    const body = await ok<RunView>(
      "GET",
      `/api/runs/${encodeURIComponent(runId)}?offset=${offset}`,
    );
    if (!json) for (const line of body.log) console.log(line);
    offset = body.nextOffset;

    if (body.run.state === "awaiting-approval") {
      const { pending } = await ok<ApprovalsView>("GET", "/api/approvals");
      const item = pending.find((p) => p.runId === runId);
      if (json) return console.log(JSON.stringify({ run: body.run, approval: item ?? null }, null, 2));
      console.log("\n— awaiting human approval —");
      if (item) {
        console.log(fields({ approvalId: item.approvalId, tool: item.toolName, context: item.context, expires: at(item.expiresAt) }));
        console.log(`\nresolve with: pnpm run jobagent decide ${item.approvalId} approve|deny`);
      }
      return;
    }
    if (body.run.state !== "running") {
      if (json) return console.log(JSON.stringify({ run: body.run }, null, 2));
      console.log(`\n${runId}: ${body.run.state} — ${body.run.outcomeSummary ?? "no summary"}`);
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`still running after 15m — check \`pnpm run jobagent run ${runId}\``);
    }
    await sleep(POLL_MS);
  }
}

/* ── Entry ────────────────────────────────────────────────── */

function usage(): string {
  const width = Math.max(...Object.keys(verbs).map((v) => v.length));
  return [
    "JobAgent — headless job-application pipeline.",
    "",
    "Usage: pnpm run jobagent <verb> [args] [--json]",
    "",
    ...Object.entries(verbs).map(([name, v]) => `  ${name.padEnd(width)}  ${v.help}`),
    "",
    "Every verb accepts --json for raw API output. Start the daemon first:",
    "  pnpm run jobagent serve",
  ].join("\n");
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const name = argv[0];
  if (!name || name === "help" || name === "--help") {
    console.log(usage());
    return 0;
  }
  const verb = verbs[name];
  if (!verb) {
    console.error(`unknown verb "${name}"\n\n${usage()}`);
    return 1;
  }
  const args = parseArgs(argv.slice(1));
  try {
    await verb.run(args, args.flags.json === true);
    return 0;
  } catch (e) {
    if (e instanceof DaemonDown) {
      console.error(e.message);
      return 2;
    }
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

if (process.env.VITEST === undefined) {
  main().then((code) => {
    process.exitCode = code;
    if (code !== 0) process.exit(code);
  });
}
