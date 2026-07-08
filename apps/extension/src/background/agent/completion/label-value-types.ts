/**
 * Typed precise label-value predicates for read-answer completion evidence.
 *
 * Pure string classifiers extracted verbatim from completion-kernel.ts
 * (RFC LP-16 Phase 1). Each `labelCanHaveXValue` / `isXValue` /
 * `preciseXValueCoveredBySummary` triple recognizes a concrete value type
 * (MAC/IPv6/CIDR, colors, durations, physical units, date/time ranges,
 * coordinates, identifiers) and checks whether a summary covers it. No
 * behavior change — the kernel imports these back.
 */
import { cleanLabel, escapeRegExp, normalizeText } from "./text-utils";

export function labelCanHaveMacAddressValue(expectedAnswerLabel: string): boolean {
  return /\b(?:mac address|hardware address|ethernet address|bssid)\b/i.test(
    expectedAnswerLabel,
  );
}

export function labelCanHaveIpv6AddressValue(expectedAnswerLabel: string): boolean {
  return /\b(?:ipv6|ip|address|gateway|router|resolver|dns|nameserver|endpoint|host|server)\b/i.test(
    expectedAnswerLabel,
  );
}

export function labelCanHaveCidrValue(expectedAnswerLabel: string): boolean {
  return /\b(?:cidr|subnet|network|netblock|address|address block|ip block|prefix|route)\b/i.test(
    expectedAnswerLabel,
  );
}

export function labelCanHavePathValue(expectedAnswerLabel: string): boolean {
  return /\b(?:path|file|folder|directory|dir|route)\b/i.test(
    expectedAnswerLabel,
  );
}

export function labelCanHaveDomainValue(expectedAnswerLabel: string): boolean {
  return /\b(?:domain|host|hostname|site|server|endpoint)\b/i.test(
    expectedAnswerLabel,
  );
}

export function labelCanHaveUuidValue(expectedAnswerLabel: string): boolean {
  return /\b(?:id|identifier|uuid|session|request|trace|run|correlation|result)\b/i.test(
    expectedAnswerLabel,
  );
}

export function labelCanHaveHashValue(expectedAnswerLabel: string): boolean {
  return /\b(?:hash|checksum|digest|sha(?:-?\d+)?|md5)\b/i.test(
    expectedAnswerLabel,
  );
}

export function labelCanHaveColorValue(expectedAnswerLabel: string): boolean {
  return /\b(?:color|colour|hex|palette|theme|background|foreground|accent|brand|fill|stroke)\b/i.test(
    expectedAnswerLabel,
  );
}

export function labelCanHaveDurationValue(expectedAnswerLabel: string): boolean {
  return /\b(?:duration|timeout|latency|delay|ttl|interval|sla|window|period|retention|expiry|expiration|rto|rpo)\b/i.test(
    expectedAnswerLabel,
  );
}

export function labelCanHaveDataSizeValue(expectedAnswerLabel: string): boolean {
  return /\b(?:size|capacity|quota|limit|storage|memory|disk|upload|download|payload|artifact|file|bundle|cache)\b/i.test(
    expectedAnswerLabel,
  );
}

export function labelCanHaveDataRateValue(expectedAnswerLabel: string): boolean {
  return /\b(?:bandwidth|throughput|speed|bitrate|transfer|download|upload|network|connection|link)\b/i.test(
    expectedAnswerLabel,
  );
}

export function labelCanHavePhysicalSpeedValue(expectedAnswerLabel: string): boolean {
  return /\b(?:speed|velocity|pace|wind|cruise|travel|groundspeed|airspeed|knots?)\b/i.test(
    expectedAnswerLabel,
  );
}

export function labelCanHaveTemperatureValue(expectedAnswerLabel: string): boolean {
  return /\b(?:temperature|temp|thermal|ambient)\b/i.test(expectedAnswerLabel);
}

export function labelCanHaveElectricalValue(expectedAnswerLabel: string): boolean {
  return /\b(?:voltage|volt|current|amp|amperage|power|watt|energy|battery|charge|load|draw|consumption|input|output|electrical)\b/i.test(
    expectedAnswerLabel,
  );
}

