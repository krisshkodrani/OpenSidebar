/**
 * Challenge discovery CLI.
 *
 * Usage:
 *   bun run challenge:discover --url <challenge-site-url> [--out <file>] [--expect <n>] [--max-pages <n>]
 */

import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";

interface DiscoveryOptions {
  url: string;
  outFile: string;
  expectedCount: number;
  maxPages: number;
  timeoutMs: number;
  manualManifest?: string;
}

interface PageRecord {
  url: string;
  status: number;
  contentType: string;
}

interface Candidate {
  url: string;
  score: number;
  titleHints: string[];
  sourceHints: Set<string>;
  numericHint?: number;
}

interface ManifestEntry {
  taskId: string;
  title: string;
  entryUrl: string;
  discoverySource: "dom" | "route" | "mixed";
  score: number;
}

interface DiscoveryDiagnostics {
  startedAt: string;
  seedUrl: string;
  expectedCount: number;
  crawledPages: number;
  candidateCount: number;
  selectedCount: number;
  pages: PageRecord[];
  warnings: string[];
}

const ASSET_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".css",
  ".js",
  ".mjs",
  ".ts",
  ".tsx",
  ".json",
  ".pdf",
  ".woff",
  ".woff2",
  ".map",
  ".ico",
]);

const CHALLENGE_KEYWORDS = [
  "challenge",
  "task",
  "level",
  "problem",
  "start",
  "play",
  "attempt",
  "exercise",
];

function parseOptions(args: string[]): DiscoveryOptions {
  const url = readArg(args, "--url");
  if (!url) {
    throw new Error("Missing required --url argument.");
  }

  return {
    url,
    outFile:
      readArg(args, "--out") || join("challenge-runner", "tasks-manifest.json"),
    expectedCount: parsePositiveInt(readArg(args, "--expect"), 30),
    maxPages: parsePositiveInt(readArg(args, "--max-pages"), 120),
    timeoutMs: parsePositiveInt(readArg(args, "--timeout-ms"), 8000),
    manualManifest: readArg(args, "--manual-manifest"),
  };
}

function readArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function decodeHtml(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  if (parsed.pathname.endsWith("/") && parsed.pathname.length > 1) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.toString();
}

function isLikelyAsset(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  for (const ext of ASSET_EXT) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function includesChallengeKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return CHALLENGE_KEYWORDS.some((kw) => lower.includes(kw));
}

function numericHintFromText(text: string): number | undefined {
  const match = text.match(/\b([1-9]|[12][0-9]|30)\b/);
  if (!match) return undefined;
  return Number.parseInt(match[1], 10);
}

function scoreAnchorCandidate(params: {
  href: string;
  text: string;
  attrs: string;
}): { score: number; numericHint?: number } {
  let score = 0;
  const lowerHref = params.href.toLowerCase();
  const lowerText = params.text.toLowerCase();
  const lowerAttrs = params.attrs.toLowerCase();

  if (includesChallengeKeyword(lowerText)) score += 3;
  if (includesChallengeKeyword(lowerHref)) score += 3;
  if (includesChallengeKeyword(lowerAttrs)) score += 1;

  const numText = numericHintFromText(lowerText);
  const numHref = numericHintFromText(lowerHref);
  const numericHint = numText || numHref;
  if (numericHint !== undefined) score += 2;

  if (lowerHref.includes("http")) score += 0;
  if (lowerText.length >= 4) score += 1;
  if (lowerText.length >= 12) score += 1;

  return { score, numericHint };
}

function extractAnchorCandidates(
  html: string,
  baseUrl: URL,
): Array<{
  url: string;
  title: string;
  score: number;
  numericHint?: number;
}> {
  const results: Array<{
    url: string;
    title: string;
    score: number;
    numericHint?: number;
  }> = [];
  const anchorRegex = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorRegex)) {
    const attrs = match[1] || "";
    const body = match[2] || "";
    const hrefMatch = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) continue;

    const rawHref = hrefMatch[1].trim();
    if (!rawHref || rawHref.startsWith("javascript:")) continue;

    let absolute: URL;
    try {
      absolute = new URL(rawHref, baseUrl);
    } catch {
      continue;
    }

    if (!["http:", "https:"].includes(absolute.protocol)) continue;
    if (absolute.origin !== baseUrl.origin) continue;
    if (isLikelyAsset(absolute.pathname)) continue;

    const title = normalizeWhitespace(decodeHtml(stripTags(body)));
    if (!title) continue;

    const scored = scoreAnchorCandidate({
      href: absolute.toString(),
      text: title,
      attrs,
    });
    if (scored.score < 3) continue;

    results.push({
      url: normalizeUrl(absolute.toString()),
      title,
      score: scored.score,
      numericHint: scored.numericHint,
    });
  }

  return results;
}

