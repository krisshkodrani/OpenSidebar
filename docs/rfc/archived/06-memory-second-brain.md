# Phase 6 — Memory "Second Brain" (Local RAG)

> **Goal:** Implement a fully client-side memory system using Transformers.js for embeddings, Voy for vector search, SQLite WASM for keyword search (FTS5), and Reciprocal Rank Fusion (RRF) to combine results — all running inside an offscreen document with a web worker.

---

## Background

The Second Brain gives QSidebar persistent memory. Users' information stays entirely in the browser — no data leaves the device (except to the LLM APIs, where memory results are included in context).

**Why offscreen document + web worker?**
- Service workers cannot run WASM modules reliably (memory pressure, cold starts).
- Offscreen documents have a full DOM/Window context and can spawn web workers.
- The web worker runs Transformers.js (embedding model inference) without blocking the offscreen document.

---

## Architecture

```
Service Worker                  Offscreen Document               Web Worker
(background.ts)                 (offscreen.ts)                   (memory-worker.ts)
     │                                │                                │
     │── MEMORY_WORKER ─────────────→ │                                │
     │   { action: "search",          │                                │
     │     query: "..." }             │── postMessage ───────────────→ │
     │                                │   { action: "embed",           │
     │── EXTRACT_PDF ───────────────→ │     text: "..." }              │
     │   { url: "..." }               │                                │
     │                                │                                │
     │                                │                        ┌───────┴───────┐
     │                                │                        │ Transformers.js│
     │                                │                        │ MiniLM-L6-v2  │
     │                                │                        └───────┬───────┘
     │                                │                                │
     │                                │←── postMessage ────────────────│
     │                                │   { embedding: Float32Array }  │
     │                                │                                │
     │                          ┌─────┴──────┐                         │
     │                          │            │                         │
     │                     Voy query    SQLite FTS5                    │
     │                     (semantic)   (keyword)                      │
     │                          │            │                         │
     │                          └─────┬──────┘                         │
     │                                │                                │
     │                          RRF fusion                             │
     │                                │                                │
     │←── MEMORY_WORKER_RESPONSE ─────│                                │
     │   { results: [...] }           │                                │
```

---

## Implementation Details

### Offscreen Document Creation

The service worker creates the offscreen document on demand:

```typescript
// background.ts
async function ensureOffscreenDocument(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });

  if (existingContexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: "src/offscreen/offscreen.html",
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: "Running Transformers.js embeddings and SQLite WASM for local memory",
  });
}
```

### Offscreen Document (`src/offscreen/offscreen.ts`)

```typescript
import initSqlJs, { Database } from "sql.js";
import { Voy } from "voy-search";
import * as pdfjsLib from "pdfjs-dist";

// Set worker src for pdf.js
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

let db: Database | null = null;
let voy: Voy | null = null;
let worker: Worker | null = null;

// Initialize on first message
async function initialize(): Promise<void> {
  // 1. Initialize SQLite
  const SQL = await initSqlJs({
    locateFile: (file: string) => `wasm/${file}`,
  });

  // Try to restore from IndexedDB
  const savedDb = await loadFromIndexedDB("qsidebar-memory-db");
  db = savedDb ? new SQL.Database(savedDb) : new SQL.Database();

  // Create FTS5 table if not exists
  db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories USING fts5(
      id,
      content,
      category,
      source_url,
      created_at,
      tokenize='porter unicode61'
    );
  `);

  // 2. Initialize Voy
  voy = new Voy();

  // Restore Voy index from IndexedDB
  const savedVoyIndex = await loadFromIndexedDB("qsidebar-voy-index");
  if (savedVoyIndex) {
    voy.deserialize(savedVoyIndex);
  }

  // 3. Initialize Transformers.js web worker
  worker = new Worker(
    new URL("./memory-worker.ts", import.meta.url),
    { type: "module" }
  );

  // Wait for worker to signal ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Worker init timeout")), 15000);
    worker!.onmessage = (e) => {
      if (e.data.action === "ready") {
        clearTimeout(timeout);
        resolve();
      }
    };
  });
}
```

### Web Worker (`src/offscreen/memory-worker.ts`)

```typescript
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