export function labelCanHaveMassValue(expectedAnswerLabel: string): boolean {
  return /\b(?:weight|mass|payload|tare|gross|net)\b/i.test(
    expectedAnswerLabel,
  );
}

export function labelCanHaveLengthValue(expectedAnswerLabel: string): boolean {
  return /\b(?:length|height|width|depth|distance|radius|diameter|dimension|span|clearance|offset|elevation|altitude)\b/i.test(
    expectedAnswerLabel,
  );
}

export function labelCanHaveAreaValue(expectedAnswerLabel: string): boolean {
  return /\b(?:area|surface|footprint|coverage|square footage|floor space|acreage|plot|parcel)\b/i.test(
    expectedAnswerLabel,
  );
}

export function labelCanHaveVolumeValue(expectedAnswerLabel: string): boolean {
  return /\b(?:volume|capacity|displacement|tank|reservoir|fluid|liquid|container|bottle|dose|dosage)\b/i.test(
    expectedAnswerLabel,
  );
}

export function labelCanHavePressureValue(expectedAnswerLabel: string): boolean {
  return /\b(?:pressure|psi|pascal|bar|hydraulic|pneumatic|vacuum|gauge|tire)\b/i.test(
    expectedAnswerLabel,
  );
}

export function labelCanHaveFrequencyValue(expectedAnswerLabel: string): boolean {
  return /\b(?:frequency|hertz|hz|refresh|sample|sampling|clock|oscillator|cycle|rpm|rotation)\b/i.test(
    expectedAnswerLabel,
  );
}

export function labelCanHaveDateRangeValue(expectedAnswerLabel: string): boolean {
  return /\b(?:date range|date window|dates?|window|schedule|scheduled|period|validity|effective|coverage|start date|end date)\b/i.test(
    expectedAnswerLabel,
  );
}

export function labelCanHaveTimeRangeValue(expectedAnswerLabel: string): boolean {
  return /\b(?:time range|time window|window|schedule|scheduled|maintenance|service hours|business hours|office hours|hours|shift|slot|period)\b/i.test(
    expectedAnswerLabel,
  );
}

export function labelCanHaveTimezoneValue(expectedAnswerLabel: string): boolean {
  return /\b(?:timezone|time zone|tz|utc|gmt)\b/i.test(expectedAnswerLabel);
}

export function labelCanHaveLocaleValue(expectedAnswerLabel: string): boolean {
  return /\b(?:locale|language|lang|i18n|regional format|region format)\b/i.test(
    expectedAnswerLabel,
  );
}

export function labelCanHaveCoordinatePairValue(expectedAnswerLabel: string): boolean {
  return /\b(?:coordinates?|coordinate pair|gps|geo|geolocation|lat(?:itude)?\s*(?:\/|and|,)?\s*(?:lon|lng|longitude)|location)\b/i.test(
    expectedAnswerLabel,
  );
}

export function isDomainNameValue(value: string): boolean {
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
    cleanLabel(value),
  );
}

export function isMacAddressValue(value: string): boolean {
  return /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(cleanLabel(value));
}

export function isIpv6AddressValue(value: string): boolean {
  const cleaned = cleanLabel(value);
  if (!/^[0-9a-f:]+(?:%[a-z0-9_.-]+)?$/i.test(cleaned)) return false;
  const address = cleaned.split("%", 1)[0] ?? "";
  if (!address || address.includes(":::")) return false;

  const validGroup = (part: string) => /^[0-9a-f]{1,4}$/i.test(part);
  if (address.includes("::")) {
    if (address.indexOf("::") !== address.lastIndexOf("::")) return false;
    const [leftText = "", rightText = ""] = address.split("::");
    const left = leftText ? leftText.split(":") : [];
    const right = rightText ? rightText.split(":") : [];
    if (![...left, ...right].every(validGroup)) return false;
    return left.length + right.length < 8;
  }

  const groups = address.split(":");
  return groups.length === 8 && groups.every(validGroup);
}

