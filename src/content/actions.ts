import {
    ToolName,
    ClickElementArgs,
    TypeTextArgs,
    ScrollPageArgs,
    ScrollDirection,
    SelectOptionArgs,
    PressKeyArgs,
    DragAndDropArgs,
    DrawStrokeArgs,
} from "../types";
import { getTagMap, getVisibleText } from "./tagging";
import { buildSnapshot } from "./snapshot";

export async function executeAction(
    toolName: ToolName,
    args: Record<string, unknown>
): Promise<{ success: boolean; result: string; navigated: boolean }> {
    switch (toolName) {
        case ToolName.CLICK_ELEMENT:
            return executeClick(args as unknown as ClickElementArgs);
        case ToolName.TYPE_TEXT:
            return executeType(args as unknown as TypeTextArgs);
        case ToolName.SCROLL_PAGE:
            return executeScroll(args as unknown as ScrollPageArgs);
        case ToolName.READ_PAGE:
            return executeRead();
        case ToolName.TAKE_SCREENSHOT:
            return { success: true, result: "Screenshot handled by service worker", navigated: false };
        case ToolName.HOVER_ELEMENT:
            return executeHover(args as unknown as { id: number });
        case ToolName.FIND_ELEMENT:
            return executeFindElement(args as unknown as { text: string });
        case ToolName.SELECT_OPTION:
            return executeSelectOption(args as unknown as SelectOptionArgs);
        case ToolName.PRESS_KEY:
            return executePressKey(args as unknown as PressKeyArgs);
        case ToolName.DRAG_AND_DROP:
            return executeDragAndDrop(args as unknown as DragAndDropArgs);
        case ToolName.DRAW_STROKE:
            return executeDrawStroke(args as unknown as DrawStrokeArgs);
        default:
            return { success: false, result: `Unknown tool: ${toolName}`, navigated: false };
    }
}

function executeClick(args: ClickElementArgs): { success: boolean; result: string; navigated: boolean } {
    const tagMap = getTagMap();
    const el = tagMap.get(args.id);
    if (!el) {
        return { success: false, result: `No element with tag [${args.id}]`, navigated: false };
    }

    // Scroll into view if needed
    el.scrollIntoView({ behavior: "instant", block: "center" });

    // Z-Index Check: Is the element actually clickable?
    // We check the center point of the rect
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const topEl = document.elementFromPoint(x, y);

    if (topEl && !el.contains(topEl) && !topEl.contains(el)) {
        // Overlaid by something else (e.g. cookie banner)
        return {
            success: false,
            result: `Click intercepted! Element [${args.id}] is covered by <${topEl.tagName.toLowerCase()} class="${topEl.className}">. Try closing the overlay first.`,
            navigated: false
        };
    }

    // Determine if this click will navigate
    const willNavigate = (
        (el.tagName === "A" && el.hasAttribute("href") && !(el as HTMLAnchorElement).target) ||
        el.closest("form")?.querySelector("[type='submit']") === el
    );

    // Dispatch real click events
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    // Also call .click() for elements that handle it natively
    if (el instanceof HTMLElement) {
        el.click();
    }

    return {
        success: true,
        result: `Clicked [${args.id}] ${el.tagName.toLowerCase()} "${getVisibleText(el).slice(0, 40)}"`,
        navigated: willNavigate,
    };
}

function executeType(args: TypeTextArgs): { success: boolean; result: string; navigated: boolean } {
    const tagMap = getTagMap();
    const el = tagMap.get(args.id);
    if (!el) {
        return { success: false, result: `No element with tag [${args.id}]`, navigated: false };
    }

    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable)) {
        return { success: false, result: `Element [${args.id}] is not a text input`, navigated: false };
    }

    // Focus the element
    if (el instanceof HTMLElement) el.focus();

    // Clear existing value
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.value = "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // Type character by character for SPA frameworks that listen to input events
    for (const char of args.text) {
        el.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
            el.value += char;
        } else if ((el as HTMLElement).textContent !== null) {
            (el as HTMLElement).textContent += char;
        }
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true }));
    }

    el.dispatchEvent(new Event("change", { bubbles: true }));

    // Press Enter if requested
    let navigated = false;
    if (args.pressEnter) {
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));

        // Check if the input is inside a form — Enter may submit it
        const form = el.closest("form");
        if (form) {
            form.requestSubmit();
            navigated = true;
        }
    }

    return {
        success: true,
        result: `Typed "${args.text}" into [${args.id}]${args.pressEnter ? " and pressed Enter" : ""}`,
        navigated,
    };
}

function executeScroll(args: ScrollPageArgs): { success: boolean; result: string; navigated: boolean } {
    const amount = args.amount ?? 500;
    const delta = args.direction === ScrollDirection.UP ? -amount : amount;

    window.scrollBy({ top: delta, behavior: "instant" });

    return {
        success: true,
        result: `Scrolled ${args.direction} by ${amount}px. New position: ${window.scrollY}/${document.documentElement.scrollHeight - window.innerHeight}`,
        navigated: false,
    };
}

function executeRead(): { success: boolean; result: string; navigated: boolean } {
    const snapshot = buildSnapshot(true, true);

    // Format for the LLM
    const lines: string[] = [
        `Page: ${snapshot.title}`,
        `URL: ${snapshot.url}`,
        `Scroll: ${snapshot.scroll.y}/${snapshot.scroll.maxY}`,
        "",
        "Interactive elements:",
    ];

    for (const el of snapshot.elements) {
        const attrs = Object.entries(el.attributes).map(([k, v]) => `${k}="${v}"`).join(" ");
        lines.push(`  [${el.tag}] <${el.tagName}${attrs ? " " + attrs : ""}> "${el.text}"`);
    }

    if (snapshot.viewportText) {
        lines.push("", "Page text:", snapshot.viewportText);
    }

    return {
        success: true,
        result: lines.join("\n"),
        navigated: false,
    };
}

