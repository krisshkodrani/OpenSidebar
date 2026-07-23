/**
 * JobAgent daemon — route handlers (pi Phase 9).
 *
 * Pure functions over the jobagent data layer: each handler takes parsed
 * inputs and returns `{status, body}`. No HTTP plumbing here (server.ts owns
 * that) so every handler is directly unit-testable. All status writes go
 * through `recordStatus` — the lifecycle ratchet is the single authority and
 * its errors surface verbatim as 409s.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  listApplications,
  recordStatus,
  resolveApplicationDir,
  resolveApplicationsDir,
  resolveSeedDir,
  type ApplicationStatus,
} from "../jobagent/index";
import { loadApplicationPackage } from "../jobagent/package";
import { loadFillManifest } from "../jobagent/manifest";
import {
  parseSearchCriteria,
  resolveSearchCriteriaPath,
} from "../jobagent/discovery";
import {
  loadAnswerLibrary,
  resolveAnswerLibraryPath,
  saveAnswerLibrary,
} from "../jobagent/answers";
import {
  approveKitDraft,
  buildKitDraft,
  loadKitDraft,
  saveKitDraft,
  type FormQuestion,
} from "../jobagent/drafting";

export interface ApiResult {
  status: number;
  body: unknown;
}

const ok = (body: unknown): ApiResult => ({ status: 200, body });
const err = (status: number, message: string): ApiResult => ({
  status,
  body: { error: message },
});

/** Guard: application dir names are single path segments, never traversal. */
function isSafeName(name: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*$/i.test(name);
}

function readJsonIfPresent(path: string): unknown | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { error: "unparseable JSON on disk" };
  }
}

/* ── v0 routes ────────────────────────────────────────────── */

export function getHealth(port: number): ApiResult {
  return ok({
    ok: true,
    seedDir: resolveSeedDir(),
    applicationsDir: resolveApplicationsDir(),
    port,
  });
}

export function getQueue(): ApiResult {
  const applications = listApplications().map((summary) => {
    const dir = resolveApplicationDir(summary.name);
    const pkg = loadApplicationPackage(dir);
    return {
      ...summary,
      dateFound: pkg?.dateFound,
      risks: pkg?.risks ?? [],
      hasDiscovery: existsSync(join(dir, "discovery.json")),
      hasKitDraft: existsSync(join(dir, "kit-draft.json")),
      hasRunConfig: existsSync(join(dir, "run-config.json")),
    };
  });
  return ok({ applications });
}

export function getApplication(name: string): ApiResult {
  if (!isSafeName(name)) return err(400, "invalid application name");
  const dir = resolveApplicationDir(name);
  const pkg = loadApplicationPackage(dir);
  if (!pkg) return err(404, `no application package for "${name}"`);
  return ok({
    name,
    package: pkg,
    discovery: readJsonIfPresent(join(dir, "discovery.json")),
    kitDraft: readJsonIfPresent(join(dir, "kit-draft.json")),
    runConfig: loadFillManifest(dir) ?? undefined,
  });
}

export function postStatus(name: string, body: unknown): ApiResult {
  if (!isSafeName(name)) return err(400, "invalid application name");
  const status = (body as { status?: unknown })?.status;
  if (typeof status !== "string" || status.length === 0) {
    return err(400, "body must be { status }");
  }
  const dir = resolveApplicationDir(name);
  if (!loadApplicationPackage(dir)) {
    return err(404, `no application package for "${name}"`);
  }
  try {
    const updated = recordStatus(dir, status as ApplicationStatus);
    return ok({ name, status: updated.status });
  } catch (e) {
    // Ratchet violations and unknown statuses surface verbatim.
    return err(409, e instanceof Error ? e.message : String(e));
  }
}

export function getCriteria(): ApiResult {
  const path = resolveSearchCriteriaPath();
  if (!existsSync(path)) {
    return err(
      404,
      `no search criteria at ${path} — author one and load it with ` +
        `\`pnpm run jobagent criteria <file.json>\` ` +
        `(schemaVersion 1, roles[], boards[{name, searchUrl}])`,
    );
  }
  try {
    return ok(parseSearchCriteria(JSON.parse(readFileSync(path, "utf8"))));
  } catch (e) {
    return err(500, e instanceof Error ? e.message : String(e));
  }
}