export function isIpv6CidrValue(value: string): boolean {
  const cleaned = cleanLabel(value);
  const match = /^(.+)\/(\d{1,3})$/.exec(cleaned);
  if (!match) return false;
  const prefix = Number(match[2]);
  return prefix >= 0 && prefix <= 128 && isIpv6AddressValue(match[1] ?? "");
}

export function isCidrValue(value: string): boolean {
  const cleaned = cleanLabel(value);
  const match = /^(\d{1,3})(?:\.(\d{1,3})){3}\/(\d{1,2})$/.exec(cleaned);
  if (!match) return false;
  const prefix = Number(match[3]);
  if (prefix < 0 || prefix > 32) return false;
  return cleaned
    .split("/", 1)[0]
    .split(".")
    .every((part) => {
      const octet = Number(part);
      return Number.isInteger(octet) && octet >= 0 && octet <= 255;
    });
}

export function preciseMacAddressValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9:-])${escapeRegExp(normalizedValue)}(?=$|[\\s,;!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

export function preciseIpv6ValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9:%])${escapeRegExp(normalizedValue)}(?=$|[\\s,;!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

export function preciseIpv6CidrValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9:%./])${escapeRegExp(normalizedValue)}(?=$|[\\s,;!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

export function preciseCidrValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9./])${escapeRegExp(normalizedValue)}(?=$|[\\s,;!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

export function isPathValue(value: string): boolean {
  return /^(?:(?:~|\.{1,2})?\/|[a-z]:\\|\\\\)\S+$/i.test(cleanLabel(value));
}

export function precisePathValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[\\s"'(])${escapeRegExp(normalizedValue)}(?=$|[\\s,;!?)"']|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

export function preciseDomainValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9.-])${escapeRegExp(normalizedValue)}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

export function isDottedVersionValue(value: string): boolean {
  return /^(?:v(?:ersion)?\s*)?\d+(?:\.\d+){1,5}(?:[-+][a-z0-9][a-z0-9.-]*)?$/i.test(
    cleanLabel(value),
  );
}

export function preciseVersionValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9])${escapeRegExp(normalizedValue)}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

export function isHashValue(value: string): boolean {
  return /^(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{56}|[a-f0-9]{64}|[a-f0-9]{96}|[a-f0-9]{128})$/i.test(
    cleanLabel(value),
  );
}

export function preciseHashValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9])${escapeRegExp(normalizedValue)}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

export function isHexColorValue(value: string): boolean {
  return /^#[a-f0-9]{3}(?:[a-f0-9]{3})?(?:[a-f0-9]{2})?$/i.test(
    cleanLabel(value),
  );
}

export function preciseHexColorValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9.])${escapeRegExp(normalizedValue)}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

export function isCssRgbColorValue(value: string): boolean {
  const channel = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
  const alpha = "(?:0(?:\\.\\d+)?|1(?:\\.0+)?|\\.\\d+|(?:[1-9]\\d?|100)%)";
  const legacy = `rgba?\\(\\s*${channel}\\s*,\\s*${channel}\\s*,\\s*${channel}(?:\\s*,\\s*${alpha})?\\s*\\)`;
  const modern = `rgba?\\(\\s*${channel}\\s+${channel}\\s+${channel}(?:\\s*\\/\\s*${alpha})?\\s*\\)`;
  return new RegExp(`^(?:${legacy}|${modern})$`, "i").test(cleanLabel(value));
}

export function preciseCssRgbColorValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  const compactValue = normalizedValue.replace(/\s+/g, "");
  if (!compactValue) return false;
  const compactSummary = normalizedSummary.replace(/\s+/g, "");
  return new RegExp(
    `(^|[^a-z0-9.#])${escapeRegExp(compactValue)}(?=$|[^a-z0-9])`,
  ).test(compactSummary);
}

