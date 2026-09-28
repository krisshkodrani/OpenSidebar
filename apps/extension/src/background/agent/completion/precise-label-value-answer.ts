import { cleanLabel } from "./text-utils";
import {
  dateRangeValuePattern,
  isCoordinatePairValue,
  isCssNamedColorValue,
  isDateRangeValue,
  isIpv6AddressValue,
  isIpv6CidrValue,
  labelCanHaveIpv6AddressValue,
  isLocaleCodeValue,
  isTimeRangeValue,
  isTimezoneValue,
  labelCanHaveAreaValue,
  labelCanHaveCidrValue,
  labelCanHaveColorValue,
  labelCanHaveCoordinatePairValue,
  labelCanHaveDataRateValue,
  labelCanHaveDataSizeValue,
  labelCanHaveDateRangeValue,
  labelCanHaveDomainValue,
  labelCanHaveDurationValue,
  labelCanHaveElectricalValue,
  labelCanHaveFrequencyValue,
  labelCanHaveHashValue,
  labelCanHaveLengthValue,
  labelCanHaveLocaleValue,
  labelCanHaveMacAddressValue,
  labelCanHaveMassValue,
  labelCanHavePathValue,
  labelCanHavePhysicalSpeedValue,
  labelCanHavePressureValue,
  labelCanHaveTemperatureValue,
  labelCanHaveTimeRangeValue,
  labelCanHaveTimezoneValue,
  labelCanHaveUuidValue,
  labelCanHaveVolumeValue,
  timeRangeValuePattern,
  timezoneValuePattern,
} from "./label-value-types";

