import { cleanLabel, escapeRegExp, normalizeText, tokenizeCompletionText } from "./text-utils";

export function extractSentenceScopedDefinitionAnswer(
  sentence: string,
  targetPattern: string,
): string | null {
  const subjectPattern = `(?:the\\s+)?(?:term\\s+)?${targetPattern}\\b`;
  const patterns = [
    `^\\s*${subjectPattern}\\s+(?:means|refers\\s+to|stands\\s+for)\\s+([^.;\\n]{2,180})`,
    `^\\s*${subjectPattern}\\s+(?:is|are|was|were)\\s+defined\\s+as\\s+([^.;\\n]{2,180})`,
    `^\\s*${subjectPattern}\\s+(?:is|are|was|were)\\s+((?:a|an|the)\\s+[^.;\\n]{2,180})`,
  ];

  for (const pattern of patterns) {
    const match = new RegExp(pattern, "i").exec(sentence);
    const answer = cleanSentenceScopedDefinitionAnswerText(match?.[1] ?? "");
    if (answer) return answer;
  }

  return null;
}

export function cleanSentenceScopedDefinitionAnswerText(value: string): string {
  const answer = cleanSentenceScopedAnswerText(value);
  if (tokenizeCompletionText(answer).length < 2) return "";
  return answer;
}

export function sentenceScopedReasonPredicatePatternForLabel(
  label: string,
): string | null {
  const normalizedLabel = normalizeText(label);
  if (normalizedLabel === "delayed reason") return "delayed";
  if (normalizedLabel === "blocked reason") return "blocked";
  if (normalizedLabel === "failed reason") return "failed";
  if (normalizedLabel === "canceled reason") return "cancel(?:ed|led)";
  if (normalizedLabel === "rejected reason") return "rejected";
  if (normalizedLabel === "paused reason") return "paused";
  if (normalizedLabel === "stopped reason") return "stopped";
  if (normalizedLabel === "closed reason") return "closed";
  if (normalizedLabel === "escalated reason") return "escalated";
  if (normalizedLabel === "on hold reason") return "on\\s+hold";
  return null;
}

export function extractSentenceScopedReasonAnswer(
  sentence: string,
  targetPattern: string,
  predicatePattern: string,
): string | null {
  const verbPattern =
    "(?:is|are|was|were|has\\s+been|have\\s+been|got|became|becomes|remains|remain)";
  const targetPredicatePattern = `^\\s*${targetPattern}\\b\\s+(?:${verbPattern}\\s+)?${predicatePattern}\\b`;
  const patterns = [
    `${targetPredicatePattern}\\s+because\\s+of\\s+([^.;\\n]{2,180})`,
    `${targetPredicatePattern}\\s+(?:because|since)\\s+([^.;\\n]{2,180})`,
    `${targetPredicatePattern}\\s+due\\s+to\\s+([^.;\\n]{2,180})`,
  ];

  for (const pattern of patterns) {
    const match = new RegExp(pattern, "i").exec(sentence);
    const answer = cleanSentenceScopedReasonAnswerText(match?.[1] ?? "");
    if (answer) return answer;
  }

  return null;
}

export function cleanSentenceScopedReasonAnswerText(value: string): string {
  const answer = cleanSentenceScopedAnswerText(value);
  if (tokenizeCompletionText(answer).length < 2) return "";
  return answer;
}

export function extractSentenceScopedLocationAnswer(
  sentence: string,
  targetPattern: string,
): string | null {
  const bePattern =
    "(?:is|are|was|were|has\\s+been|have\\s+been|got|became|becomes|remains|remain)";
  const locationVerbPattern =
    "(?:located|based|hosted|deployed|stored|running)";
  const prepositionPattern = "(?:in|at|on|inside|within|near)";
  const patterns = [
    `^\\s*${targetPattern}\\b\\s+(?:${bePattern}\\s+)?${locationVerbPattern}\\s+${prepositionPattern}\\s+([^.;\\n]{2,160})`,
    `^\\s*${targetPattern}\\b\\s+(?:runs?|ran|resides?|lives?)\\s+${prepositionPattern}\\s+([^.;\\n]{2,160})`,
    `^\\s*${targetPattern}\\b(?:\\s*(?:'|\\u2019)s)?\\s+location\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*([^.;\\n]{2,160})`,
    `^\\s*location\\s+(?:for|of)\\s+(?:the\\s+)?${targetPattern}\\b\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*([^.;\\n]{2,160})`,
  ];

  for (const pattern of patterns) {
    const match = new RegExp(pattern, "i").exec(sentence);
    const answer = cleanSentenceScopedLocationAnswerText(match?.[1] ?? "");
    if (answer) return answer;
  }

  return null;
}