export function isCssHslColorValue(value: string): boolean {
  const hue = "(?:360|3[0-5]\\d|[12]?\\d?\\d)";
  const percent = "(?:100|[1-9]?\\d)%";
  const alpha = "(?:0(?:\\.\\d+)?|1(?:\\.0+)?|\\.\\d+|(?:[1-9]\\d?|100)%)";
  const legacy = `hsla?\\(\\s*${hue}\\s*,\\s*${percent}\\s*,\\s*${percent}(?:\\s*,\\s*${alpha})?\\s*\\)`;
  const modern = `hsla?\\(\\s*${hue}\\s+${percent}\\s+${percent}(?:\\s*\\/\\s*${alpha})?\\s*\\)`;
  return new RegExp(`^(?:${legacy}|${modern})$`, "i").test(cleanLabel(value));
}

export function preciseCssHslColorValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  const compactValue = normalizedValue.replace(/\s+/g, "");
  if (!compactValue) return false;
  const compactSummary = normalizedSummary.replace(/\s+/g, "");
  return new RegExp(
    `(^|[^a-z0-9.#])${escapeRegExp(compactValue)}(?=$|[^a-z0-9])`,
  ).test(compactSummary);
}

export const CSS_NAMED_COLOR_VALUES = new Set([
  "aliceblue",
  "antiquewhite",
  "aqua",
  "aquamarine",
  "azure",
  "beige",
  "bisque",
  "black",
  "blanchedalmond",
  "blue",
  "blueviolet",
  "brown",
  "burlywood",
  "cadetblue",
  "chartreuse",
  "chocolate",
  "coral",
  "cornflowerblue",
  "cornsilk",
  "crimson",
  "cyan",
  "darkblue",
  "darkcyan",
  "darkgoldenrod",
  "darkgray",
  "darkgreen",
  "darkgrey",
  "darkkhaki",
  "darkmagenta",
  "darkolivegreen",
  "darkorange",
  "darkorchid",
  "darkred",
  "darksalmon",
  "darkseagreen",
  "darkslateblue",
  "darkslategray",
  "darkslategrey",
  "darkturquoise",
  "darkviolet",
  "deeppink",
  "deepskyblue",
  "dimgray",
  "dimgrey",
  "dodgerblue",
  "firebrick",
  "floralwhite",
  "forestgreen",
  "fuchsia",
  "gainsboro",
  "ghostwhite",
  "gold",
  "goldenrod",
  "gray",
  "green",
  "greenyellow",
  "grey",
  "honeydew",
  "hotpink",
  "indianred",
  "indigo",
  "ivory",
  "khaki",
  "lavender",
  "lavenderblush",
  "lawngreen",
  "lemonchiffon",
  "lightblue",
  "lightcoral",
  "lightcyan",
  "lightgoldenrodyellow",
  "lightgray",
  "lightgreen",
  "lightgrey",
  "lightpink",
  "lightsalmon",
  "lightseagreen",
  "lightskyblue",
  "lightslategray",
  "lightslategrey",
  "lightsteelblue",
  "lightyellow",
  "lime",
  "limegreen",
  "linen",
  "magenta",
  "maroon",
  "mediumaquamarine",
  "mediumblue",
  "mediumorchid",
  "mediumpurple",
  "mediumseagreen",
  "mediumslateblue",
  "mediumspringgreen",
  "mediumturquoise",
  "mediumvioletred",
  "midnightblue",
  "mintcream",
  "mistyrose",
  "moccasin",
  "navajowhite",
  "navy",
  "oldlace",
  "olive",
  "olivedrab",
  "orange",
  "orangered",
  "orchid",
  "palegoldenrod",
  "palegreen",
  "paleturquoise",
  "palevioletred",
  "papayawhip",
  "peachpuff",
  "peru",
  "pink",
  "plum",
  "powderblue",
  "purple",
  "rebeccapurple",
  "red",
  "rosybrown",
  "royalblue",
  "saddlebrown",
  "salmon",
  "sandybrown",
  "seagreen",
  "seashell",
  "sienna",
  "silver",
  "skyblue",
  "slateblue",
  "slategray",
  "slategrey",
  "snow",
  "springgreen",
  "steelblue",
  "tan",
  "teal",
  "thistle",
  "tomato",
  "transparent",
  "turquoise",
  "violet",
  "wheat",
  "white",
  "whitesmoke",
  "yellow",
  "yellowgreen",
]);

