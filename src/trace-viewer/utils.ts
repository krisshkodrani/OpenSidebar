export function formatTime(ms: number | undefined | null): string {
  if (!ms) return "---";
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  const secs = String(d.getSeconds()).padStart(2, "0");
  return `${month}/${day} ${hours}:${mins}:${secs}`;
}

export function formatDate(ms: number | undefined | null): string {
  if (!ms) return "---";
  const d = new Date(ms);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

export function formatDuration(ms: number | undefined | null): string {
  if (ms == null) return "---";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function formatCost(cost: number | undefined | null): string {
  if (cost == null || cost === 0) return "";
  if (cost < 0.001) return `$${cost.toFixed(6)}`;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}

export function formatTokens(n: number | undefined | null): string {
  if (n == null) return "---";
  if (n >= 10000) return `${(n / 1000).toFixed(1)}K`;
  if (n >= 1000) return n.toLocaleString("en-US");
  return String(n);
}

export function truncate(s: string | undefined | null, len: number): string {
  if (!s) return "";
  return s.length > len ? s.slice(0, len) + "..." : s;
}

/** Extract a clean title from a query — strips "Objective:" prefix, takes first line. */
export function extractQueryTitle(query: string | undefined | null): {
  title: string;
  hasMore: boolean;
} {
  if (!query) return { title: "(no query)", hasMore: false };
  const match = query.match(/^Objective:\s*(.+?)(?:\n|$)/);
  if (match) {
    return { title: match[1].trim(), hasMore: query.length > match[0].length };
  }
  const firstLine = query.split("\n")[0].trim();
  return { title: firstLine || "(no query)", hasMore: query.includes("\n") };
}

export function shortModel(model: string | undefined | null): string {
  if (!model) return "?";
  return model
    .replace("openai/", "")
    .replace("z-ai/", "")
    .replace("-instruct", "");
}

export function outcomeClass(outcome: string | undefined): string {
  switch (outcome) {
    case "completed":
    case "success":
      return "completed";
    case "stopped":
      return "stopped";
    case "failure":
    case "error":
      return "error";
    case "max_turns":
      return "max_turns";
    default:
      return "error";
  }
}

export function isoDayOffset(daysBack: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function summarizeEventData(ev: {
  data?: Record<string, unknown>;
}): string {
  if (!ev.data || Object.keys(ev.data).length === 0) return "";
  const parts: string[] = [];
  const keys = Object.keys(ev.data);
  for (let i = 0; i < keys.length && i < 4; i++) {
    const val = ev.data[keys[i]];
    if (typeof val === "string") parts.push(`${keys[i]}: ${truncate(val, 40)}`);
    else if (typeof val === "number" || typeof val === "boolean")
      parts.push(`${keys[i]}: ${val}`);
    else if (val != null)
      parts.push(`${keys[i]}: ${truncate(JSON.stringify(val), 40)}`);
  }
  if (keys.length > 4) parts.push("...");
  return parts.join(", ");
}