export function extractPreciseConciseLabelValue(
  evidenceText: string,
  labelPattern: string,
  expectedAnswerLabel: string,
): string | null {
  const urlMatch = new RegExp(
    `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(https?:\\/\\/[^\\s<>"']+)`,
    "i",
  ).exec(evidenceText);
  if (urlMatch) {
    return cleanLabel((urlMatch[1] ?? "").replace(/[),.;!?]+$/g, "")) || null;
  }

  if (labelCanHavePathValue(expectedAnswerLabel)) {
    const uncPathMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(\\\\\\\\[^\\s,;!)]{1,160})(?=$|[\\s,;!)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (uncPathMatch) {
      return (
        cleanLabel(
          (uncPathMatch[1] ?? "").replace(/[),;!?]+$/g, "").replace(/\.$/g, ""),
        ) || null
      );
    }

    const windowsPathMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*([a-z]:\\\\[^\\s,;!)]{1,160})(?=$|[\\s,;!)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (windowsPathMatch) {
      return (
        cleanLabel(
          (windowsPathMatch[1] ?? "")
            .replace(/[),;!?]+$/g, "")
            .replace(/\.$/g, ""),
        ) || null
      );
    }

    const pathMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\.{1,2})?\\/[^\\s,;!)]{1,160})(?=$|[\\s,;!)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (pathMatch) {
      return (
        cleanLabel(
          (pathMatch[1] ?? "").replace(/[),;!?]+$/g, "").replace(/\.$/g, ""),
        ) || null
      );
    }
  }

  const emailMatch = new RegExp(
    `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*([a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,})(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
    "i",
  ).exec(evidenceText);
  if (emailMatch) return cleanLabel(emailMatch[1] ?? "") || null;

  const phoneMatch = new RegExp(
    `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:\\+?\\d{1,3}[\\s.-]?)?(?:\\(?\\d{3}\\)?[\\s.-]?)\\d{3}[\\s.-]?\\d{4}(?:\\s*(?:x|ext\\.?|extension)\\s*\\d{1,6})?)`,
    "i",
  ).exec(evidenceText);
  if (phoneMatch) return cleanLabel(phoneMatch[1] ?? "") || null;

  const ipv4Octet = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
  if (labelCanHaveCidrValue(expectedAnswerLabel)) {
    const cidrMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(${ipv4Octet}\\.${ipv4Octet}\\.${ipv4Octet}\\.${ipv4Octet}\\/(?:[0-9]|[12][0-9]|3[0-2]))(?=$|[\\s,;!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (cidrMatch) return cleanLabel(cidrMatch[1] ?? "") || null;
  }

  const ipv4Match = new RegExp(
    `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(${ipv4Octet}\\.${ipv4Octet}\\.${ipv4Octet}\\.${ipv4Octet})(?=$|[^\\d./])`,
    "i",
  ).exec(evidenceText);
  if (ipv4Match) return cleanLabel(ipv4Match[1] ?? "") || null;

  if (labelCanHaveMacAddressValue(expectedAnswerLabel)) {
    const macAddressMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2})(?=$|[\\s,;!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (macAddressMatch) return cleanLabel(macAddressMatch[1] ?? "") || null;
  }

  if (
    labelCanHaveIpv6AddressValue(expectedAnswerLabel) ||
    labelCanHaveCidrValue(expectedAnswerLabel)
  ) {
    const ipv6CidrMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*([0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}(?:%[a-z0-9_.-]+)?\\/(?:[0-9]|[1-9][0-9]|1[01][0-9]|12[0-8]))(?=$|[\\s,;!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    const ipv6CidrCandidate = cleanLabel(ipv6CidrMatch?.[1] ?? "");
    if (ipv6CidrCandidate && isIpv6CidrValue(ipv6CidrCandidate)) {
      return ipv6CidrCandidate;
    }
  }

  if (labelCanHaveIpv6AddressValue(expectedAnswerLabel)) {
    const ipv6Match = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*([0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}(?:%[a-z0-9_.-]+)?)(?=$|[\\s,;!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    const candidate = cleanLabel(ipv6Match?.[1] ?? "");
    if (candidate && isIpv6AddressValue(candidate)) return candidate;
  }

  if (labelCanHaveDomainValue(expectedAnswerLabel)) {
    const domainMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63})(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (domainMatch) return cleanLabel(domainMatch[1] ?? "") || null;
  }

  if (labelCanHaveUuidValue(expectedAnswerLabel)) {
    const uuidMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (uuidMatch) return cleanLabel(uuidMatch[1] ?? "") || null;
  }

  if (labelCanHaveHashValue(expectedAnswerLabel)) {
    const hashMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*([a-f0-9]{128}|[a-f0-9]{96}|[a-f0-9]{64}|[a-f0-9]{56}|[a-f0-9]{40}|[a-f0-9]{32})(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (hashMatch) return cleanLabel(hashMatch[1] ?? "") || null;
  }

  if (labelCanHaveColorValue(expectedAnswerLabel)) {
    const colorMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(#[a-f0-9]{3}(?:[a-f0-9]{3})?(?:[a-f0-9]{2})?)(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (colorMatch) return cleanLabel(colorMatch[1] ?? "") || null;

    const rgbChannel = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
    const rgbAlpha = "(?:0(?:\\.\\d+)?|1(?:\\.0+)?|\\.\\d+|(?:[1-9]\\d?|100)%)";
    const rgbMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:rgba?|RGBA?)\\(\\s*${rgbChannel}\\s*,\\s*${rgbChannel}\\s*,\\s*${rgbChannel}(?:\\s*,\\s*${rgbAlpha})?\\s*\\))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (rgbMatch) return cleanLabel(rgbMatch[1] ?? "") || null;
    const modernRgbMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:rgba?|RGBA?)\\(\\s*${rgbChannel}\\s+${rgbChannel}\\s+${rgbChannel}(?:\\s*\\/\\s*${rgbAlpha})?\\s*\\))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (modernRgbMatch) {
      return cleanLabel(modernRgbMatch[1] ?? "") || null;
    }

    const hslHue = "(?:360|3[0-5]\\d|[12]?\\d?\\d)";
    const hslPercent = "(?:100|[1-9]?\\d)%";
    const hslMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:hsla?|HSLA?)\\(\\s*${hslHue}\\s*,\\s*${hslPercent}\\s*,\\s*${hslPercent}(?:\\s*,\\s*${rgbAlpha})?\\s*\\))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (hslMatch) return cleanLabel(hslMatch[1] ?? "") || null;
    const modernHslMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:hsla?|HSLA?)\\(\\s*${hslHue}\\s+${hslPercent}\\s+${hslPercent}(?:\\s*\\/\\s*${rgbAlpha})?\\s*\\))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (modernHslMatch) {
      return cleanLabel(modernHslMatch[1] ?? "") || null;
    }

    const namedColorMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*([a-z][a-z]+)(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    const namedColor = cleanLabel(namedColorMatch?.[1] ?? "");
    if (isCssNamedColorValue(namedColor)) return namedColor;
  }

  if (/\b(?:version|build|release|revision|rev)\b/i.test(expectedAnswerLabel)) {
    const versionMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:v(?:ersion)?\\s*)?\\d+(?:\\.\\d+){1,5}(?:[-+][a-z0-9][a-z0-9.-]*)?)(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (versionMatch) return cleanLabel(versionMatch[1] ?? "") || null;
  }

  if (labelCanHaveDurationValue(expectedAnswerLabel)) {
    const durationMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:ms|msec|milliseconds?|s|sec|secs|seconds?|m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|wk|wks|weeks?))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (durationMatch) return cleanLabel(durationMatch[1] ?? "") || null;
  }

  if (labelCanHaveDataSizeValue(expectedAnswerLabel)) {
    const dataSizeMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:b|bytes?|kb|kib|mb|mib|gb|gib|tb|tib|pb|pib))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (dataSizeMatch) return cleanLabel(dataSizeMatch[1] ?? "") || null;
  }

  if (labelCanHaveDataRateValue(expectedAnswerLabel)) {
    const dataRateMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:bps|kbps|mbps|gbps|tbps|kbit\\/s|mbit\\/s|gbit\\/s|tbit\\/s|kb\\/s|kib\\/s|mb\\/s|mib\\/s|gb\\/s|gib\\/s|tb\\/s|tib\\/s|bytes?\\/s|bytes?\\s+per\\s+second))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (dataRateMatch) return cleanLabel(dataRateMatch[1] ?? "") || null;
  }

  if (labelCanHavePhysicalSpeedValue(expectedAnswerLabel)) {
    const physicalSpeedMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:mph|mi\\/h|kph|kmph|km\\/h|m\\/s|meters?\\s+per\\s+second|metres?\\s+per\\s+second|ft\\/s|feet\\s+per\\s+second|knots?|kt|kts))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (physicalSpeedMatch) {
      return cleanLabel(physicalSpeedMatch[1] ?? "") || null;
    }
  }

  if (labelCanHaveTemperatureValue(expectedAnswerLabel)) {
    const temperatureMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*[+-]?\\d+(?:\\.\\d+)?\\s*(?:\\u00b0\\s*)?(?:c|f|k|celsius|fahrenheit|kelvin))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (temperatureMatch) return cleanLabel(temperatureMatch[1] ?? "") || null;
  }

  if (labelCanHaveElectricalValue(expectedAnswerLabel)) {
    const electricalMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:mv|v|kv|ma|a|ka|mw|w|kw|wh|kwh|mwh|va|kva|mah|ah))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (electricalMatch) return cleanLabel(electricalMatch[1] ?? "") || null;
  }

  if (labelCanHaveMassValue(expectedAnswerLabel)) {
    const massMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:mg|milligrams?|g|grams?|kg|kgs|kilograms?|lb|lbs|pounds?|oz|ounces?|tons?|tonnes?))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (massMatch) return cleanLabel(massMatch[1] ?? "") || null;
  }

  if (labelCanHaveLengthValue(expectedAnswerLabel)) {
    const lengthMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:mm|millimeters?|millimetres?|cm|centimeters?|centimetres?|m|meters?|metres?|km|kilometers?|kilometres?|in|inch|inches|ft|foot|feet|yd|yards?|mi|miles?))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (lengthMatch) return cleanLabel(lengthMatch[1] ?? "") || null;
  }

  if (labelCanHaveAreaValue(expectedAnswerLabel)) {
    const areaMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:mm2|cm2|m2|km2|in2|ft2|yd2|mi2|sq\\.?\\s*(?:mm|cm|m|km|in|ft|feet|yd|mi)|square\\s+(?:millimeters?|millimetres?|centimeters?|centimetres?|meters?|metres?|kilometers?|kilometres?|inches|feet|yards?|miles?)|acres?|hectares?|ha))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (areaMatch) return cleanLabel(areaMatch[1] ?? "") || null;
  }

  if (labelCanHaveVolumeValue(expectedAnswerLabel)) {
    const volumeMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:ml|milliliters?|millilitres?|l|liters?|litres?|gal|gallons?|qt|quarts?|pt|pints?|fl\\s*oz|fluid\\s+ounces?|m3|cm3|cubic\\s+meters?|cubic\\s+metres?|cubic\\s+centimeters?|cubic\\s+centimetres?|cu\\s*ft|cubic\\s+feet))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (volumeMatch) return cleanLabel(volumeMatch[1] ?? "") || null;
  }

  if (labelCanHavePressureValue(expectedAnswerLabel)) {
    const pressureMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:pa|kpa|mpa|gpa|psi|psig|psia|bar|mbar|millibars?|atm|atmospheres?|pascals?))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (pressureMatch) return cleanLabel(pressureMatch[1] ?? "") || null;
  }

  if (labelCanHaveFrequencyValue(expectedAnswerLabel)) {
    const frequencyMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:~|\\u2248)?\\s*\\d+(?:\\.\\d+)?\\s*(?:hz|khz|mhz|ghz|thz|rpm|rps|cycles?\\s+per\\s+second))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    if (frequencyMatch) return cleanLabel(frequencyMatch[1] ?? "") || null;
  }

  if (labelCanHaveDateRangeValue(expectedAnswerLabel)) {
    const dateRangeMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(${dateRangeValuePattern()})(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    const candidate = cleanLabel(dateRangeMatch?.[1] ?? "");
    if (candidate && isDateRangeValue(candidate)) return candidate;
  }

  if (labelCanHaveTimeRangeValue(expectedAnswerLabel)) {
    const timeRangeMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(${timeRangeValuePattern()})(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    const candidate = cleanLabel(timeRangeMatch?.[1] ?? "");
    if (candidate && isTimeRangeValue(candidate)) return candidate;
  }

  if (labelCanHaveTimezoneValue(expectedAnswerLabel)) {
    const timezoneMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(${timezoneValuePattern()})(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    const candidate = cleanLabel(timezoneMatch?.[1] ?? "");
    if (candidate && isTimezoneValue(candidate)) return candidate;
  }

  if (labelCanHaveLocaleValue(expectedAnswerLabel)) {
    const localeMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*([a-z]{2,3}(?:[-_][a-z0-9]{2,8}){1,3})(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    const candidate = cleanLabel(localeMatch?.[1] ?? "");
    if (candidate && isLocaleCodeValue(candidate)) return candidate;
  }

  if (labelCanHaveCoordinatePairValue(expectedAnswerLabel)) {
    const coordinatePairMatch = new RegExp(
      `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*(\\(?\\s*[+-]?(?:(?:[0-8]?\\d)(?:\\.\\d+)?|90(?:\\.0+)?)\\s*,\\s*[+-]?(?:(?:(?:[0-9]?\\d)|(?:1[0-7]\\d))(?:\\.\\d+)?|180(?:\\.0+)?)\\s*\\)?)(?=$|[\\s,;!?)]|\\.(?:\\s|$))`,
      "i",
    ).exec(evidenceText);
    const candidate = cleanLabel(coordinatePairMatch?.[1] ?? "");
    if (candidate && isCoordinatePairValue(candidate)) return candidate;
  }

  const match = new RegExp(
    `\\b${labelPattern}\\b\\s*(?:(?:[:=-])|\\bis\\b)\\s*((?:[~\\u2248]?\\s*\\$\\d[\\d,]*(?:\\.\\d+)?)|(?:[~\\u2248]?\\s*\\d[\\d,]*(?:\\.\\d+%?|%)))(?=$|[\\s,;:!?)]|\\.(?:\\s|$))`,
    "i",
  ).exec(evidenceText);
  return cleanLabel(match?.[1] ?? "") || null;
}
