import { DomSnapshot } from "../types";
import { tagElements, getCachedElements } from "./tagging";

const MAX_VIEWPORT_TEXT_LENGTH = 15000;

export function buildSnapshot(includeText: boolean, refresh: boolean): DomSnapshot {
    const elements = refresh ? tagElements() : getCachedElements();

    let viewportText = "";
    if (includeText) {
        viewportText = extractViewportText();
    }

    return {
        title: document.title,
        url: window.location.href,
        elements,
        viewportText,
        viewport: {
            width: window.innerWidth,
            height: window.innerHeight,
        },
        scroll: {
            x: window.scrollX,
            y: window.scrollY,
            maxY: document.documentElement.scrollHeight - window.innerHeight,
        },
    };
}

/** Tags that get structure markers in viewport text */
const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const BLOCK_TAGS = new Set(["p", "tr", "blockquote", "div", "section", "article"]);

function extractViewportText(): string {
    // Use TreeWalker for text + element nodes to add lightweight structure
    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        {
            acceptNode(node) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    const el = node as Element;
                    const tag = el.tagName.toLowerCase();
                    // Skip hidden elements, scripts, styles
                    if (tag === "script" || tag === "style" || tag === "noscript") {
                        return NodeFilter.FILTER_REJECT;
                    }
                    try {
                        const style = window.getComputedStyle(el);
                        if (style.display === "none" || style.visibility === "hidden") {
                            return NodeFilter.FILTER_REJECT;
                        }
                    } catch {
                        // getComputedStyle can fail for detached elements
                    }
                    // Accept element nodes for structure markers
                    if (HEADING_TAGS.has(tag) || tag === "li" || BLOCK_TAGS.has(tag)) {
                        return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_SKIP;
                }
                // Text node
                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;
                const tag = parent.tagName.toLowerCase();
                if (tag === "script" || tag === "style" || tag === "noscript") {
                    return NodeFilter.FILTER_REJECT;
                }
                try {
                    const style = window.getComputedStyle(parent);
                    if (style.display === "none" || style.visibility === "hidden") {
                        return NodeFilter.FILTER_REJECT;
                    }
                } catch {
                    // Ignore
                }
                return NodeFilter.FILTER_ACCEPT;
            },
        }
    );

    const chunks: string[] = [];
    let totalLength = 0;
    let node: Node | null;
    while ((node = walker.nextNode())) {
        if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            const tag = el.tagName.toLowerCase();
            // Insert structure markers
            if (HEADING_TAGS.has(tag)) {
                chunks.push(`\n## `);
            } else if (tag === "li") {
                chunks.push(`\n- `);
            } else if (BLOCK_TAGS.has(tag)) {
                chunks.push(`\n`);
            }
            continue;
        }

        // Text node
        const text = node.textContent?.trim();
        if (!text) continue;
        chunks.push(text);
        totalLength += text.length;
        if (totalLength > MAX_VIEWPORT_TEXT_LENGTH) break;
    }

    return chunks.join(" ").replace(/ +/g, " ").trim().slice(0, MAX_VIEWPORT_TEXT_LENGTH);
}
