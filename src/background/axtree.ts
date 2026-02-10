/**
 * Experimental: Accessibility Tree capture via Chrome DevTools Protocol.
 * Requires `debugger` permission in manifest.json.
 *
 * This module provides an alternative to DOM-based tagging by using the
 * browser's built-in Accessibility Tree, which offers 10-20x token reduction
 * over raw DOM parsing (semantic roles by default, no decorative elements).
 *
 * Usage: Behind an experimental flag in UserSettings.
 * The `debugger` permission shows a warning banner to users.
 */

export interface AXNode {
  nodeId: string;
  role?: { value: string };
  name?: { value: string };
  properties?: Array<{ name: string; value: { value: unknown } }>;
  childIds?: string[];
}

/**
 * Capture the full Accessibility Tree for a tab.
 * Attaches the Chrome debugger, retrieves the AX tree, then detaches.
 *
 * @throws if the `debugger` permission is not granted or tab is invalid
 */
export async function captureAXTree(tabId: number): Promise<AXNode[]> {
  await chrome.debugger.attach({ tabId }, "1.3");

  try {
    await chrome.debugger.sendCommand({ tabId }, "Accessibility.enable");

    const result = (await chrome.debugger.sendCommand(
      { tabId },
      "Accessibility.getFullAXTree",
    )) as { nodes: AXNode[] };

    // Filter out non-semantic nodes (role=none are decorative)
    return result.nodes.filter((n) => n.role?.value !== "none");
  } finally {
    await chrome.debugger.detach({ tabId });
  }
}

/**
 * Convert AX nodes into a compact text representation for LLM context.
 * Each node becomes: `[role] "name" {property=value, ...}`
 */
export function formatAXTreeForPrompt(
  nodes: AXNode[],
  maxNodes: number = 50,
): string {
  return nodes
    .slice(0, maxNodes)
    .map((node) => {
      const role = node.role?.value || "unknown";
      const name = node.name?.value || "";
      const props = (node.properties || [])
        .filter((p) => p.value.value !== undefined && p.value.value !== false)
        .map((p) => `${p.name}=${JSON.stringify(p.value.value)}`)
        .join(", ");

      const propsStr = props ? ` {${props}}` : "";
      return `[${role}] "${name}"${propsStr}`;
    })
    .join("\n");
}