export function cleanSentenceScopedLocationAnswerText(value: string): string {
  const answer = cleanSentenceScopedAnswerText(value);
  if (!answer) return "";
  if (
    /\b(?:is|are|was|were|has\s+been|have\s+been)\s+(?:located|based|hosted|deployed|stored|running)\b/i.test(
      answer,
    ) ||
    /\b(?:runs?|ran|resides?|lives?)\s+(?:in|at|on|inside|within|near)\b/i.test(
      answer,
    )
  ) {
    return "";
  }
  return answer;
}

export function sentenceScopedEventDatePatternForLabel(
  label: string,
): string | null {
  const normalizedLabel = normalizeText(label);
  if (normalizedLabel === "launched date") return "launch(?:ed)?";
  if (normalizedLabel === "released date") return "release(?:d)?";
  if (normalizedLabel === "deployed date") return "deploy(?:ed)?";
  if (normalizedLabel === "created date") return "creat(?:e|ed)";
  if (normalizedLabel === "opened date") return "open(?:ed)?";
  if (normalizedLabel === "closed date") return "clos(?:e|ed)";
  if (normalizedLabel === "resolved date") return "resolv(?:e|ed)";
  if (normalizedLabel === "updated date")
    return "(?:updat(?:e|ed)|chang(?:e|ed))";
  if (normalizedLabel === "approved date") return "approv(?:e|ed)";
  if (normalizedLabel === "reviewed date") return "review(?:ed)?";
  if (normalizedLabel === "completed date") return "complet(?:e|ed)";
  if (normalizedLabel === "submitted date") return "submit(?:ted)?";
  if (normalizedLabel === "published date") return "publish(?:ed)?";
  if (normalizedLabel === "started date") return "start(?:ed)?";
  if (normalizedLabel === "stopped date") return "stop(?:ped)?";
  if (normalizedLabel === "scheduled date") return "schedul(?:e|ed)";
  if (normalizedLabel === "canceled date") return "cancel(?:ed|led)?";
  return null;
}

export function extractSentenceScopedEventDateAnswer(
  sentence: string,
  targetPattern: string,
  eventPattern: string,
  normalizedLabel: string,
): string | null {
  const bePattern =
    "(?:is|are|was|were|has\\s+been|have\\s+been|got|became|becomes)";
  const datePattern = sentenceScopedEventDateAnswerPattern();
  const eventNounPattern =
    sentenceScopedEventDateNounPatternForLabel(normalizedLabel);
  const patterns = [
    `^\\s*${targetPattern}\\b\\s+(?:${bePattern}\\s+)?${eventPattern}\\s+(?:on|at)\\s+(${datePattern})\\s*$`,
    `^\\s*${targetPattern}\\b\\s+(?:${bePattern}\\s+)?${eventPattern}\\s+(?:in|during)\\s+(${datePattern})\\s*$`,
    `^\\s*${targetPattern}\\b(?:\\s*(?:'|\\u2019)s)?\\s+${eventNounPattern}\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*(${datePattern})\\s*$`,
    `^\\s*${eventNounPattern}\\s+(?:for|of)\\s+(?:the\\s+)?${targetPattern}\\b\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*(${datePattern})\\s*$`,
  ];

  for (const pattern of patterns) {
    const match = new RegExp(pattern, "i").exec(sentence);
    const answer = cleanSentenceScopedEventDateAnswerText(match?.[1] ?? "");
    if (answer) return answer;
  }

  return null;
}

