import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { normalizeAgentSessionRecord, type TraceSessionLike } from "../log-server-helpers";

/** JSONL sessions and discoverable traces absent from the session index. */
export function readLegacyJsonlSessions(traceDir: string): {
  indexed: TraceSessionLike[];
  orphans: TraceSessionLike[];
} {
  const indexedById = new Map<string, TraceSessionLike>();
  const indexPath = join(traceDir, "index.jsonl");
  if (existsSync(indexPath)) {
    for (const line of readFileSync(indexPath, "utf-8").split(/\r?\n/)) {
      if (!line) continue;
      try {
        const session = normalizeAgentSessionRecord(JSON.parse(line));
        if (session.sessionId)
          indexedById.set(session.sessionId, { source: "live", ...session });
      } catch {
        // Match the existing JSONL readers: ignore malformed lines.
      }
    }
  }

  const orphans: TraceSessionLike[] = [];
  if (existsSync(traceDir)) {
    for (const file of readdirSync(traceDir)) {
      if (!file.endsWith(".jsonl") || file === "index.jsonl") continue;
      const sessionId = file.slice(0, -6);
      if (!indexedById.has(sessionId))
        orphans.push({ sessionId, source: "orphan_trace_file" } as TraceSessionLike);
    }
  }
  return { indexed: [...indexedById.values()], orphans };
}
