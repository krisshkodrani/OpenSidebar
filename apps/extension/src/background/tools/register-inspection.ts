/**
 * Page-inspection tool registrations (RFC LP-16 Phase 4). inspect_hidden /
 * inspect_region / inspect_chart / inspect_table / inspect_filter_state — MAIN
 * world read-only inspectors run via the page-inspector helper. Verbatim
 * movement from tools/index.ts.
 */
import { ToolName } from "../../types";
import { logger } from "../../utils";
import { ToolRegistry } from "./registry";
import {
  INSPECT_HIDDEN_DEF,
  INSPECT_REGION_DEF,
  INSPECT_CHART_DEF,
  INSPECT_TABLE_DEF,
  INSPECT_FILTER_STATE_DEF,
} from "./definitions";
import {
  runReadOnlyPageInspector,
  runAsyncReadOnlyPageInspector,
} from "./page-inspector";

export function registerInspectionTools(toolRegistry: ToolRegistry): void {
    toolRegistry.register(
      ToolName.INSPECT_HIDDEN,
      INSPECT_HIDDEN_DEF,
      async (args, tabId) => {
        const pattern = (args.pattern as string) || "";
        const maxResults = Math.min(
          Math.max((args.maxResults as number) || 25, 1),
          50,
        );
  
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN" as any,
            func: (pat: string, max: number) => {
              const SKIP_TAGS = new Set([
                "SCRIPT",
                "STYLE",
                "NOSCRIPT",
                "META",
                "LINK",
                "HEAD",
                "BR",
                "HR",
                "WBR",
                "TEMPLATE",
              ]);
              const startTime = performance.now();
              const TIME_BUDGET = 50; // ms
              const TEXT_MAX = 200;
  
              interface HiddenEntry {
                method: string;
                selector: string;
                text: string;
              }
              const found: HiddenEntry[] = [];
              const seenTexts = new Set<string>();
  
              function getDirectText(el: Element): string {
                let text = "";
                for (const node of el.childNodes) {
                  if (node.nodeType === Node.TEXT_NODE) {
                    text += (node as Text).textContent || "";
                  }
                }
                return text.trim();
              }
  
              function describeElement(el: Element): string {
                const tag = el.tagName.toLowerCase();
                const id = el.id ? `#${el.id}` : "";
                const cls =
                  el.className && typeof el.className === "string"
                    ? `.${el.className.split(/\s+/).slice(0, 2).join(".")}`
                    : "";
                return `${tag}${id}${cls}`.slice(0, 60);
              }
  
              function isAncestorHidden(el: Element): string | null {
                let current = el.parentElement;
                let depth = 0;
                while (current && depth < 10) {
                  if (current.tagName === "BODY" || current.tagName === "HTML")
                    break;
                  const style = getComputedStyle(current);
                  if (style.display === "none") return `parent(display:none)`;
                  if (style.visibility === "hidden")
                    return `parent(visibility:hidden)`;
                  if (parseFloat(style.opacity) === 0) return `parent(opacity:0)`;
                  if (current.getAttribute("aria-hidden") === "true")
                    return `parent(aria-hidden)`;
                  current = current.parentElement;
                  depth++;
                }
                return null;
              }
  
              function detectHiding(el: Element): string | null {
                // aria-hidden on the element itself
                if (el.getAttribute("aria-hidden") === "true")
                  return "aria-hidden";
  
                const style = getComputedStyle(el);
  
                if (style.display === "none") return "display:none";
                if (style.visibility === "hidden") return "visibility:hidden";
                if (parseFloat(style.opacity) === 0) return "opacity:0";
  
                // clip / clip-path
                if (
                  style.clip === "rect(0px, 0px, 0px, 0px)" ||
                  style.clipPath === "inset(100%)" ||
                  style.clipPath === "polygon(0px 0px, 0px 0px, 0px 0px)"
                ) {
                  return "clip";
                }
  
                // Zero-size with overflow hidden
                const rect = el.getBoundingClientRect();
                if (
                  rect.width === 0 &&
                  rect.height === 0 &&
                  (style.overflow === "hidden" || style.overflow === "clip")
                ) {
                  return "zero-size+overflow:hidden";
                }
  
                // Off-screen positioning
                if (
                  rect.right < -500 ||
                  rect.bottom < -500 ||
                  rect.left > window.innerWidth + 500 ||
                  rect.top > window.innerHeight + 500
                ) {
                  return "off-screen";
                }
  
                // Negative text-indent
                const textIndent = parseFloat(style.textIndent);
                if (textIndent < -500) return "text-indent";
  
                // Color camouflage: text color matches background
                if (
                  style.color &&
                  style.backgroundColor &&
                  style.backgroundColor !== "rgba(0, 0, 0, 0)" &&
                  style.backgroundColor !== "transparent" &&
                  style.color === style.backgroundColor
                ) {
                  return "color-camouflage";
                }
  
                // Font-size: 0
                if (parseFloat(style.fontSize) === 0) return "font-size:0";
  
                // Check parent hiding
                return isAncestorHidden(el);
              }
  
              const allElements = document.querySelectorAll("*");
              for (let i = 0; i < allElements.length; i++) {
                if (performance.now() - startTime > TIME_BUDGET) break;
                if (found.length >= max) break;
  
                const el = allElements[i];
                if (SKIP_TAGS.has(el.tagName)) continue;
                // Skip SVG internals
                if (el.closest("svg") && el.tagName !== "SVG") continue;
  
                const method = detectHiding(el);
                if (!method) continue;
  
                // Prefer direct text to avoid duplicates from parent containers
                let text = getDirectText(el);
                if (!text) text = (el.textContent || "").trim();
                if (!text) continue;
  
                // Truncate
                if (text.length > TEXT_MAX)
                  text = text.slice(0, TEXT_MAX) + "...";
  
                // Pattern filter
                if (pat && !text.toLowerCase().includes(pat.toLowerCase()))
                  continue;
  
                // Dedup by text
                if (seenTexts.has(text)) continue;
                seenTexts.add(text);
  
                found.push({
                  method,
                  selector: describeElement(el),
                  text,
                });
              }
  
              // Sort by text length descending (longer = more meaningful)
              found.sort((a, b) => b.text.length - a.text.length);
  
              const elapsed = Math.round(performance.now() - startTime);
              if (found.length === 0) {
                return `No hidden elements found${pat ? ` matching "${pat}"` : ""} (scanned in ${elapsed}ms).`;
              }
  
              const lines = found.map(
                (entry, idx) =>
                  `${idx + 1}. [${entry.method}] ${entry.selector}\n   Text: "${entry.text}"`,
              );
              return `Found ${found.length} hidden element(s)${pat ? ` matching "${pat}"` : ""} (scanned in ${elapsed}ms):\n\n${lines.join("\n\n")}`;
            },
            args: [pattern, maxResults],
          });
          const value = results?.[0]?.result;
          return value !== undefined ? value : "No hidden elements found.";
        } catch (e: any) {
          return `Error scanning hidden elements: ${e.message}`;
        }
      },
    );
  
    // LP-13: the real executor lives in the agent loop (region-zoom.ts) —
    // it needs the loop's screenshot cache, zoom cap, budget, and delivery
    // paths. This fallback only answers callers outside an agent turn.
    toolRegistry.register(
      ToolName.INSPECT_REGION,
      INSPECT_REGION_DEF,
      async () =>
        "inspect_region requires an active agent turn (screenshot context unavailable).",
    );
  
    toolRegistry.register(
      ToolName.INSPECT_CHART,
      INSPECT_CHART_DEF,
      async (args, tabId) => {
        const pattern = (args.pattern as string) || "";
        const maxResults = Math.min(
          Math.max((args.maxResults as number) || 30, 1),
          100,
        );
        return runReadOnlyPageInspector(
          tabId,
          (pat: string, max: number) => {
            const norm = (value: unknown) =>
              String(value ?? "")
                .replace(/\s+/g, " ")
                .trim();
            const include = (value: string) =>
              !pat || value.toLowerCase().includes(pat.toLowerCase());
            const lines: string[] = [
              `URL: ${location.href}`,
              `Title: ${document.title}`,
            ];
            const sections: string[] = [];
            const seen = new Set<string>();
            const push = (label: string, value: unknown, force = false) => {
              const text = norm(value);
              if (
                !text ||
                (!force && !include(text)) ||
                seen.has(`${label}:${text}`)
              )
                return;
              seen.add(`${label}:${text}`);
              sections.push(`- ${label}: ${text.slice(0, 240)}`);
            };
            const formatNumber = (value: unknown) => {
              if (typeof value === "number" && Number.isFinite(value)) {
                return String(value);
              }
              return norm(value);
            };
            const toNumber = (value: unknown): number | null => {
              if (typeof value === "number" && Number.isFinite(value)) {
                return value;
              }
              const text = norm(value).replace(/,/g, "");
              if (!text) return null;
              const parsed = Number(text);
              return Number.isFinite(parsed) ? parsed : null;
            };
            const firstText = (values: unknown[]) => {
              for (const value of values) {
                const text = norm(value);
                if (text) return text;
              }
              return "";
            };
  
            const highcharts = (window as any).Highcharts;
            if (highcharts?.charts) {
              highcharts.charts
                .filter(Boolean)
                .slice(0, 8)
                .forEach((chart: any, chartIndex: number) => {
                  const chartTitle =
                    chart.title?.textStr || chart.options?.title?.text;
                  const chartType = chart.options?.chart?.type || chart.type;
                  const chartMatches =
                    !pat ||
                    include(chartTitle || "") ||
                    include(chart.options?.subtitle?.text || "") ||
                    include(chart.renderTo?.textContent || "");
                  push(
                    `Highcharts ${chartIndex + 1} title`,
                    chartTitle,
                    chartMatches,
                  );
                  push(
                    `Highcharts ${chartIndex + 1} type`,
                    chartType,
                    chartMatches,
                  );
                  const categories = chart.xAxis?.[0]?.categories;
                  const dataRows =
                    typeof chart.getDataRows === "function"
                      ? chart.getDataRows()
                      : null;
                  if (Array.isArray(dataRows)) {
                    dataRows
                      .slice(0, max + 1)
                      .forEach((row: unknown, rowIndex: number) => {
                        const text = Array.isArray(row)
                          ? row.map(formatNumber).join(" | ")
                          : norm(row);
                        push(
                          rowIndex === 0 ? "Data row header" : "Data row",
                          text,
                          chartMatches,
                        );
                      });
                  }
                  const points: string[] = [];
                  const numericPoints: Array<{ label: string; value: number }> =
                    [];
                  for (const series of chart.series || []) {
                    const seriesName = norm(series?.name) || "series";
                    const seriesMatches = chartMatches || include(seriesName);
                    if (series?.name) push(`Series`, series.name, chartMatches);
                    const seriesPoints =
                      Array.isArray(series?.points) && series.points.length > 0
                        ? series.points
                        : Array.isArray(series?.data)
                          ? series.data
                          : [];
                    const total =
                      toNumber(series?.total) ??
                      seriesPoints.reduce((sum: number, point: any) => {
                        return sum + (toNumber(point?.y ?? point?.value) ?? 0);
                      }, 0);
                    for (const point of seriesPoints.slice(0, max)) {
                      const label = firstText([
                        point?.origXValue,
                        point?.category,
                        point?.name,
                        Array.isArray(categories)
                          ? categories[point?.x]
                          : undefined,
                        point?.x,
                      ]);
                      const rawValue = point?.y ?? point?.value;
                      const count = toNumber(rawValue);
                      const percent =
                        toNumber(point?.percent ?? point?.percentage) ??
                        (count !== null && total > 0
                          ? Math.round((count / total) * 100000000) / 1000000
                          : null);
                      const fields = [
                        `count=${formatNumber(rawValue)}`,
                        percent !== null
                          ? `percent=${formatNumber(percent)}`
                          : "",
                        total > 0 ? `series_total=${formatNumber(total)}` : "",
                      ].filter(Boolean);
                      const pointText = `${seriesName} ${label || points.length + 1}: ${fields.join("; ")}`;
                      if (seriesMatches || include(pointText)) {
                        points.push(pointText);
                      }
                      if (count !== null && label) {
                        numericPoints.push({ label, value: count });
                      }
                      if (points.length >= max) break;
                    }
                    if (points.length >= max) break;
                  }
                  if (points.length > 0) {
                    push(`Highcharts ${chartIndex + 1} title`, chartTitle, true);
                  }
                  for (const point of points) push("Point", point, true);
                  if (numericPoints.length >= 2) {
                    const sorted = [...numericPoints].sort((a, b) => {
                      if (a.value !== b.value) return a.value - b.value;
                      return a.label.localeCompare(b.label);
                    });
                    const min = sorted[0];
                    const maxPoint = sorted[sorted.length - 1];
                    const minPoints = sorted.filter(
                      (point) => point.value === min.value,
                    );
                    const maxPoints = sorted.filter(
                      (point) => point.value === maxPoint.value,
                    );
                    const formatPoints = (
                      points: Array<{ label: string; value: number }>,
                    ) =>
                      points
                        .map(
                          (point) =>
                            `${point.label}: ${formatNumber(point.value)}`,
                        )
                        .join(", ");
                    push(
                      "Numeric summary",
                      `min=${formatPoints(minPoints)}; max=${formatPoints(maxPoints)}; difference_to_max=${formatNumber(maxPoint.value - min.value)}; order_extra_quantity_to_raise_min_to_max=${formatNumber(maxPoint.value - min.value)}; final_target_quantity=${formatNumber(maxPoint.value)}`,
                      true,
                    );
                  }
                });
            }
  
            const chartLike = [
              ...document.querySelectorAll(
                "svg, canvas, [role='img'], [aria-label*='chart' i], [class*='chart' i], [class*='highcharts' i]",
              ),
            ].slice(0, 12);
            chartLike.forEach((el, index) => {
              const label = norm(
                [
                  el.getAttribute("aria-label"),
                  el.getAttribute("title"),
                  el.getAttribute("data-highcharts-chart"),
                ]
                  .filter(Boolean)
                  .join(" "),
              );
              push(`Chart element ${index + 1}`, label);
              const svgText = [...el.querySelectorAll("title, text, tspan")]
                .map((node) => norm(node.textContent))
                .filter(Boolean)
                .slice(0, max)
                .join(" | ");
              push(`Chart text ${index + 1}`, svgText);
            });
  
            if (pat) {
              const scripts = [
                ...document.querySelectorAll<HTMLScriptElement>(
                  "script[type='application/json'], script:not([src])",
                ),
              ].slice(0, 20);
              for (const script of scripts) {
                const text = norm(script.textContent);
                if (!text || !include(text)) continue;
                const lower = text.toLowerCase();
                const index = lower.indexOf(pat.toLowerCase());
                const start = Math.max(0, index - 160);
                const end = Math.min(text.length, index + pat.length + 240);
                push("Chart metadata snippet", text.slice(start, end), true);
              }
            }
  
            if (sections.length === 0) {
              lines.push(
                `No chart data found${pat ? ` matching "${pat}"` : ""}.`,
              );
            } else {
              lines.push(`Chart evidence${pat ? ` matching "${pat}"` : ""}:`);
              lines.push(...sections.slice(0, max + 20));
            }
            return lines.join("\n");
          },
          [pattern, maxResults],
          "No chart data found.",
        );
      },
    );
  
    toolRegistry.register(
      ToolName.INSPECT_TABLE,
      INSPECT_TABLE_DEF,
      async (args, tabId) => {
        const maxRows = Math.min(Math.max((args.maxRows as number) || 10, 1), 50);
        return runReadOnlyPageInspector(
          tabId,
          (max: number) => {
            const norm = (value: unknown) =>
              String(value ?? "")
                .replace(/\s+/g, " ")
                .trim();
            const lines: string[] = [
              `URL: ${location.href}`,
              `Title: ${document.title}`,
            ];
            const params = new URLSearchParams(location.search);
            const interestingParams = [
              "sysparm_query",
              "sysparm_fixed_query",
              "sysparm_first_row",
              "sysparm_order",
              "sysparm_orderby",
              "sysparm_sort",
              "sysparm_view",
            ]
              .map((key) => [key, params.get(key)] as const)
              .filter(([, value]) => value);
            if (interestingParams.length > 0) {
              lines.push(
                `URL state: ${interestingParams.map(([k, v]) => `${k}=${v}`).join("; ")}`,
              );
            }
  
            const tables = [
              ...document.querySelectorAll(
                "table, [role='grid'], [role='table']",
              ),
            ].slice(0, 8);
            if (tables.length === 0) {
              const rows = [
                ...document.querySelectorAll(
                  "[role='row'], tr, li, [class*='row' i]",
                ),
              ].slice(0, max);
              if (rows.length === 0)
                return `${lines.join("\n")}\nNo table or row-like data surface found.`;
              lines.push(`Row-like surface (${rows.length} sampled rows):`);
              rows.forEach((row, index) =>
                lines.push(
                  `${index + 1}. ${norm(row.textContent).slice(0, 240)}`,
                ),
              );
              return lines.join("\n");
            }
  
            tables.forEach((table, tableIndex) => {
              const headers = [
                ...table.querySelectorAll("th, [role='columnheader']"),
              ]
                .map((header) => {
                  const text = norm(header.textContent);
                  const sort =
                    header.getAttribute("aria-sort") ||
                    header.getAttribute("data-sort") ||
                    header.getAttribute("sort");
                  return sort ? `${text} (${sort})` : text;
                })
                .filter(Boolean);
              lines.push(`Table ${tableIndex + 1}:`);
              if (headers.length > 0)
                lines.push(`Columns: ${headers.join(" | ")}`);
              const rows = [...table.querySelectorAll("tbody tr, [role='row']")]
                .filter((row) => norm(row.textContent))
                .slice(0, max);
              const duplicateCandidates = new Map<
                string,
                { value: string; records: Set<string>; rows: number[] }
              >();
              rows.forEach((row, rowIndex) => {
                const cells = [
                  ...row.querySelectorAll(
                    "td, th, [role='cell'], [role='gridcell']",
                  ),
                ]
                  .map((cell) => norm(cell.textContent))
                  .filter(Boolean);
                lines.push(
                  `${rowIndex + 1}. ${(cells.length > 0 ? cells.join(" | ") : norm(row.textContent)).slice(0, 320)}`,
                );
                const rowText = cells.length > 0 ? cells.join(" | ") : norm(row.textContent);
                const records = [
                  ...new Set(rowText.match(/\b[A-Z]{2,5}\d{4,}\b/g) || []),
                ];
                const rowRecord = records[0] || `row ${rowIndex + 1}`;
                for (const cell of cells) {
                  const value = cell.replace(/\s+/g, " ").trim();
                  if (
                    value.length < 12 ||
                    /^\(?empty\)?$/i.test(value) ||
                    /\b[A-Z]{2,5}\d{4,}\b/.test(value) ||
                    /^(assess|closed|open|new|active|inactive|fix applied)$/i.test(value) ||
                    /^[0-9]+(\s*-\s*[a-z]+)?$/i.test(value)
                  ) {
                    continue;
                  }
                  if (value.length < 20 && !/[#"]/.test(value)) continue;
                  const key = value.toLowerCase();
                  const existing =
                    duplicateCandidates.get(key) ||
                    { value, records: new Set<string>(), rows: [] };
                  existing.records.add(rowRecord);
                  existing.rows.push(rowIndex + 1);
                  duplicateCandidates.set(key, existing);
                }
              });
              const repeated = [...duplicateCandidates.values()]
                .filter((candidate) => candidate.records.size >= 2)
                .slice(0, 5);
              if (repeated.length > 0) {
                lines.push("Duplicate candidates:");
                for (const candidate of repeated) {
                  lines.push(
                    `- ${candidate.value.slice(0, 180)} :: records ${[
                      ...candidate.records,
                    ].join(", ")}. For duplicate row actions, use apply_list_action with one duplicate record in records and the other as relatedRecord.`,
                  );
                }
              }
            });
            return lines.join("\n");
          },
          [maxRows],
          "No table data found.",
        );
      },
    );
  
    toolRegistry.register(
      ToolName.INSPECT_FILTER_STATE,
      INSPECT_FILTER_STATE_DEF,
      async (args, tabId) => {
        const pattern = (args.pattern as string) || "";
        const maxResults = Math.min(
          Math.max((args.maxResults as number) || 30, 1),
          80,
        );
        return runReadOnlyPageInspector(
          tabId,
          (pat: string, max: number) => {
            const norm = (value: unknown) =>
              String(value ?? "")
                .replace(/\s+/g, " ")
                .trim();
            const include = (text: string) =>
              !pat || text.toLowerCase().includes(pat.toLowerCase());
            const lines: string[] = [
              `URL: ${location.href}`,
              `Title: ${document.title}`,
            ];
            const params = new URLSearchParams(location.search);
            const queryParams = [
              "sysparm_query",
              "sysparm_fixed_query",
              "sysparm_filter",
              "filter",
              "q",
            ]
              .map((key) => [key, params.get(key)] as const)
              .filter(([, value]) => value);
            if (queryParams.length > 0) {
              lines.push(
                `Query state: ${queryParams.map(([k, v]) => `${k}=${v}`).join("; ")}`,
              );
            }
  
            const candidates = [
              ...document.querySelectorAll(
                "button, input, select, textarea, [role='button'], [role='combobox'], [class*='filter' i], [id*='filter' i], [aria-label*='filter' i], [title*='filter' i]",
              ),
            ];
            const seen = new Set<string>();
            const items: string[] = [];
            for (const el of candidates) {
              const control = el as
                | HTMLInputElement
                | HTMLSelectElement
                | HTMLTextAreaElement;
              const text = norm(
                [
                  el.getAttribute("aria-label"),
                  el.getAttribute("title"),
                  el.getAttribute("name"),
                  el.getAttribute("id"),
                  control.value,
                  el.textContent,
                ]
                  .filter(Boolean)
                  .join(" "),
              );
              if (!text || !include(text)) continue;
              const key = `${el.tagName}:${text}`;
              if (seen.has(key)) continue;
              seen.add(key);
              items.push(`- <${el.tagName.toLowerCase()}> ${text.slice(0, 220)}`);
              if (items.length >= max) break;
            }
            if (items.length === 0) {
              lines.push(
                `No filter controls or state found${pat ? ` matching "${pat}"` : ""}.`,
              );
            } else {
              lines.push(
                `Filter controls/state${pat ? ` matching "${pat}"` : ""}:`,
              );
              lines.push(...items);
            }
            return lines.join("\n");
          },
          [pattern, maxResults],
          "No filter state found.",
        );
      },
    );
}
