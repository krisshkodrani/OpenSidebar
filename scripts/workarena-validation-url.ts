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

function hasSubmittedRecordIdentity(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return /^[A-Z]{2,}\d+$/i.test(trimmed) || /^[0-9a-f]{32}$/i.test(trimmed);
}

function isSubmittedRecordDetailUrl(value: string): boolean {
  const decoded = decodeUrlLike(value).toLowerCase();
  return /\.do\?[^#]*\bsys_id=[0-9a-f]{32}\b/i.test(decoded);
}

function isSubmittedCatalogRequestUrl(value: string): boolean {
  const decoded = decodeUrlLike(value).toLowerCase();
  return (
    /\/(?:sc_request|sc_req_item)\.do\?[^#]*\bsys_id=[0-9a-f]{32}\b/i.test(
      decoded,
    ) ||
    /\/com\.glideapp\.servicecatalog_checkout_view_v2\.do\?[^#]*\bsysparm_sys_id=[0-9a-f]{32}\b/i.test(
      decoded,
    )
  );
}

function isRecordTaskUrlPath(value: string | null): boolean {
  return Boolean(value && /\.do$/i.test(value));
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

function directCatalogCheckoutUrl(value: string): string | null {
  const parsed = parseUrl(value);
  if (!parsed) return null;

  const decoded = decodeUrlLike(value);
  const directMatch = decoded.match(
    /^https?:\/\/[^/]+\/(com\.glideapp\.servicecatalog_checkout_view_v2\.do\?[^#]*\bsysparm_sys_id=[0-9a-f]{32}\b[^#]*)/i,
  );
  if (directMatch) {
    return value;
  }

  const wrappedMatch = decoded.match(
    /^https?:\/\/[^/]+\/now\/nav\/ui\/classic\/params\/target\/(com\.glideapp\.servicecatalog_checkout_view_v2\.do\?[^#]*\bsysparm_sys_id=[0-9a-f]{32}\b[^#]*)/i,
  );
  if (!wrappedMatch) return null;
  return `${parsed.origin}/${wrappedMatch[1]}`;
}

function uniqueCandidates(
  entries: Array<{ source: string; url: string | null | undefined }>,
): Array<{ source: string; url: string }> {
  const seen = new Set<string>();
  const result: Array<{ source: string; url: string }> = [];

  for (const entry of entries) {
    if (!entry.url) continue;
    const directCheckoutUrl = directCatalogCheckoutUrl(entry.url);
    const canonicalUrl = canonicalizeClassicServiceNowUrl(entry.url);
    const variants = [
      ...(directCheckoutUrl
        ? [{ source: `${entry.source}:direct-checkout`, url: directCheckoutUrl }]
        : []),
      ...(canonicalUrl === entry.url
        ? [{ source: entry.source, url: entry.url }]
        : [
            { source: `${entry.source}:canonical`, url: canonicalUrl },
            { source: entry.source, url: entry.url },
          ]),
    ];
    for (const variant of variants) {
      if (!parseUrl(variant.url) || seen.has(variant.url)) continue;
      seen.add(variant.url);
      result.push(variant);
    }
  }

  return result;
}

function preferSubmittedCatalogUrls(
  entries: Array<{ source: string; url: string }>,
): Array<{ source: string; url: string }> {
  const submittedCatalogEntries = entries.filter((entry) =>
    isSubmittedCatalogRequestUrl(entry.url),
  );
  if (submittedCatalogEntries.length === 0) return entries;

  const submitted = new Set(
    submittedCatalogEntries.map((entry) => `${entry.source}\n${entry.url}`),
  );
  return [
    ...submittedCatalogEntries,
    ...entries.filter((entry) => !submitted.has(`${entry.source}\n${entry.url}`)),
  ];
}

export function selectValidationUrl(input: {
  startUrl: string | null;
  browserActiveUrl: string | null;
  importedPageUrl: string;
  finalOpenSidebarUrl: string;
  frameUrls: string[];
  submittedRecordNumber?: string | null;
}): ValidationUrlSelection {
  const expectedUrl = input.startUrl ?? input.browserActiveUrl ?? input.importedPageUrl;
  const expectedOrigin = parseUrl(expectedUrl)?.origin ?? null;
  const expectedPath = workArenaUrlPath(expectedUrl);
  const preferTaskUrlAfterSubmittedRecord = hasSubmittedRecordIdentity(
    input.submittedRecordNumber,
  ) && isRecordTaskUrlPath(expectedPath);
  const entries = preferSubmittedCatalogUrls(
    uniqueCandidates([
      { source: "finalOpenSidebarUrl", url: input.finalOpenSidebarUrl },
      ...input.frameUrls.map((url, index) => ({
        source: `frameUrl:${index + 1}`,
        url,
      })),
      { source: "browserActiveUrl", url: input.browserActiveUrl },
      { source: "importedPageUrl", url: input.importedPageUrl },
      { source: "startUrl", url: input.startUrl },
    ]),
  );

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
    } else if (
      preferTaskUrlAfterSubmittedRecord &&
      !isSubmittedCatalogRequestUrl(entry.url) &&
      isSubmittedRecordDetailUrl(entry.url)
    ) {
      reason = "submitted_record_detail_url";
    } else {
      const candidatePath = workArenaUrlPath(entry.url);
      const isFinalOpenSidebarUrl = entry.source.startsWith("finalOpenSidebarUrl");
      if (
        !isSubmittedCatalogRequestUrl(entry.url) &&
        !isFinalOpenSidebarUrl &&
        expectedPath &&
        (!candidatePath || !candidatePath.includes(expectedPath))
      ) {
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