export function sentenceScopedEventDateNounPatternForLabel(label: string): string {
  const normalizedLabel = normalizeText(label).replace(/\s+date$/, "");
  if (normalizedLabel === "launched") return "(?:launch|launched)\\s+date";
  if (normalizedLabel === "released") return "(?:release|released)\\s+date";
  if (normalizedLabel === "deployed")
    return "(?:deploy|deployment|deployed)\\s+date";
  if (normalizedLabel === "created")
    return "(?:create|creation|created)\\s+date";
  if (normalizedLabel === "opened") return "(?:open|opened)\\s+date";
  if (normalizedLabel === "closed") return "(?:close|closure|closed)\\s+date";
  if (normalizedLabel === "resolved")
    return "(?:resolve|resolution|resolved)\\s+date";
  if (normalizedLabel === "updated")
    return "(?:update|change|updated|changed)\\s+date";
  if (normalizedLabel === "approved")
    return "(?:approve|approval|approved)\\s+date";
  if (normalizedLabel === "reviewed") return "(?:review|reviewed)\\s+date";
  if (normalizedLabel === "completed")
    return "(?:complete|completion|completed)\\s+date";
  if (normalizedLabel === "submitted")
    return "(?:submit|submission|submitted)\\s+date";
  if (normalizedLabel === "published")
    return "(?:publish|publication|published)\\s+date";
  if (normalizedLabel === "started") return "(?:start|started)\\s+date";
  if (normalizedLabel === "stopped") return "(?:stop|stopped)\\s+date";
  if (normalizedLabel === "scheduled") return "(?:schedule|scheduled)\\s+date";
  if (normalizedLabel === "canceled")
    return "(?:cancel|cancellation|canceled|cancelled)\\s+date";
  return `${escapeRegExp(normalizedLabel)}\\s+date`;
}

export function sentenceScopedEventDateAnswerPattern(): string {
  const month =
    "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  const clock =
    "(?:[01]?\\d|2[0-3]):[0-5]\\d(?:\\s*(?:am|pm|utc|gmt|[a-z]{2,4}))?";
  const namedDate = `${month}\\.?\\s+\\d{1,2}(?:,\\s*\\d{4})?`;
  const dayFirstDate = `\\d{1,2}\\s+${month}\\.?\\s+\\d{4}`;
  const isoDate = "\\d{4}-\\d{2}-\\d{2}";
  const slashDate = "\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}";
  const monthYear = `${month}\\.?\\s+\\d{4}`;
  const quarter = "q[1-4]\\s+\\d{4}";
  const year = "\\d{4}";
  return `(?:(?:${namedDate}|${dayFirstDate}|${isoDate}|${slashDate})(?:\\s+(?:at\\s+)?${clock})?|${monthYear}|${quarter}|${year}|${clock})`;
}

export function cleanSentenceScopedEventDateAnswerText(value: string): string {
  const answer = cleanSentenceScopedAnswerText(value);
  if (!answer) return "";
  return new RegExp(`^${sentenceScopedEventDateAnswerPattern()}$`, "i").test(
    answer,
  )
    ? answer
    : "";
}

export function sentenceScopedCountMetricPatternForLabel(
  label: string,
): string | null {
  const normalizedLabel = normalizeText(label);
  if (!normalizedLabel.endsWith(" count")) return null;
  const metric = normalizedLabel.replace(/\s+count$/, "");
  const tokens = tokenizeCompletionText(metric);
  if (tokens.length < 2 || tokens.length > 6) return null;
  return tokens.map(escapeRegExp).join("\\s+");
}

export function sentenceScopedPresenceMetricPatternForLabel(
  label: string,
): string | null {
  const normalizedLabel = normalizeText(label);
  if (!normalizedLabel.endsWith(" presence")) return null;
  const metric = normalizedLabel.replace(/\s+presence$/, "");
  const tokens = tokenizeCompletionText(metric);
  if (tokens.length < 2 || tokens.length > 6) return null;
  return tokens.map(escapeRegExp).join("\\s+");
}