function extractRouteCandidates(
  html: string,
  baseUrl: URL,
): Array<{ url: string; score: number; numericHint?: number }> {
  const candidates: Array<{ url: string; score: number; numericHint?: number }> = [];
  const routeRegex = /["'`](\/[a-zA-Z0-9/_\-?=&]{2,200})["'`]/g;

  for (const match of html.matchAll(routeRegex)) {
    const path = match[1];
    if (!path || path === "/") continue;
    if (isLikelyAsset(path)) continue;

    const lowerPath = path.toLowerCase();
    const hasKeyword = includesChallengeKeyword(lowerPath);
    const hint = numericHintFromText(lowerPath);
    if (!hasKeyword && hint === undefined) continue;

    let score = 0;
    if (hasKeyword) score += 3;
    if (hint !== undefined) score += 2;
    if (path.includes("?")) score += 1;
    if (score < 3) continue;

    let absolute: URL;
    try {
      absolute = new URL(path, baseUrl);
    } catch {
      continue;
    }
    if (absolute.origin !== baseUrl.origin) continue;

    candidates.push({
      url: normalizeUrl(absolute.toString()),
      score,
      numericHint: hint,
    });
  }

  return candidates;
}

function mergeCandidate(
  map: Map<string, Candidate>,
  incoming: {
    url: string;
    score: number;
    sourceHint: string;
    title?: string;
    numericHint?: number;
  },
): void {
  const existing = map.get(incoming.url);
  if (!existing) {
    map.set(incoming.url, {
      url: incoming.url,
      score: incoming.score,
      titleHints: incoming.title ? [incoming.title] : [],
      sourceHints: new Set([incoming.sourceHint]),
      numericHint: incoming.numericHint,
    });
    return;
  }

  existing.score = Math.max(existing.score, incoming.score);
  existing.sourceHints.add(incoming.sourceHint);
  if (incoming.title) existing.titleHints.push(incoming.title);
  if (
    existing.numericHint === undefined &&
    incoming.numericHint !== undefined
  ) {
    existing.numericHint = incoming.numericHint;
  }
}

async function fetchTextWithTimeout(
  url: string,
  timeoutMs: number,
): Promise<{ status: number; contentType: string; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    const body = await response.text();
    return { status: response.status, contentType, body };
  } finally {
    clearTimeout(timer);
  }
}

async function discoverTasks(
  options: DiscoveryOptions,
): Promise<{ manifest: ManifestEntry[]; diagnostics: DiscoveryDiagnostics }> {
  const baseUrl = new URL(options.url);
  const queue: string[] = [normalizeUrl(baseUrl.toString())];
  const seen = new Set<string>();
  const candidates = new Map<string, Candidate>();
  const pages: PageRecord[] = [];
  const warnings: string[] = [];

  while (queue.length > 0 && seen.size < options.maxPages) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);

    let fetched: { status: number; contentType: string; body: string };
    try {
      fetched = await fetchTextWithTimeout(current, options.timeoutMs);
    } catch (error) {
      warnings.push(`Failed to fetch ${current}: ${String(error)}`);
      continue;
    }

    pages.push({
      url: current,
      status: fetched.status,
      contentType: fetched.contentType,
    });

    if (!fetched.contentType.toLowerCase().includes("text/html")) continue;

    const pageUrl = new URL(current);
    const anchors = extractAnchorCandidates(fetched.body, pageUrl);
    for (const anchor of anchors) {
      mergeCandidate(candidates, {
        url: anchor.url,
        score: anchor.score,
        sourceHint: "dom",
        title: anchor.title,
        numericHint: anchor.numericHint,
      });
      if (!seen.has(anchor.url)) queue.push(anchor.url);
    }

    const routeLiterals = extractRouteCandidates(fetched.body, pageUrl);
    for (const route of routeLiterals) {
      mergeCandidate(candidates, {
        url: route.url,
        score: route.score,
        sourceHint: "route",
        numericHint: route.numericHint,
      });
      if (!seen.has(route.url)) queue.push(route.url);
    }
  }

  const selected = Array.from(candidates.values())
    .sort((a, b) => {
      const aHasNum = a.numericHint !== undefined ? 1 : 0;
      const bHasNum = b.numericHint !== undefined ? 1 : 0;
      if (aHasNum !== bHasNum) return bHasNum - aHasNum;
      if (a.numericHint !== undefined && b.numericHint !== undefined) {
        return a.numericHint - b.numericHint;
      }
      if (a.score !== b.score) return b.score - a.score;
      return a.url.localeCompare(b.url);
    })
    .slice(0, options.expectedCount);

  const manifest: ManifestEntry[] = selected.map((c, index) => {
    const idNumber = c.numericHint ?? index + 1;
    const taskId = `task-${String(idNumber).padStart(2, "0")}`;
    const title = pickTitle(c, taskId);
    const source: ManifestEntry["discoverySource"] =
      c.sourceHints.size > 1
        ? "mixed"
        : c.sourceHints.has("route")
          ? "route"
          : "dom";
    return {
      taskId,
      title,
      entryUrl: c.url,
      discoverySource: source,
      score: c.score,
    };
  });

  const diagnostics: DiscoveryDiagnostics = {
    startedAt: new Date().toISOString(),
    seedUrl: options.url,
    expectedCount: options.expectedCount,
    crawledPages: seen.size,
    candidateCount: candidates.size,
    selectedCount: manifest.length,
    pages,
    warnings,
  };

  if (manifest.length !== options.expectedCount) {
    diagnostics.warnings.push(
      `Expected ${options.expectedCount} tasks, discovered ${manifest.length}.`,
    );
  }

  return { manifest, diagnostics };
}