export function isCssNamedColorValue(value: string): boolean {
  return CSS_NAMED_COLOR_VALUES.has(normalizeText(cleanLabel(value)));
}

export function preciseCssNamedColorValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9_-])${escapeRegExp(normalizedValue)}($|[^a-z0-9_-])`,
  ).test(normalizedSummary);
}

export function isDurationValue(value: string): boolean {
  return /^(?:~|\u2248)?\s*\d+(?:\.\d+)?\s*(?:ms|msec|milliseconds?|s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|wk|wks|weeks?)$/i.test(
    cleanLabel(value),
  );
}

export function preciseDurationValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9.])${escapeRegExp(normalizedValue)}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

export function isDataSizeValue(value: string): boolean {
  return /^(?:~|\u2248)?\s*\d+(?:\.\d+)?\s*(?:b|bytes?|kb|kib|mb|mib|gb|gib|tb|tib|pb|pib)$/i.test(
    cleanLabel(value),
  );
}

export function preciseDataSizeValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  const valuePattern = escapeRegExp(normalizedValue).replace(/\s+/g, "\\s*");
  return new RegExp(
    `(^|[^a-z0-9.])${valuePattern}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

export function isDataRateValue(value: string): boolean {
  return /^(?:~|\u2248)?\s*\d+(?:\.\d+)?\s*(?:bps|kbps|mbps|gbps|tbps|kbit\/s|mbit\/s|gbit\/s|tbit\/s|kb\/s|kib\/s|mb\/s|mib\/s|gb\/s|gib\/s|tb\/s|tib\/s|bytes?\/s|bytes?\s+per\s+second)$/i.test(
    cleanLabel(value),
  );
}