let embedder: FeatureExtractionPipeline | null = null;

// Initialize on startup
async function init(): Promise<void> {
  embedder = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2",
    { dtype: "fp32" }
  );
  self.postMessage({ action: "ready" });
}

// Handle embedding requests
self.onmessage = async (e: MessageEvent) => {
  const { action, requestId, text } = e.data;

  if (action === "embed") {
    if (!embedder) {
      self.postMessage({ action: "error", requestId, error: "Embedder not initialized" });
      return;
    }

    const output = await embedder(text, { pooling: "mean", normalize: true });
    const embedding = new Float32Array(output.data);

    self.postMessage({ action: "embed_result", requestId, embedding });
  }
};

init().catch((err) => {
  self.postMessage({ action: "error", error: `Init failed: ${err.message}` });
});
```

### Memory Operations

#### Add Entry

```typescript
async function addMemory(
  content: string,
  category: string,
  sourceUrl: string
): Promise<string> {
  const id = crypto.randomUUID();
  const createdAt = Date.now();

  // 1. Get embedding from worker
  const embedding = await getEmbedding(content);

  // 2. Insert into SQLite FTS5
  db!.run(
    "INSERT INTO memories (id, content, category, source_url, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, content, category, sourceUrl, createdAt]
  );

  // 3. Insert into Voy
  voy!.add({
    id,
    title: content.slice(0, 100),
    url: sourceUrl,
    embeddings: [Array.from(embedding)],
  });

  // 4. Persist to IndexedDB
  await persistToIndexedDB();

  return id;
}

// PDF Extraction
async function extractPdfText(url: string): Promise<string> {
  const loadingTask = pdfjsLib.getDocument(url);
  const pdf = await loadingTask.promise;
  let fullText = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => item.str).join(" ");
    fullText += `[Page ${i}]\n${pageText}\n\n`;
  }

  return fullText;
}
```

#### Search (Hybrid: Semantic + Keyword → RRF)

```typescript
async function searchMemory(query: string, limit: number): Promise<MemorySearchResult[]> {
  // 1. Get query embedding
  const queryEmbedding = await getEmbedding(query);

  // 2. Semantic search via Voy
  const voyResults = voy!.search(Array.from(queryEmbedding), limit * 2);
  // voyResults: Array<{ id: string, score: number }>

  // 3. Keyword search via SQLite FTS5
  const ftsResults = db!.exec(
    `SELECT id, content, category, source_url, created_at, rank
     FROM memories
     WHERE memories MATCH ?
     ORDER BY rank
     LIMIT ?`,
    [query, limit * 2]
  );

  // 4. RRF Fusion
  const fusedResults = reciprocalRankFusion(voyResults, ftsResults, limit);

  return fusedResults;
}
```

### Reciprocal Rank Fusion (RRF) Algorithm

RRF combines ranked lists from multiple retrieval systems into a single ranked list. It is robust to score scale differences between systems.

**Formula:**

For each document `d` across `n` ranking lists:

```
RRF_score(d) = Σ (1 / (k + rank_i(d)))
```

Where:
- `k` is a constant (we use `k = 60`, the standard value from the original paper)
- `rank_i(d)` is the 1-based rank of document `d` in ranking list `i`
- If `d` does not appear in a ranking list, it is assigned a rank of `∞` (contributes 0)

```typescript
function reciprocalRankFusion(
  semanticResults: Array<{ id: string; score: number }>,
  keywordResults: FTS5Row[],
  limit: number
): MemorySearchResult[] {
  const scores = new Map<string, { semantic: number; keyword: number; rrf: number }>();

  // Score semantic results
  semanticResults.forEach((result, index) => {
    const rank = index + 1; // 1-based
    const rrf = 1 / (RRF_K + rank);
    scores.set(result.id, {
      semantic: result.score,
      keyword: 0,
      rrf,
    });
  });

  // Score keyword results
  keywordResults.forEach((row, index) => {
    const rank = index + 1;
    const rrf = 1 / (RRF_K + rank);
    const existing = scores.get(row.id);
    if (existing) {
      existing.keyword = Math.abs(row.rank); // FTS5 rank is negative (lower = better)
      existing.rrf += rrf;
    } else {
      scores.set(row.id, {
        semantic: 0,
        keyword: Math.abs(row.rank),
        rrf,
      });
    }
  });

  // Sort by RRF score (descending) and take top `limit`
  const sorted = Array.from(scores.entries())
    .sort(([, a], [, b]) => b.rrf - a.rrf)
    .slice(0, limit);

  // Fetch full entries from SQLite
  return sorted.map(([id, scoreData]) => {
    const rows = db!.exec("SELECT * FROM memories WHERE id = ?", [id]);
    const row = rows[0]?.values[0];

    return {
      entry: {
        id,
        content: row?.[1] as string ?? "",
        embedding: new Float32Array(0), // Don't return embedding in search results
        category: row?.[2] as string ?? "",
        sourceUrl: row?.[3] as string ?? "",
        createdAt: row?.[4] as number ?? 0,
      },
      score: scoreData.rrf,
      scores: {
        semantic: scoreData.semantic,
        keyword: scoreData.keyword,
      },
    };
  });
}
```

### IndexedDB Persistence

SQLite and Voy data are persisted to IndexedDB so they survive browser restarts.

```typescript
const IDB_NAME = "qsidebar-memory";
const IDB_VERSION = 1;