function pickTitle(candidate: Candidate, fallback: string): string {
  if (candidate.titleHints.length === 0) return fallback;
  const cleaned = candidate.titleHints
    .map((title) => normalizeWhitespace(title))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  return cleaned[0] || fallback;
}

function writeJsonFile(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}

function printSummary(
  options: DiscoveryOptions,
  manifest: ManifestEntry[],
  diagnosticsPath: string,
): void {
  console.log(`Discovered ${manifest.length} task candidates.`);
  console.log(`Manifest: ${options.outFile}`);
  console.log(`Diagnostics: ${diagnosticsPath}`);
  if (manifest.length !== options.expectedCount) {
    console.warn(
      `Count mismatch: expected ${options.expectedCount}, got ${manifest.length}`,
    );
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.manualManifest) {
    const manifest = await loadAndValidateManualManifest(
      options.manualManifest,
      options.expectedCount,
    );
    const diagnosticsPath = options.outFile.replace(
      /\.json$/i,
      ".diagnostics.json",
    );
    const diagnostics: DiscoveryDiagnostics = {
      startedAt: new Date().toISOString(),
      seedUrl: options.url,
      expectedCount: options.expectedCount,
      crawledPages: 0,
      candidateCount: manifest.length,
      selectedCount: manifest.length,
      pages: [],
      warnings: [
        `Loaded manifest from --manual-manifest: ${options.manualManifest}`,
      ],
    };
    writeJsonFile(options.outFile, manifest);
    writeJsonFile(diagnosticsPath, diagnostics);
    printSummary(options, manifest, diagnosticsPath);
    return;
  }

  const { manifest, diagnostics } = await discoverTasks(options);
  const diagnosticsPath = options.outFile.replace(/\.json$/i, ".diagnostics.json");

  writeJsonFile(options.outFile, manifest);
  writeJsonFile(diagnosticsPath, diagnostics);
  printSummary(options, manifest, diagnosticsPath);
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});

async function loadAndValidateManualManifest(
  path: string,
  expectedCount: number,
): Promise<ManifestEntry[]> {
  const raw = await Bun.file(path).text();
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("--manual-manifest must be a JSON array.");
  }

  const manifest: ManifestEntry[] = parsed.map((row: unknown, idx: number) => {
    if (!row || typeof row !== "object") {
      throw new Error(`Invalid manifest row at index ${idx}.`);
    }
    const rec = row as Record<string, unknown>;
    const taskId = String(rec.taskId || "").trim();
    const title = String(rec.title || "").trim();
    const entryUrl = String(rec.entryUrl || "").trim();
    const source = String(rec.discoverySource || "dom").trim();
    const score = Number(rec.score ?? 0);

    if (!/^task-[0-9]{2}$/.test(taskId)) {
      throw new Error(`Invalid taskId at index ${idx}: ${taskId}`);
    }
    if (!title) throw new Error(`Missing title at index ${idx}.`);
    if (!entryUrl || !/^https?:\/\//i.test(entryUrl)) {
      throw new Error(`Invalid entryUrl at index ${idx}: ${entryUrl}`);
    }
    if (!["dom", "route", "mixed"].includes(source)) {
      throw new Error(
        `Invalid discoverySource at index ${idx}: ${source}. Expected dom|route|mixed.`,
      );
    }
    return {
      taskId,
      title,
      entryUrl,
      discoverySource: source as ManifestEntry["discoverySource"],
      score: Number.isFinite(score) ? score : 0,
    };
  });

  if (manifest.length !== expectedCount) {
    throw new Error(
      `Manual manifest count mismatch: expected ${expectedCount}, got ${manifest.length}.`,
    );
  }
  return manifest;
}