export function putCriteria(body: unknown): ApiResult {
  try {
    const criteria = parseSearchCriteria(body);
    const path = resolveSearchCriteriaPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(criteria, null, 2) + "\n", "utf8");
    return ok(criteria);
  } catch (e) {
    return err(400, e instanceof Error ? e.message : String(e));
  }
}

/* ── v1 routes: answer library + kit drafting ─────────────── */

export function getAnswers(): ApiResult {
  const library = loadAnswerLibrary();
  if (!library) {
    return err(
      404,
      `no answer library at ${resolveAnswerLibraryPath()} — author one and ` +
        `load it with \`pnpm run jobagent answers <file.json>\` ` +
        `(schemaVersion 1, identity{fullName,email}, answers[], cvVariants[])`,
    );
  }
  return ok(library);
}

export function putAnswers(body: unknown): ApiResult {
  try {
    return ok(saveAnswerLibrary(body));
  } catch (e) {
    return err(400, e instanceof Error ? e.message : String(e));
  }
}

export function getKitDraft(name: string): ApiResult {
  if (!isSafeName(name)) return err(400, "invalid application name");
  const draft = loadKitDraft(resolveApplicationDir(name));
  if (!draft) return err(404, `no kit draft for "${name}"`);
  return ok(draft);
}

export function postKitDraft(name: string, body: unknown): ApiResult {
  if (!isSafeName(name)) return err(400, "invalid application name");
  const dir = resolveApplicationDir(name);
  const pkg = loadApplicationPackage(dir);
  if (!pkg) return err(404, `no application package for "${name}"`);
  const library = loadAnswerLibrary();
  if (!library) {
    return err(
      409,
      "no answer library — load one with `pnpm run jobagent answers <file.json>` first",
    );
  }
  // Questions come from the request when a caller supplies them explicitly,
  // and otherwise from the questions.json the `questions` extraction wrote —
  // that fallback is what makes `questions` → `draft` need no hand-authored
  // input (RFC LP-22 §4).
  let questions = (body as { questions?: unknown })?.questions;
  if (questions === undefined) {
    questions = readJsonIfPresent(join(dir, "questions.json"));
    if (questions === undefined) {
      return err(
        409,
        `no questions for "${name}" — run \`pnpm run jobagent questions ${name}\` ` +
          `first, or pass { questions } explicitly`,
      );
    }
  }
  try {
    const draft = buildKitDraft(pkg, questions as FormQuestion[], library);
    writeFileSync(
      join(dir, "kit-draft.json"),
      JSON.stringify(draft, null, 2) + "\n",
      "utf8",
    );
    return ok(draft);
  } catch (e) {
    return err(400, e instanceof Error ? e.message : String(e));
  }
}

export function putKitDraft(name: string, body: unknown): ApiResult {
  if (!isSafeName(name)) return err(400, "invalid application name");
  const dir = resolveApplicationDir(name);
  const pkg = loadApplicationPackage(dir);
  if (!pkg) return err(404, `no application package for "${name}"`);
  try {
    return ok(saveKitDraft(dir, pkg, body));
  } catch (e) {
    return err(400, e instanceof Error ? e.message : String(e));
  }
}

export function postKitApprove(name: string, body: unknown): ApiResult {
  if (!isSafeName(name)) return err(400, "invalid application name");
  const dir = resolveApplicationDir(name);
  const pkg = loadApplicationPackage(dir);
  if (!pkg) return err(404, `no application package for "${name}"`);
  const opts = (body ?? {}) as { promote?: boolean; force?: boolean };
  try {
    const manifest = approveKitDraft(dir, { force: opts.force === true });
    let status = pkg.status ?? "reviewing";
    if (opts.promote === true) {
      try {
        status = recordStatus(dir, "ready").status ?? status;
      } catch (e) {
        return err(409, e instanceof Error ? e.message : String(e));
      }
    }
    return ok({ name, manifest, status });
  } catch (e) {
    return err(409, e instanceof Error ? e.message : String(e));
  }
}