export function preciseDataRateValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  const valuePattern = escapeRegExp(normalizedValue).replace(/\s+/g, "\\s*");
  return new RegExp(
    `(^|[^a-z0-9.])${valuePattern}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

export function isPhysicalSpeedValue(value: string): boolean {
  return /^(?:~|\u2248)?\s*\d+(?:\.\d+)?\s*(?:mph|mi\/h|kph|kmph|km\/h|m\/s|meters?\s+per\s+second|metres?\s+per\s+second|ft\/s|feet\s+per\s+second|knots?|kt|kts)$/i.test(
    cleanLabel(value),
  );
}

export function precisePhysicalSpeedValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  const valuePattern = escapeRegExp(normalizedValue).replace(/\s+/g, "\\s*");
  return new RegExp(
    `(^|[^a-z0-9.])${valuePattern}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

export function isTemperatureValue(value: string): boolean {
  return /^(?:~|\u2248)?\s*[+-]?\d+(?:\.\d+)?\s*(?:\u00b0\s*)?(?:c|f|k|celsius|fahrenheit|kelvin)$/i.test(
    cleanLabel(value),
  );
}

export function preciseTemperatureValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  const summary = normalizedSummary.replace(/\u00b0/g, "");
  const valuePattern = escapeRegExp(
    normalizedValue.replace(/\u00b0/g, ""),
  ).replace(/\s+/g, "\\s*");
  return new RegExp(
    `(^|[^a-z0-9.])${valuePattern}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(summary);
}

export function isElectricalValue(value: string): boolean {
  return /^(?:~|\u2248)?\s*\d+(?:\.\d+)?\s*(?:mv|v|kv|ma|a|ka|mw|w|kw|wh|kwh|mwh|va|kva|mah|ah)$/i.test(
    cleanLabel(value),
  );
}

export function preciseElectricalValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  const valuePattern = escapeRegExp(normalizedValue).replace(/\s+/g, "\\s*");
  return new RegExp(
    `(^|[^a-z0-9.])${valuePattern}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

export function isMassValue(value: string): boolean {
  return /^(?:~|\u2248)?\s*\d+(?:\.\d+)?\s*(?:mg|milligrams?|g|grams?|kg|kgs|kilograms?|lb|lbs|pounds?|oz|ounces?|tons?|tonnes?)$/i.test(
    cleanLabel(value),
  );
}

export function preciseMassValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  const valuePattern = escapeRegExp(normalizedValue).replace(/\s+/g, "\\s*");
  return new RegExp(
    `(^|[^a-z0-9.])${valuePattern}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

export function isLengthValue(value: string): boolean {
  return /^(?:~|\u2248)?\s*\d+(?:\.\d+)?\s*(?:mm|millimeters?|millimetres?|cm|centimeters?|centimetres?|m|meters?|metres?|km|kilometers?|kilometres?|in|inch|inches|ft|foot|feet|yd|yards?|mi|miles?)$/i.test(
    cleanLabel(value),
  );
}

export function preciseLengthValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  const valuePattern = escapeRegExp(normalizedValue).replace(/\s+/g, "\\s*");
  return new RegExp(
    `(^|[^a-z0-9.])${valuePattern}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

export function isAreaValue(value: string): boolean {
  return /^(?:~|\u2248)?\s*\d+(?:\.\d+)?\s*(?:mm2|cm2|m2|km2|in2|ft2|yd2|mi2|sq\.?\s*(?:mm|cm|m|km|in|ft|feet|yd|mi)|square\s+(?:millimeters?|millimetres?|centimeters?|centimetres?|meters?|metres?|kilometers?|kilometres?|inches|feet|yards?|miles?)|acres?|hectares?|ha)$/i.test(
    cleanLabel(value),
  );
}

export function preciseAreaValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  const valuePattern = escapeRegExp(normalizedValue).replace(/\s+/g, "\\s*");
  return new RegExp(
    `(^|[^a-z0-9.])${valuePattern}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

export function isVolumeValue(value: string): boolean {
  return /^(?:~|\u2248)?\s*\d+(?:\.\d+)?\s*(?:ml|milliliters?|millilitres?|l|liters?|litres?|gal|gallons?|qt|quarts?|pt|pints?|fl\s*oz|fluid\s+ounces?|m3|cm3|cubic\s+meters?|cubic\s+metres?|cubic\s+centimeters?|cubic\s+centimetres?|cu\s*ft|cubic\s+feet)$/i.test(
    cleanLabel(value),
  );
}

export function preciseVolumeValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  const valuePattern = escapeRegExp(normalizedValue).replace(/\s+/g, "\\s*");
  return new RegExp(
    `(^|[^a-z0-9.])${valuePattern}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

export function isPressureValue(value: string): boolean {
  return /^(?:~|\u2248)?\s*\d+(?:\.\d+)?\s*(?:pa|kpa|mpa|gpa|psi|psig|psia|bar|mbar|millibars?|atm|atmospheres?|pascals?)$/i.test(
    cleanLabel(value),
  );
}

export function precisePressureValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  const valuePattern = escapeRegExp(normalizedValue).replace(/\s+/g, "\\s*");
  return new RegExp(
    `(^|[^a-z0-9.])${valuePattern}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

export function isFrequencyValue(value: string): boolean {
  return /^(?:~|\u2248)?\s*\d+(?:\.\d+)?\s*(?:hz|khz|mhz|ghz|thz|rpm|rps|cycles?\s+per\s+second)$/i.test(
    cleanLabel(value),
  );
}

export function preciseFrequencyValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  const valuePattern = escapeRegExp(normalizedValue).replace(/\s+/g, "\\s*");
  return new RegExp(
    `(^|[^a-z0-9.])${valuePattern}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

export function dateRangeValuePattern(): string {
  const date = "\\d{4}-\\d{2}-\\d{2}";
  return `${date}\\s*(?:-|to|through)\\s*${date}`;
}

export function canonicalDateRangeValue(value: string): string | null {
  const date = "\\d{4}-\\d{2}-\\d{2}";
  const parts = new RegExp(
    `^(${date})\\s*(?:-|to|through)\\s*(${date})$`,
    "i",
  ).exec(cleanLabel(value));
  if (!parts) return null;
  const start = parts[1] ?? "";
  const end = parts[2] ?? "";
  return isIsoDateValue(start) && isIsoDateValue(end)
    ? `${start}-${end}`
    : null;
}

export function isIsoDateValue(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cleanLabel(value));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isDateRangeValue(value: string): boolean {
  return canonicalDateRangeValue(value) !== null;
}

export function preciseDateRangeValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  const value = canonicalDateRangeValue(normalizedValue);
  if (!value) return false;
  const start = value.slice(0, 10);
  const end = value.slice(11, 21);
  if (!start || !end) return false;
  return new RegExp(
    `(^|[^0-9-])${escapeRegExp(start)}\\s*(?:-|to|through)\\s*${escapeRegExp(end)}(?=$|[^0-9-])`,
    "i",
  ).test(normalizedSummary);
}

export function timeRangeValuePattern(): string {
  const time = "(?:[01]?\\d|2[0-3]):[0-5]\\d";
  return `${time}\\s*(?:-|to)\\s*${time}`;
}

export function canonicalTimeRangeValue(value: string): string | null {
  const time = "(?:[01]?\\d|2[0-3]):[0-5]\\d";
  const parts = new RegExp(`^(${time})\\s*(?:-|to)\\s*(${time})$`, "i").exec(
    cleanLabel(value),
  );
  if (!parts) return null;
  const start = canonicalClockTime(parts[1] ?? "");
  const end = canonicalClockTime(parts[2] ?? "");
  return start && end ? `${start}-${end}` : null;
}

export function canonicalClockTime(value: string): string | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(cleanLabel(value));
  if (!match) return null;
  return `${Number(match[1])}:${match[2]}`;
}

export function isTimeRangeValue(value: string): boolean {
  return canonicalTimeRangeValue(value) !== null;
}

export function clockTimeSummaryPattern(canonicalTime: string): string {
  const [hour, minute] = canonicalTime.split(":");
  if (hour === undefined || minute === undefined) return "";
  const hourPattern =
    Number(hour) < 10 ? `0?${escapeRegExp(hour)}` : escapeRegExp(hour);
  return `${hourPattern}:${escapeRegExp(minute)}`;
}

export function preciseTimeRangeValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  const value = canonicalTimeRangeValue(normalizedValue);
  if (!value) return false;
  const [start, end] = value.split("-");
  if (!start || !end) return false;
  const startPattern = clockTimeSummaryPattern(start);
  const endPattern = clockTimeSummaryPattern(end);
  if (!startPattern || !endPattern) return false;
  return new RegExp(
    `(^|[^0-9:])${startPattern}\\s*(?:-|to)\\s*${endPattern}(?=$|[^0-9:])`,
    "i",
  ).test(normalizedSummary);
}

export function timezoneValuePattern(): string {
  const offset = "(?:[01]?\\d|2[0-3])(?::?[0-5]\\d)?";
  const offsetZone = `(?:(?:utc|gmt)(?:\\s*[+-]\\s*${offset})?|z|[+-]\\s*${offset})`;
  const ianaZone =
    "[a-z]+(?:[_+-][a-z0-9]+)*\\/[a-z0-9]+(?:[_+-][a-z0-9]+)*(?:\\/[a-z0-9]+(?:[_+-][a-z0-9]+)*)?";
  const abbreviation = "[a-z]{2,5}(?:[+-]\\d{1,2})?";
  return `(?:${offsetZone}|${ianaZone}|${abbreviation})`;
}

export function isTimezoneValue(value: string): boolean {
  const cleaned = cleanLabel(value);
  const offset = "(?:[01]?\\d|2[0-3])(?::?[0-5]\\d)?";
  const offsetZone = new RegExp(
    `^(?:(?:utc|gmt)(?:\\s*[+-]\\s*${offset})?|z|[+-]\\s*${offset})$`,
    "i",
  );
  const ianaZone =
    /^[a-z]+(?:[_+-][a-z0-9]+)*\/[a-z0-9]+(?:[_+-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[_+-][a-z0-9]+)*)?$/i;
  const abbreviation = /^[A-Z]{2,5}(?:[+-]\d{1,2})?$/;
  return (
    offsetZone.test(cleaned) ||
    ianaZone.test(cleaned) ||
    abbreviation.test(cleaned)
  );
}

export function preciseTimezoneValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  const valuePattern = escapeRegExp(normalizedValue).replace(/\s+/g, "\\s*");
  return new RegExp(
    `(^|[^a-z0-9_/+-])${valuePattern}(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
  ).test(normalizedSummary);
}

export function isLocaleCodeValue(value: string): boolean {
  return /^[a-z]{2,3}(?:[-_][a-z0-9]{2,8}){1,3}$/i.test(cleanLabel(value));
}

export function preciseLocaleCodeValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9_-])${escapeRegExp(normalizedValue)}(?=$|[^a-z0-9_-])`,
  ).test(normalizedSummary);
}

export function canonicalCoordinatePair(value: string): string {
  return cleanLabel(value)
    .replace(/^\(\s*/, "")
    .replace(/\s*\)$/, "")
    .replace(/\s+/g, "");
}

export function isCoordinatePairValue(value: string): boolean {
  const match =
    /^([+-]?(?:(?:[0-8]?\d)(?:\.\d+)?|90(?:\.0+)?)),([+-]?(?:(?:(?:[0-9]?\d)|(?:1[0-7]\d))(?:\.\d+)?|180(?:\.0+)?))$/.exec(
      canonicalCoordinatePair(value),
    );
  if (!match) return false;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  );
}

