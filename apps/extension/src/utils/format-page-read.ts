import type { DomSnapshot } from "../types";

/** Text returned by read_page, using the same tags shown in the agent snapshot. */
export function formatPageRead(snapshot: DomSnapshot): string {
  const lines: string[] = [
    `Page: ${snapshot.title}`,
    `URL: ${snapshot.url}`,
    `Scroll: ${snapshot.scroll.y}/${snapshot.scroll.maxY}`,
    "",
    "Interactive elements:",
  ];

  for (const el of snapshot.elements) {
    const attrs = Object.entries(el.attributes)
      .map(([key, value]) => `${key}="${value}"`)
      .join(" ");
    lines.push(
      `  [${el.tag}] <${el.tagName}${attrs ? " " + attrs : ""}> "${el.text}"`,
    );
  }

  if (snapshot.pageContent) {
    lines.push("", "Page content:", snapshot.pageContent);
  }
  return lines.join("\n");
}