async function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("data")) {
        db.createObjectStore("data");
      }
    };
  });
}

async function saveToIndexedDB(key: string, data: Uint8Array): Promise<void> {
  const idb = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction("data", "readwrite");
    tx.objectStore("data").put(data, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadFromIndexedDB(key: string): Promise<Uint8Array | null> {
  const idb = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction("data", "readonly");
    const request = tx.objectStore("data").get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function persistToIndexedDB(): Promise<void> {
  // Save SQLite database
  const dbData = db!.export();
  await saveToIndexedDB("qsidebar-memory-db", dbData);

  // Save Voy index
  const voyData = voy!.serialize();
  await saveToIndexedDB("qsidebar-voy-index", voyData);
}
```

### WASM Bundling in Vite

WASM files need special handling in the Vite build:

```typescript
// vite.config.ts additions
export default defineConfig({
  // ...existing config...
  optimizeDeps: {
    exclude: ["sql.js", "@huggingface/transformers"],
  },
  build: {
    rollupOptions: {
      // ...existing config...
    },
  },
  assetsInclude: ["**/*.wasm"],
});
```

The `sql.js` WASM file is copied to the build output via a Vite plugin or manual copy step:

```typescript
// In vite.config.ts
import { viteStaticCopy } from "vite-plugin-static-copy";

plugins: [
  // ...existing plugins...
  viteStaticCopy({
    targets: [
      {
        src: "node_modules/sql.js/dist/sql-wasm.wasm",
        dest: "wasm",
      },
    ],
  }),
],
```

Add `vite-plugin-static-copy` to devDependencies:

```json
"vite-plugin-static-copy": "^2.2.0"
```

---

## Message Flow (Complete)

### Service Worker → Offscreen → Worker → Back

```typescript
// In background.ts: execute a memory tool
async function executeMemoryTool(toolName: ToolName, args: Record<string, unknown>): Promise<string> {
  await ensureOffscreenDocument();

  const requestId = crypto.randomUUID();

  // Build message based on tool
  let message: MemoryWorkerMessage;
  if (toolName === ToolName.MEMORY_SEARCH) {
    message = {
      type: "MEMORY_WORKER",
      requestId,
      source: MessageSource.BACKGROUND,
      payload: {
        action: "search",
        query: (args as MemorySearchArgs).query,
        limit: (args as MemorySearchArgs).limit ?? 5,
      },
    };
    };
  } else if (toolName === "EXTRACT_PDF") { 
     // Special internal tool, not exposed to LLM directly but used by read_page handler
     // if it detects a PDF
     message = {
         type: "MEMORY_WORKER",
         requestId,
         source: MessageSource.BACKGROUND,
         payload: {
             action: "extract_pdf",
             url: args.url as string
         }
     }
  } else {
    message = {
      type: "MEMORY_WORKER",
      requestId,
      source: MessageSource.BACKGROUND,
      payload: {
        action: "add",
        content: (args as MemoryAddArgs).content,
        category: (args as MemoryAddArgs).category ?? "general",
        sourceUrl: "", // Will be set by the agent loop from the active tab URL
      },
    };
  }

  // Send and await response
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve("Memory operation timed out.");
    }, 15_000);

    const listener = (response: RuntimeMessage) => {
      if (response.type === "MEMORY_WORKER_RESPONSE" && response.requestId === requestId) {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(listener);

        if (response.payload.action === "search") {
          const results = response.payload.results ?? [];
          if (results.length === 0) {
            resolve("No relevant memories found.");
          } else {
            const formatted = results.map((r: MemorySearchResult, i: number) =>
              `${i + 1}. [${r.entry.category}] ${r.entry.content} (score: ${r.score.toFixed(3)})`
            ).join("\n");
            resolve(`Found ${results.length} memories:\n${formatted}`);
          }
        } else if (response.payload.action === "add") {
          resolve(response.payload.success
            ? `Saved to memory (id: ${response.payload.id})`
            : `Failed to save: ${response.payload.error}`
          );
        }
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    chrome.runtime.sendMessage(message);
  });
}
```

---

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@huggingface/transformers` | `^3.3.0` | Transformers.js for embedding inference |
| `sql.js` | `^1.11.0` | SQLite compiled to WASM |
| `voy-search` | `^0.7.0` | WASM-based vector similarity search |
| `vite-plugin-static-copy` | `^2.2.0` | Copy WASM files to build output |

