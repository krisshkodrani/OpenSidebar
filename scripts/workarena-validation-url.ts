export type ValidationUrlCandidate = {
  source: string;
  url: string;
  selected: boolean;
  reason: string | null;
};

export type ValidationUrlSelection = {
  url: string;
  source: string;
  candidates: ValidationUrlCandidate[];
};

function decodeUrlLike(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseUrl(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function workArenaUrlPath(value: string | null | undefined): string | null {
  if (!value) return null;
  const decoded = decodeUrlLike(value);
  return parseUrl(decoded)?.pathname ?? parseUrl(value)?.pathname ?? null;
}

function hasUndefinedReportId(value: string): boolean {
  return decodeUrlLike(value).toLowerCase().includes("jvar_report_id=undefined");
}

function canonicalizeClassicServiceNowUrl(value: string): string {
  const parsed = parseUrl(value);
  if (!parsed) return value;

  const decodedPath = decodeUrlLike(parsed.pathname);
  if (decodedPath.includes("/now/nav/ui/classic/params/target/")) {
    return value;
  }
  if (!/^\/[^/?#]+\.do$/i.test(decodedPath)) {
    return value;
  }

  const target = `${decodedPath.replace(/^\/+/, "")}${parsed.search}`;
  return `${parsed.origin}/now/nav/ui/classic/params/target/${encodeURIComponent(target)}`;
}

function uniqueCandidates(
  entries: Array<{ source: string; url: string | null | undefined }>,
): Array<{ source: string; url: string }> {
  const seen = new Set<string>();
  const result: Array<{ source: string; url: string }> = [];

  for (const entry of entries) {
    if (!entry.url) continue;
    const variants = [
      { source: entry.source, url: entry.url },
      {
        source: `${entry.source}:canonical`,
        url: canonicalizeClassicServiceNowUrl(entry.url),
      },
    ];
    for (const variant of variants) {
      if (!parseUrl(variant.url) || seen.has(variant.url)) continue;
      seen.add(variant.url);
      result.push(variant);
    }
  }

  return result;
}

export function selectValidationUrl(input: {
  startUrl: string | null;
  browserActiveUrl: string | null;
  importedPageUrl: string;
  finalOpenSidebarUrl: string;
  frameUrls: string[];
}): ValidationUrlSelection {
  const expectedUrl = input.startUrl ?? input.browserActiveUrl ?? input.importedPageUrl;
  const expectedOrigin = parseUrl(expectedUrl)?.origin ?? null;
  const expectedPath = workArenaUrlPath(expectedUrl);
  const entries = uniqueCandidates([
    { source: "finalOpenSidebarUrl", url: input.finalOpenSidebarUrl },
    ...input.frameUrls.map((url, index) => ({
      source: `frameUrl:${index + 1}`,
      url,
    })),
    { source: "browserActiveUrl", url: input.browserActiveUrl },
    { source: "importedPageUrl", url: input.importedPageUrl },
    { source: "startUrl", url: input.startUrl },
  ]);

  const candidates: ValidationUrlCandidate[] = [];
  for (const entry of entries) {
    const parsed = parseUrl(entry.url);
    let reason: string | null = null;
    if (!parsed) {
      reason = "invalid_url";
    } else if (hasUndefinedReportId(entry.url)) {
      reason = "undefined_report_id";
    } else if (expectedOrigin && parsed.origin !== expectedOrigin) {
      reason = "origin_mismatch";
    } else {
      const candidatePath = workArenaUrlPath(entry.url);
      if (expectedPath && (!candidatePath || !candidatePath.includes(expectedPath))) {
        reason = "path_mismatch";
      }
    }

    const candidate: ValidationUrlCandidate = {
      source: entry.source,
      url: entry.url,
      selected: reason === null,
      reason,
    };
    candidates.push(candidate);
    if (candidate.selected) {
      return {
        url: entry.url,
        source: entry.source,
        candidates,
      };
    }
  }

  return {
    url: input.finalOpenSidebarUrl,
    source: "finalOpenSidebarUrl:fallback",
    candidates,
  };
}