export function preciseCoordinatePairValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  const value = canonicalCoordinatePair(normalizedValue);
  if (!value) return false;
  const summary = normalizedSummary.replace(/[()\s]+/g, "");
  return new RegExp(
    `(^|[^0-9.,+-])${escapeRegExp(value)}(?=$|[^0-9.,+-])`,
  ).test(summary);
}

export const CONCISE_STATUS_LABEL_VALUES = new Set([
  "active",
  "approved",
  "closed",
  "disabled",
  "enabled",
  "false",
  "inactive",
  "no",
  "open",
  "pending",
  "rejected",
  "submitted",
  "true",
  "yes",
]);

export const CONCISE_PRIORITY_LABEL_VALUES = new Set([
  "blocker",
  "critical",
  "high",
  "low",
  "major",
  "medium",
  "minor",
  "normal",
  "urgent",
]);

export function isConciseSingleTokenLabelValue(value: string): boolean {
  const cleaned = cleanLabel(value);
  if (/^[~\u2248]?\s*\$?\d[\d,]*(?:\.\d+)?%?$/.test(cleaned)) {
    return true;
  }
  if (
    /^\d{4}-\d{2}-\d{2}(?:[t\s]\d{2}:\d{2}(?::\d{2})?)?$/i.test(cleaned) ||
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(cleaned) ||
    /^\d{1,2}:\d{2}$/i.test(cleaned)
  ) {
    return true;
  }
  if (/^[a-z]+[a-z0-9_-]*\d[a-z0-9_-]*$/i.test(cleaned)) {
    return true;
  }
  return CONCISE_STATUS_LABEL_VALUES.has(normalizeText(cleaned));
}

export function isConcisePriorityLabelValue(
  value: string,
  expectedAnswerLabel: string,
): boolean {
  return (
    labelCanHavePriorityValue(expectedAnswerLabel) &&
    CONCISE_PRIORITY_LABEL_VALUES.has(normalizeText(cleanLabel(value)))
  );
}

export function labelCanHavePriorityValue(expectedAnswerLabel: string): boolean {
  return /\b(?:priority|severity|urgency|impact|risk|importance)\b/i.test(
    expectedAnswerLabel,
  );
}

export function isIdentifierCodeValue(value: string): boolean {
  return /^[a-z]+[a-z0-9_-]*\d[a-z0-9_-]*$/i.test(cleanLabel(value));
}

export function preciseIdentifierCodeValueCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9_-])${escapeRegExp(normalizedValue)}($|[^a-z0-9_-])`,
  ).test(normalizedSummary);
}

export function valueTokenCoveredBySummary(
  normalizedSummary: string,
  normalizedValue: string,
): boolean {
  if (!normalizedValue) return false;
  return new RegExp(
    `(^|[^a-z0-9])${escapeRegExp(normalizedValue)}($|[^a-z0-9])`,
  ).test(normalizedSummary);
}

