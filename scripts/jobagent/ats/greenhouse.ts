/**
 * Greenhouse adapter (RFC LP-23 §1, phase-0 findings 2026-07-23).
 *
 * The gold case: `boards-api.greenhouse.io/v1/boards/<board>/jobs/<id>
 * ?questions=true` returns the listing AND the application questions with
 * types, required flags, and full option lists (verified live: a 197-option
 * country select, a 7-option visa select). Demographic material is separated
 * structurally — `demographic_questions` and `compliance[].type === "eeoc"` —
 * so those questions carry `demographic: true` instead of being keyword-guessed.
 */
import type { FormQuestion } from "../drafting";
import type { AtsAdapter, AtsListing, AtsQuestions, FetchLike } from "./types";
import { fetchJson, snippetOf } from "./types";

const HOSTS = new Set([
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "boards.eu.greenhouse.io",
  "job-boards.eu.greenhouse.io",
]);

/** `…greenhouse.io/<board>/jobs/<id>` or the embed form `?for=<board>&token=<id>`. */
function parseTarget(url: URL): { board: string; id: string; eu: boolean } | null {
  if (!HOSTS.has(url.hostname)) return null;
  const eu = url.hostname.includes(".eu.");
  if (url.pathname.startsWith("/embed/job_app")) {
    const board = url.searchParams.get("for");
    const id = url.searchParams.get("token");
    if (board && id && /^\d+$/.test(id)) return { board, id, eu };
    return null;
  }
  const match = url.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
  if (match) return { board: match[1], id: match[2], eu };
  return null;
}

interface GhField {
  type?: string;
  values?: Array<{ label?: string }>;
}
interface GhQuestion {
  label?: string;
  required?: boolean;
  fields?: GhField[];
}
interface GhJob {
  title?: string;
  company_name?: string;
  location?: { name?: string };
  content?: string;
  absolute_url?: string;
  questions?: GhQuestion[];
  demographic_questions?: { questions?: GhQuestion[] } | GhQuestion[] | null;
  compliance?: Array<{ type?: string; questions?: GhQuestion[] }>;
}

const KIND_BY_TYPE: Record<string, FormQuestion["kind"]> = {
  input_text: "text",
  textarea: "longtext",
  input_file: "file",
  multi_value_single_select: "select",
  multi_value_multi_select: "select",
};

function toQuestion(q: GhQuestion, demographic: boolean): FormQuestion | null {
  const label = q.label?.trim();
  if (!label) return null;
  const field = q.fields?.[0];
  const kind = field?.type ? KIND_BY_TYPE[field.type] : undefined;
  const options = (field?.values ?? [])
    .map((v) => v.label?.trim())
    .filter(Boolean) as string[];
  return {
    label,
    ...(kind ? { kind } : {}),
    ...(q.required === true ? { required: true } : {}),
    ...(options.length > 0 ? { options } : {}),
    ...(demographic ? { demographic: true } : {}),
  };
}

async function fetchJob(
  target: { board: string; id: string; eu: boolean },
  fetchImpl: FetchLike,
): Promise<GhJob | null> {
  const apiHost = target.eu
    ? "boards-api.eu.greenhouse.io"
    : "boards-api.greenhouse.io";
  return (await fetchJson(
    fetchImpl,
    `https://${apiHost}/v1/boards/${encodeURIComponent(target.board)}/jobs/${target.id}?questions=true`,
  )) as GhJob | null;
}

export const greenhouse: AtsAdapter = {
  name: "greenhouse",

  recognizes(url: URL): boolean {
    return parseTarget(url) !== null;
  },

  async listing(url: URL, fetchImpl: FetchLike): Promise<AtsListing | null> {
    const target = parseTarget(url);
    if (!target) return null;
    const job = await fetchJob(target, fetchImpl);
    if (!job?.title) return null;
    return {
      title: job.title,
      company: job.company_name ?? target.board,
      location: job.location?.name ?? "",
      snippet: snippetOf(job.content),
      applyUrl: job.absolute_url ?? url.toString(),
      tier: "greenhouse-api",
    };
  },

  async questions(url: URL, fetchImpl: FetchLike): Promise<AtsQuestions | null> {
    const target = parseTarget(url);
    if (!target) return null;
    const job = await fetchJob(target, fetchImpl);
    if (!job || !Array.isArray(job.questions)) return null;

    const questions: FormQuestion[] = [];
    for (const q of job.questions) {
      const mapped = toQuestion(q, false);
      if (mapped) questions.push(mapped);
    }
    // Structurally-separated demographic material, flagged as such.
    const demographicSets: GhQuestion[][] = [];
    const dq = job.demographic_questions;
    if (Array.isArray(dq)) demographicSets.push(dq);
    else if (dq?.questions) demographicSets.push(dq.questions);
    for (const block of job.compliance ?? []) {
      if (block.type === "eeoc" && Array.isArray(block.questions)) {
        demographicSets.push(block.questions);
      }
    }
    for (const set of demographicSets) {
      for (const q of set) {
        const mapped = toQuestion(q, true);
        if (mapped) questions.push(mapped);
      }
    }
    if (questions.length === 0) return null;
    return { questions, partial: false, pageNote: "", tier: "greenhouse-api" };
  },
};