export function extractSentenceScopedTargetCountAnswer(
  sentence: string,
  targetPattern: string,
  metricPattern: string,
): string | null {
  const countPattern = sentenceScopedTargetCountAnswerPattern();
  const adverbPattern = sentenceScopedTargetCountAdverbPattern();
  const zeroPatterns = [
    `^\\s*${targetPattern}\\b\\s+no\\s+longer\\s+(?:has|have|had|contains?|includes?|shows?|lists?|tracks?|reports?)\\s+(?:any\\s+)?${metricPattern}\\s*$`,
    `^\\s*${targetPattern}\\b\\s+${adverbPattern}(?:has|have|had|contains?|includes?|shows?|lists?|tracks?|reports?)\\s+(?:no|zero)\\s+${metricPattern}\\s*$`,
    `^\\s*${targetPattern}\\b\\s+(?:does|do|did)\\s+${adverbPattern}not\\s+(?:have|contain|include|show|list|track|report)\\s+(?:any\\s+)?${metricPattern}\\s*$`,
    `^\\s*(?:there\\s+(?:is|are|was|were)\\s+no\\s+longer\\s+)(?:any\\s+)?${metricPattern}\\s+(?:for|of|on|in)\\s+(?:the\\s+)?${targetPattern}\\b\\s*$`,
    `^\\s*(?:there\\s+(?:is|are|was|were)\\s+${adverbPattern})(?:no|zero)\\s+${metricPattern}\\s+(?:for|of|on|in)\\s+(?:the\\s+)?${targetPattern}\\b\\s*$`,
    `^\\s*(?:there\\s+(?:is|are|was|were)\\s+${adverbPattern}not\\s+)(?:any\\s+)?${metricPattern}\\s+(?:for|of|on|in)\\s+(?:the\\s+)?${targetPattern}\\b\\s*$`,
  ];
  for (const pattern of zeroPatterns) {
    if (new RegExp(pattern, "i").test(sentence)) return "zero";
  }

  const patterns = [
    `^\\s*${targetPattern}\\b\\s+${adverbPattern}(?:has|have|had|contains?|includes?|shows?|lists?|tracks?|reports?)\\s+(${countPattern})\\s+${metricPattern}\\s*$`,
    `^\\s*${targetPattern}\\b\\s+${adverbPattern}(?:has|have|had|contains?|includes?|shows?|lists?|tracks?|reports?)\\s+(${countPattern})\\s+${metricPattern}\\s+(?:left|remaining)\\s*$`,
    `^\\s*${targetPattern}\\b(?:\\s*(?:'|\\u2019)s)?\\s+${metricPattern}\\s+(?:count|number|quantity)\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*(${countPattern})\\s*$`,
    `^\\s*${metricPattern}\\s+(?:count|number|quantity)\\s+(?:for|of|on|in)\\s+(?:the\\s+)?${targetPattern}\\b\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*(${countPattern})\\s*$`,
    `^\\s*(?:there\\s+(?:is|are|was|were)\\s+${adverbPattern})?(${countPattern})\\s+${metricPattern}\\s+(?:for|of|on|in)\\s+(?:the\\s+)?${targetPattern}\\b\\s*$`,
    `^\\s*(?:there\\s+(?:is|are|was|were)\\s+${adverbPattern})?(${countPattern})\\s+${metricPattern}\\s+(?:left|remaining)\\s+(?:for|of|on|in)\\s+(?:the\\s+)?${targetPattern}\\b\\s*$`,
    `^\\s*(${countPattern})\\s+${metricPattern}\\s+(?:(?:${adverbPattern}(?:remain|remains))|(?:(?:is|are|was|were)\\s+${adverbPattern}(?:left|remaining)))\\s+(?:for|of|on|in)\\s+(?:the\\s+)?${targetPattern}\\b\\s*$`,
  ];

  for (const pattern of patterns) {
    const match = new RegExp(pattern, "i").exec(sentence);
    const answer = cleanSentenceScopedTargetCountAnswerText(match?.[1] ?? "");
    if (answer) return answer;
  }
  return null;
}

export function sentenceScopedTargetCountAnswerPattern(): string {
  return "(?:\\d[\\d,]*(?:\\.\\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)";
}

export function cleanSentenceScopedTargetCountAnswerText(value: string): string {
  const answer = cleanSentenceScopedAnswerText(value);
  if (!answer) return "";
  return new RegExp(`^${sentenceScopedTargetCountAnswerPattern()}$`, "i").test(
    answer,
  )
    ? answer
    : "";
}

export function sentenceScopedTargetCountAdverbPattern(): string {
  return "(?:(?:currently|still|now|presently|actively)\\s+)?";
}

