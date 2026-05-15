const DIRECT_PAGE_ACTION =
  /\b(click|press|tap|type|enter|fill|select|choose|check|uncheck|submit|log\s?in|sign\s?in|apply|upload|scroll|navigate|open|go to|visit)\b/i;

const PAGE_CONTEXT =
  /\b(page|site|website|tab|browser|form|field|button|link|checkbox|input|dropdown|menu|application|job listing|screen|dashboard|table|record|row)\b/i;

const PAGE_READING_ACTION =
  /\b(read|summari[sz]e|extract|scrape|find|compare|inspect|look at|review)\b/i;

export function shouldShowPageActivityCue(taskText: string): boolean {
  const normalized = taskText.replace(/\s+/g, " ").trim();
  if (!normalized) return false;

  if (DIRECT_PAGE_ACTION.test(normalized)) return true;
  return PAGE_CONTEXT.test(normalized) && PAGE_READING_ACTION.test(normalized);
}
