/**
 * Lever adapter (RFC LP-23 §1, phase-0 findings 2026-07-23).
 *
 * Listings: `api.lever.co/v0/postings/<org>/<id>` (public JSON). Questions:
 * Lever has no public questions API, but the apply page at
 * `jobs.lever.co/<org>/<id>/apply` is fully server-rendered — verified live:
 * every field sits in an `<li class="application-question …">` block with an
 * `application-label` div, a required `✱` span, and plain inputs/selects/
 * textareas. So questions are tier 2: fetch the HTML and parse structurally.
 * Anything that does not parse cleanly degrades to null (browser tier), never
 * to invented fields.
 */
import type { FormQuestion } from "../drafting";
import type { AtsAdapter, AtsListing, AtsQuestions, FetchLike } from "./types";
import { fetchJson, fetchText, snippetOf, stripHtml } from "./types";

const HOSTS = new Set(["jobs.lever.co", "jobs.eu.lever.co"]);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function parseTarget(url: URL): { org: string; jid: string; eu: boolean } | null {
  if (!HOSTS.has(url.hostname)) return null;
  const [org, jid] = url.pathname.split("/").filter(Boolean);
  if (org && jid && UUID.test(jid)) {
    return { org, jid: jid.match(UUID)![0], eu: url.hostname.includes(".eu.") };
  }
  return null;
}

interface LeverPosting {
  text?: string;
  categories?: { location?: string };
  country?: string;
  workplaceType?: string;
  descriptionPlain?: string;
  openingPlain?: string;
  applyUrl?: string;
  hostedUrl?: string;
}

/**
 * Parse the server-rendered apply form. Segment-per-question: split on the
 * `application-question` list items, so nested `<li>`s (checkbox groups like
 * Pronouns) stay inside their segment instead of confusing a block regex.
 * Exported for tests.
 */
export function parseLeverApplyPage(html: string): FormQuestion[] {
  const formStart = html.indexOf('id="application-form"');
  const scope = formStart >= 0 ? html.slice(formStart) : html;
  const segments = scope.split(/<li class="application-question[^"]*"/).slice(1);

  const questions: FormQuestion[] = [];
  for (const segment of segments) {
    const labelMatch = segment.match(
      /application-label[^"]*"\s*>([\s\S]*?)<\/div>/,
    );
    if (!labelMatch) continue;
    const label = stripHtml(labelMatch[1].replace(/<span class="required">[\s\S]*?<\/span>/, "")).trim();
    if (!label) continue;

    const required = /<span class="required">/.test(segment);

    let kind: FormQuestion["kind"] | undefined;
    let options: string[] | undefined;
    if (/<textarea/.test(segment)) {
      kind = "longtext";
    } else if (/type="file"/.test(segment)) {
      kind = "file";
    } else if (/<select/.test(segment)) {
      kind = "select";
      options = [...segment.matchAll(/<option[^>]*>([\s\S]*?)<\/option>/g)]
        .map((m) => stripHtml(m[1]))
        .filter((o) => o && !/^select/i.test(o)); // drop "Select …" placeholders
    } else if (/type="checkbox"|type="radio"/.test(segment)) {
      kind = "select";
      options = [...segment.matchAll(/type="(?:checkbox|radio)"[^>]*value="([^"]*)"/g)]
        .map((m) => stripHtml(m[1]))
        .filter(Boolean);
    } else if (/<input/.test(segment)) {
      kind = "text";
    } else {
      continue; // a label with no input is decoration, not a question
    }

    questions.push({
      label,
      ...(kind ? { kind } : {}),
      ...(required ? { required: true } : {}),
      ...(options && options.length > 0 ? { options } : {}),
    });
  }
  return questions;
}

export const lever: AtsAdapter = {
  name: "lever",

  recognizes(url: URL): boolean {
    return parseTarget(url) !== null;
  },

  async listing(url: URL, fetchImpl: FetchLike): Promise<AtsListing | null> {
    const target = parseTarget(url);
    if (!target) return null;
    const apiHost = target.eu ? "api.eu.lever.co" : "api.lever.co";
    const posting = (await fetchJson(
      fetchImpl,
      `https://${apiHost}/v0/postings/${encodeURIComponent(target.org)}/${target.jid}`,
    )) as LeverPosting | null;
    if (!posting?.text) return null;
    const location = [
      posting.workplaceType?.toLowerCase() === "remote" ? "Remote" : "",
      posting.categories?.location ?? "",
      posting.country ?? "",
    ]
      .filter(Boolean)
      .join(", ");
    return {
      title: posting.text,
      company: target.org,
      location,
      snippet: snippetOf(posting.descriptionPlain ?? posting.openingPlain),
      applyUrl:
        posting.applyUrl ??
        `https://${url.hostname}/${target.org}/${target.jid}/apply`,
      tier: "lever-api",
    };
  },

  async questions(url: URL, fetchImpl: FetchLike): Promise<AtsQuestions | null> {
    const target = parseTarget(url);
    if (!target) return null;
    const html = await fetchText(
      fetchImpl,
      `https://${url.hostname}/${encodeURIComponent(target.org)}/${target.jid}/apply`,
    );
    if (!html) return null;
    const questions = parseLeverApplyPage(html);
    if (questions.length === 0) return null;
    return { questions, partial: false, pageNote: "", tier: "lever-page" };
  },
};