export function extractSentenceScopedTargetPresenceAnswer(
  sentence: string,
  targetPattern: string,
  metricPattern: string,
): string | null {
  const countPattern = sentenceScopedTargetCountAnswerPattern();
  const adverbPattern = sentenceScopedTargetPresenceAdverbPattern();
  const noPatterns = [
    `^\\s*${targetPattern}\\b\\s+no\\s+longer\\s+(?:has|have|had|contains?|includes?|shows?|lists?|tracks?|reports?)\\s+(?:any\\s+)?${metricPattern}\\s*$`,
    `^\\s*${targetPattern}\\b\\s+${adverbPattern}(?:has|have|had|contains?|includes?|shows?|lists?|tracks?|reports?)\\s+(?:no|zero)\\s+${metricPattern}\\s*$`,
    `^\\s*${targetPattern}\\b\\s+(?:does|do|did)\\s+${adverbPattern}not\\s+(?:have|contain|include|show|list|track|report)\\s+(?:any\\s+)?${metricPattern}\\s*$`,
    `^\\s*(?:there\\s+(?:is|are|was|were)\\s+no\\s+longer\\s+)(?:any\\s+)?${metricPattern}\\s+(?:for|of|on|in)\\s+(?:the\\s+)?${targetPattern}\\b\\s*$`,
    `^\\s*(?:there\\s+(?:is|are|was|were)\\s+${adverbPattern})(?:no|zero)\\s+${metricPattern}\\s+(?:for|of|on|in)\\s+(?:the\\s+)?${targetPattern}\\b\\s*$`,
    `^\\s*(?:there\\s+(?:is|are|was|were)\\s+${adverbPattern}not\\s+)(?:any\\s+)?${metricPattern}\\s+(?:for|of|on|in)\\s+(?:the\\s+)?${targetPattern}\\b\\s*$`,
  ];
  for (const pattern of noPatterns) {
    if (new RegExp(pattern, "i").test(sentence)) return "no";
  }

  const countPatterns = [
    `^\\s*${targetPattern}\\b\\s+${adverbPattern}(?:has|have|had|contains?|includes?|shows?|lists?|tracks?|reports?)\\s+(${countPattern})\\s+${metricPattern}\\s*$`,
    `^\\s*(?:there\\s+(?:is|are|was|were)\\s+${adverbPattern})?(${countPattern})\\s+${metricPattern}\\s+(?:for|of|on|in)\\s+(?:the\\s+)?${targetPattern}\\b\\s*$`,
  ];
  for (const pattern of countPatterns) {
    const match = new RegExp(pattern, "i").exec(sentence);
    const count = cleanSentenceScopedTargetCountAnswerText(match?.[1] ?? "");
    if (count)
      return sentenceScopedTargetCountAnswerIsZero(count) ? "no" : "yes";
  }

  return null;
}

export function sentenceScopedTargetPresenceAdverbPattern(): string {
  return "(?:(?:currently|still|now|presently|actively)\\s+)?";
}

export function sentenceScopedTargetCountAnswerIsZero(value: string): boolean {
  const normalized = normalizeText(value).replace(/,/g, "");
  if (normalized === "zero") return true;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric === 0;
}

export function extractSentenceScopedTargetMetricValueAnswer(
  sentence: string,
  targetPattern: string,
  metricPattern: string,
): string | null {
  const answerPattern = sentenceScopedMetricValueAnswerPattern();
  const patterns = [
    `^\\s*${targetPattern}\\b(?:\\s*(?:'|\\u2019)s)?\\s+(?:current\\s+|latest\\s+|reported\\s+)?${metricPattern}\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*(${answerPattern})\\s*$`,
    `^\\s*(?:current\\s+|latest\\s+|reported\\s+)?${metricPattern}\\s+(?:for|of|on|in)\\s+(?:the\\s+)?${targetPattern}\\b\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*(${answerPattern})\\s*$`,
    `^\\s*${targetPattern}\\b\\s+(?:has|have|had|shows?|lists?|tracks?|reports?)\\s+(?:a\\s+|an\\s+|the\\s+)?(?:current\\s+|latest\\s+|reported\\s+)?${metricPattern}\\s+(?:of|at|as)\\s+(${answerPattern})\\s*$`,
    `^\\s*${targetPattern}\\b\\s+(?:shows?|lists?|tracks?|reports?)\\s+(?:a\\s+|an\\s+|the\\s+)?(?:current\\s+|latest\\s+|reported\\s+)?${metricPattern}\\s*(${answerPattern})\\s*$`,
  ];

  for (const pattern of patterns) {
    const match = new RegExp(pattern, "i").exec(sentence);
    const answer = cleanSentenceScopedMetricValueAnswerText(match?.[1] ?? "");
    if (answer) return answer;
  }
  return null;
}