function executeHover(args: { id: number }): { success: boolean; result: string; navigated: boolean } {
    const tagMap = getTagMap();
    const el = tagMap.get(args.id);
    if (!el) return { success: false, result: `No element with tag [${args.id}]`, navigated: false };

    el.scrollIntoView({ behavior: "instant", block: "center" });
    el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));

    return { success: true, result: `Hovered over element [${args.id}]`, navigated: false };
}

function executeFindElement(args: { text: string }): { success: boolean; result: string; navigated: boolean } {
    const found = (window as any).find(args.text);
    return {
        success: !!found,
        result: found ? `Found "${args.text}"` : `Text "${args.text}" not found`,
        navigated: false
    };
}

function executeSelectOption(args: SelectOptionArgs): { success: boolean; result: string; navigated: boolean } {
    const tagMap = getTagMap();
    const el = tagMap.get(args.id);
    if (!el) {
        return { success: false, result: `No element with tag [${args.id}]`, navigated: false };
    }

    if (!(el instanceof HTMLSelectElement)) {
        return { success: false, result: `Element [${args.id}] is not a <select> element`, navigated: false };
    }

    // Find matching option by text content or value attribute
    const options = Array.from(el.options);
    const match = options.find(
        (opt) =>
            opt.textContent?.trim().toLowerCase() === args.value.toLowerCase() ||
            opt.value.toLowerCase() === args.value.toLowerCase()
    );

    if (!match) {
        const available = options.map((opt) => `"${opt.textContent?.trim()}" (value="${opt.value}")`).join(", ");
        return {
            success: false,
            result: `No option matching "${args.value}" in [${args.id}]. Available options: ${available}`,
            navigated: false,
        };
    }

    // Set the value and dispatch change event
    el.value = match.value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("input", { bubbles: true }));

    return {
        success: true,
        result: `Selected "${match.textContent?.trim()}" in [${args.id}]`,
        navigated: false,
    };
}

function executePressKey(args: PressKeyArgs): { success: boolean; result: string; navigated: boolean } {
    const modifiers = args.modifiers ?? [];
    const opts: KeyboardEventInit = {
        key: args.key,
        code: args.key.length === 1 ? `Key${args.key.toUpperCase()}` : args.key,
        bubbles: true,
        cancelable: true,
        ctrlKey: modifiers.includes("ctrl"),
        shiftKey: modifiers.includes("shift"),
        altKey: modifiers.includes("alt"),
        metaKey: modifiers.includes("meta"),
    };

    window.dispatchEvent(new KeyboardEvent("keydown", opts));
    window.dispatchEvent(new KeyboardEvent("keyup", opts));

    const modStr = modifiers.length > 0 ? ` (${modifiers.join("+")})` : "";
    return {
        success: true,
        result: `Pressed key "${args.key}"${modStr}`,
        navigated: false,
    };
}

function executeDragAndDrop(args: DragAndDropArgs): { success: boolean; result: string; navigated: boolean } {
    const tagMap = getTagMap();
    const sourceEl = tagMap.get(args.sourceId);
    if (!sourceEl) {
        return { success: false, result: `No element with tag [${args.sourceId}]`, navigated: false };
    }
    const targetEl = tagMap.get(args.targetId);
    if (!targetEl) {
        return { success: false, result: `No element with tag [${args.targetId}]`, navigated: false };
    }

    sourceEl.scrollIntoView({ behavior: "instant", block: "center" });

    const dataTransfer = new DataTransfer();

    sourceEl.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
    targetEl.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
    targetEl.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
    sourceEl.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer }));

    return {
        success: true,
        result: `Dragged [${args.sourceId}] onto [${args.targetId}]`,
        navigated: false,
    };
}

function executeDrawStroke(args: DrawStrokeArgs): { success: boolean; result: string; navigated: boolean } {
    const tagMap = getTagMap();
    const el = tagMap.get(args.id);
    if (!el) {
        return { success: false, result: `No element with tag [${args.id}]`, navigated: false };
    }

    el.scrollIntoView({ behavior: "instant", block: "center" });
    const rect = el.getBoundingClientRect();

    const toClient = (offX: number, offY: number) => ({
        clientX: rect.left + offX,
        clientY: rect.top + offY,
    });

    const STEPS = 10;
    const start = toClient(args.startX, args.startY);

    el.dispatchEvent(new MouseEvent("mousedown", { ...start, bubbles: true, cancelable: true }));

    for (let i = 1; i <= STEPS; i++) {
        const t = i / STEPS;
        const pt = toClient(
            args.startX + (args.endX - args.startX) * t,
            args.startY + (args.endY - args.startY) * t,
        );
        el.dispatchEvent(new MouseEvent("mousemove", { ...pt, bubbles: true, cancelable: true }));
    }

    const end = toClient(args.endX, args.endY);
    el.dispatchEvent(new MouseEvent("mouseup", { ...end, bubbles: true, cancelable: true }));

    return {
        success: true,
        result: `Drew stroke on [${args.id}] from (${args.startX},${args.startY}) to (${args.endX},${args.endY})`,
        navigated: false,
    };
}