Add to `package.json` `dependencies`:

```json
"@huggingface/transformers": "^3.3.0",
"sql.js": "^1.11.0",
"@huggingface/transformers": "^3.3.0",
"sql.js": "^1.11.0",
"voy-search": "^0.7.0",
"pdfjs-dist": "^4.0.0"
```

---

## Edge Cases

- **First-time init:** Model download (~23MB for MiniLM-L6-v2) happens on first use. The worker sends progress events that could be forwarded to the UI.
- **IndexedDB quota:** If the browser's storage quota is exceeded, `saveToIndexedDB` will fail. The memory system continues working in-memory but data won't survive a restart. A warning is logged.
- **Offscreen document closed:** If Chrome closes the offscreen document (resource pressure), the service worker re-creates it on the next memory operation. In-memory state is lost, but IndexedDB state is restored.
- **Concurrent access:** Only one offscreen document exists. All memory operations are serialized via the message queue. No concurrent mutation issues.

---

## File Paths

| File | Purpose |
|---|---|
| `src/offscreen/offscreen.html` | HTML entry for the offscreen document |
| `src/offscreen/offscreen.ts` | SQLite + Voy initialization, RRF fusion, message handling |
| `src/offscreen/memory-worker.ts` | Transformers.js embedding web worker |
| `src/background/background.ts` | `ensureOffscreenDocument()`, `executeMemoryTool()` |
| `src/types/index.ts` | All memory-related types |

---

## Testing

- `tests/memory/rrf.test.ts` — RRF algorithm with known inputs/outputs
- `tests/memory/fts5.test.ts` — SQLite FTS5 queries (using sql.js in-memory)
- Manual testing: add memories, search, verify hybrid results

---

## Open Questions

None — all decisions are final.