export function sentenceScopedMetricValueAnswerPattern(): string {
  const numeric = "\\d[\\d,]*(?:\\.\\d+)?";
  const unit =
    "(?:%|percentage|percent|points?|pts?|ms|msec|milliseconds?|sec|secs|seconds?|s|mins?|minutes?|m|hrs?|hours?|h|kbps|mbps|gbps|bps|kb|mb|gb|tb|bytes?|kg|mg|g|cm|mm|km|c|f|hz|khz|mhz|ghz|thousand|million|billion|k|b)";
  return `(?:\\$\\s*)?${numeric}(?:\\s*${unit})?`;
}

export function cleanSentenceScopedMetricValueAnswerText(value: string): string {
  const answer = cleanSentenceScopedAnswerText(value);
  if (!answer) return "";
  return new RegExp(`^${sentenceScopedMetricValueAnswerPattern()}$`, "i").test(
    answer,
  )
    ? answer
    : "";
}

export function sentenceScopedTargetStatePatternForLabel(
  label: string,
): string | null {
  const normalizedLabel = normalizeText(label);
  if (normalizedLabel === "active state") return "active";
  if (normalizedLabel === "inactive state") return "inactive";
  if (normalizedLabel === "blocked state") return "blocked";
  if (normalizedLabel === "unblocked state") return "unblocked";
  if (normalizedLabel === "open state") return "open";
  if (normalizedLabel === "closed state") return "closed";
  if (normalizedLabel === "pending state") return "pending";
  if (normalizedLabel === "resolved state") return "resolved";
  if (normalizedLabel === "enabled state") return "enabled";
  if (normalizedLabel === "disabled state") return "disabled";
  if (normalizedLabel === "approved state") return "approved";
  if (normalizedLabel === "rejected state") return "rejected";
  if (normalizedLabel === "completed state")
    return "(?:complete|completed|done)";
  if (normalizedLabel === "failed state") return "failed";
  if (normalizedLabel === "successful state") return "(?:successful|success)";
  if (normalizedLabel === "draft state") return "draft";
  if (normalizedLabel === "submitted state") return "submitted";
  if (normalizedLabel === "sent state") return "sent";
  if (normalizedLabel === "archived state") return "archived";
  if (normalizedLabel === "deleted state") return "deleted";
  if (normalizedLabel === "canceled state") return "cancel(?:ed|led)";
  if (normalizedLabel === "delayed state") return "delayed";
  if (normalizedLabel === "paused state") return "paused";
  if (normalizedLabel === "stopped state") return "stopped";
  if (normalizedLabel === "escalated state") return "escalated";
  if (normalizedLabel === "on hold state") return "on\\s+hold";
  return null;
}

export function extractSentenceScopedTargetStateAnswer(
  sentence: string,
  targetPattern: string,
  statePattern: string,
): string | null {
  const bePattern =
    "(?:is|are|was|were|has\\s+been|have\\s+been|had\\s+been|became|becomes|remains|remain)";
  const adverbPattern = sentenceScopedTargetStateAdverbPattern();
  const negationPattern = "((?:not|no\\s+longer)\\s+)?";
  const tailPattern =
    "(?:\\s+(?:because|since|due\\s+to|by)\\b[^.;\\n]{2,180})?";
  const patterns = [
    `^\\s*${targetPattern}\\b\\s+${bePattern}\\s+${adverbPattern}${negationPattern}${adverbPattern}${statePattern}\\b${tailPattern}\\s*$`,
    `^\\s*${targetPattern}\\b(?:\\s*(?:'|\\u2019)s)?\\s+status\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*${adverbPattern}${negationPattern}${adverbPattern}${statePattern}\\b\\s*$`,
    `^\\s*status\\s+(?:for|of)\\s+(?:the\\s+)?${targetPattern}\\b\\s*(?::|=|\\b(?:is|are|was|were)\\b)\\s*${adverbPattern}${negationPattern}${adverbPattern}${statePattern}\\b\\s*$`,
  ];

  for (const pattern of patterns) {
    const match = new RegExp(pattern, "i").exec(sentence);
    if (!match) continue;
    return normalizeText(match[1] ?? "") ? "no" : "yes";
  }
  return null;
}

export function sentenceScopedTargetStateAdverbPattern(): string {
  return "(?:(?:currently|still|now|presently|actively)\\s+)?";
}

export function extractCurrentRoleRelationNounAnswer(
  sentence: string,
  target: string,
  targetPattern: string,
  relationNounPattern: string,
): string | null {
  const currentRoleAdverbPattern = "(?:currently|presently|now|still|actively)";
  const currentRolePhrasePattern = `(?:(?:${currentRoleAdverbPattern}\\s+)?(?:serves?|acts|functions)\\s+as|(?:is|are)\\s+(?:${currentRoleAdverbPattern}\\s+)?(?:acting|listed|designated|identified|shown|named|recorded|displayed)\\s+as)`;
  const match = new RegExp(
    `([^.;\\n]{2,120}?)\\s+${currentRolePhrasePattern}\\s+(?:the\\s+)?${relationNounPattern}\\s+(?:for|of)\\s+(?:the\\s+)?${targetPattern}\\b`,
    "i",
  ).exec(sentence);

  return cleanActiveSentenceScopedAnswerText(match?.[1] ?? "", target);
}

export function cleanSentenceScopedAnswerText(value: string): string {
  return cleanLabel(
    cleanLabel(value)
      .replace(/\s+\b(?:and|but|while)\b.+$/i, "")
      .replace(/[),.;!?]+$/g, ""),
  );
}

export function cleanActiveSentenceScopedAnswerText(
  value: string,
  target: string,
): string {
  const answer = cleanSentenceScopedAnswerText(value);
  if (!answer) return "";
  return activeSentenceScopedAnswerLooksFlattenedPrefix(answer, target)
    ? ""
    : answer;
}

const FLATTENED_ACTIVE_SENTENCE_PREFIX_SECOND_TOKENS = new Set([
  "board",
  "dashboard",
  "detail",
  "details",
  "inbox",
  "list",
  "overview",
  "page",
  "queue",
  "record",
  "records",
  "report",
  "reports",
  "summary",
  "table",
]);

export function activeSentenceScopedAnswerLooksFlattenedPrefix(
  answer: string,
  target: string,
): boolean {
  const answerTokens = tokenizeCompletionText(answer);
  if (answerTokens.length < 4) return false;
  const targetTokens = tokenizeCompletionText(target);
  const targetHead = targetTokens[0] ?? "";
  if (!targetHead || targetHead.length < 3) return false;
  return (
    answerTokens[0] === targetHead &&
    FLATTENED_ACTIVE_SENTENCE_PREFIX_SECOND_TOKENS.has(answerTokens[1] ?? "")
  );
}

export const SENTENCE_SCOPED_STATUS_ANSWER_PATTERN =
  "(?:in\\s+progress|on\\s+hold|open|closed|pending|resolved|active|inactive|enabled|disabled|blocked|unblocked|approved|rejected|complete|completed|done|failed|successful|success|draft|submitted|sent|archived|deleted|canceled|cancelled)";

export function cleanSentenceScopedStatusAnswer(value: string): string {
  const answer = cleanSentenceScopedAnswerText(value);
  if (!answer) return "";
  const match = new RegExp(
    `^${SENTENCE_SCOPED_STATUS_ANSWER_PATTERN}$`,
    "i",
  ).exec(answer);
  return match ? answer : "";
}

export const SENTENCE_SCOPED_PRIORITY_ANSWER_PATTERN =
  "(?:p[0-5]|sev\\s*[0-5]|critical|urgent|highest|high|medium|normal|standard|low|lowest|minor|major)";

export function cleanSentenceScopedPriorityAnswer(value: string): string {
  const answer = cleanSentenceScopedAnswerText(value);
  if (!answer) return "";
  const match = new RegExp(
    `^${SENTENCE_SCOPED_PRIORITY_ANSWER_PATTERN}$`,
    "i",
  ).exec(answer);
  return match ? answer : "";
}
