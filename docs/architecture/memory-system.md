# Memory System (Second Brain)

The Memory System provides OpenSidebar with persistent, client-side memory using a hybrid search approach (semantic + keyword) with all data staying in the browser.

## Architecture

```
Service Worker              Offscreen Document          Web Worker
     │                             │                         │
     │── MEMORY_WORKER ───────────→│                         │
     │   { action: "search" }      │── postMessage ─────────→│
     │                             │   { action: "embed" }   │
     │                             │                         │
     │                             │                   ┌─────┴─────┐
     │                             │                   │Transformers│
     │                             │                   │MiniLM-L6-v2│
     │                             │                   └─────┬─────┘
     │                             │                         │
     │                             │←── postMessage ──────────│
     │                             │   { embedding }          │
     │                             │                         │
     │                       ┌─────┴─────┐                   │
     │                       │           │                   │
     │                   Voy query   SQLite FTS5             │
     │                   (semantic)  (keyword)              │
     │                       │           │                   │
     │                       └─────┬─────┘                   │
     │                             │                         │
     │                         RRF fusion                    │
     │                             │                         │
     │←── MEMORY_WORKER_RESPONSE ──│                         │
     │   { results }               │                         │
```

## Why Offscreen Document?

Service workers cannot reliably run WASM modules due to memory pressure and cold starts. Offscreen documents provide:

- Full DOM/Window context
- Ability to spawn web workers
- Persistent execution environment

## Components

### Offscreen Document (`src/offscreen/memory/main.ts`)

Coordinates SQLite, Voy, and the embedding worker.

**Initialization:**

```typescript
async function initialize(): Promise<void> {
  // 1. Initialize SQLite WASM
  const SQL = await initSqlJs({
    locateFile: (file: string) => `/wasm/${file}`,
  });

  // Restore from IndexedDB or create new
  const savedDb = await loadFromIndexedDB("qsidebar-memory-db");
  db = savedDb ? new SQL.Database(savedDb) : new SQL.Database();

  // Create FTS5 table
  db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories USING fts5(
            id UNINDEXED,
            content,
            category,
            source_url UNINDEXED,
            created_at UNINDEXED,
            tokenize='porter unicode61'
        );
    `);

  // 2. Initialize Voy
  voy = new Voy();
  const savedVoy = await loadFromIndexedDB("qsidebar-voy-index");
  if (savedVoy) {
    voy.deserialize(new TextDecoder().decode(savedVoy));
  }

  // 3. Initialize embedding worker
  worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });

  // Wait for worker ready signal
  await waitForWorkerReady();
}
```

### Web Worker (`src/offscreen/memory/worker.ts`)

Runs Transformers.js for embedding generation without blocking the main thread.

```typescript
import { pipeline } from "@huggingface/transformers";

let embedder: any = null;

async function init(): Promise<void> {
  embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
    dtype: "fp32",
  });
  self.postMessage({ action: "ready" });
}

self.onmessage = async (e) => {
  const { action, requestId, text } = e.data;

  if (action === "embed") {
    const output = await embedder(text, {
      pooling: "mean",
      normalize: true,
    });
    const embedding = Array.from(output.data);
    self.postMessage({ action: "embed_result", requestId, embedding });
  }
};
```

## Memory Operations

### Add Entry

```typescript
async function addMemory(
  content: string,
  category: string,
  sourceUrl: string,
): Promise<string> {
  const id = crypto.randomUUID();

  // 1. Get embedding from worker
  const embedding = await getEmbedding(content);

  // 2. Insert into SQLite FTS5
  db.run(
    "INSERT INTO memories (id, content, category, source_url, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, content, category, sourceUrl, Date.now()],
  );

  // 3. Insert into Voy
  voy.add({
    id,
    title: category,
    url: sourceUrl,
    embeddings: [embedding],
  });

  // 4. Persist to IndexedDB
  await persist();

  return id;
}
```

### Search (Hybrid)

```typescript
async function searchMemory(
  query: string,
  limit: number,
): Promise<MemorySearchResult[]> {
  // 1. Get query embedding
  const embedding = await getEmbedding(query);

  // 2. Semantic search via Voy
  const queryVector = new Float32Array(embedding);
  const voyResultsRaw = voy.search(queryVector, limit * 2);
  const voyResults = voyResultsRaw.neighbors.map((n, i) => ({
    id: n.id,
    score: 0.9 - i * 0.05, // Approximate ranking
  }));

  // 3. Keyword search via SQLite FTS5
  const ftsResults = [];
  const stmt = db.prepare(`
        SELECT id, rank
        FROM memories
        WHERE memories MATCH ?
        ORDER BY rank
        LIMIT ?
    `);
  stmt.bind([query, limit * 2]);
  while (stmt.step()) {
    const row = stmt.get();
    ftsResults.push({ id: row[0], rank: row[1] });
  }
  stmt.free();

  // 4. RRF Fusion
  const fused = reciprocalRankFusion(voyResults, ftsResults, limit);

  return fused;
}
```

### PDF Extraction

```typescript
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

## Reciprocal Rank Fusion (RRF)

Combines ranked lists from semantic and keyword search into a single ranking.

**Formula:**

```
RRF_score(d) = Σ (1 / (k + rank_i(d)))
```

Where:

- `k = 60` (standard constant)
- `rank_i(d)` = 1-based rank in list `i`
- Missing documents contribute 0

**Implementation:**

```typescript
function reciprocalRankFusion(
  voyResults: Array<{ id: string; score: number }>,
  ftsResults: Array<{ id: string; rank: number }>,
  limit: number,
  fetchEntry: (id: string) => MemoryEntry,
): MemorySearchResult[] {
  const scores = new Map<
    string,
    { semantic: number; keyword: number; rrf: number }
  >();

  // Score semantic results
  voyResults.forEach((result, index) => {
    const rank = index + 1;
    const rrf = 1 / (RRF_K + rank);
    scores.set(result.id, { semantic: result.score, keyword: 0, rrf });
  });

  // Score keyword results
  ftsResults.forEach((row, index) => {
    const rank = index + 1;
    const rrf = 1 / (RRF_K + rank);
    const existing = scores.get(row.id);
    if (existing) {
      existing.keyword = Math.abs(row.rank);
      existing.rrf += rrf;
    } else {
      scores.set(row.id, { semantic: 0, keyword: Math.abs(row.rank), rrf });
    }
  });

  // Sort by RRF score descending
  const sorted = Array.from(scores.entries())
    .sort(([, a], [, b]) => b.rrf - a.rrf)
    .slice(0, limit);

  // Hydrate with full entries
  return sorted.map(([id, scoreData]) => ({
    entry: fetchEntry(id),
    score: scoreData.rrf,
    scores: {
      semantic: scoreData.semantic,
      keyword: scoreData.keyword,
    },
  }));
}
```

## Persistence

SQLite database and Voy index are persisted to IndexedDB:

```typescript
async function persist(): Promise<void> {
  if (db) {
    const data = db.export();
    await saveToIndexedDB("qsidebar-memory-db", data);
  }
  if (voy) {
    const json = voy.serialize();
    const encoder = new TextEncoder();
    await saveToIndexedDB("qsidebar-voy-index", encoder.encode(json));
  }
}
```

## Tools

Two tools expose memory functionality to the LLM:

### memory_add

```typescript
{
    name: "memory_add",
    description: "Save info to long-term memory.",
    parameters: {
        content: string,    // Required: text to remember
        category: string    // Optional: category tag
    }
}
```

### memory_search

```typescript
{
    name: "memory_search",
    description: "Search long-term memory.",
    parameters: {
        query: string      // Required: search query
    }
}
```

## Message Flow

```typescript
// Background sends request
const message: MemoryWorkerMessage = {
    type: "MEMORY_WORKER",
    requestId: crypto.randomUUID(),
    source: MessageSource.BACKGROUND,
    payload: { action: "search", query: "...", limit: 5 }
};

chrome.runtime.sendMessage(message);

// Offscreen processes and responds
const response: MemoryWorkerResponse = {
    type: "MEMORY_WORKER_RESPONSE",
    requestId: message.requestId,
    source: MessageSource.OFFSCREEN,
    payload: { action: "search", results: [...] }
};

chrome.runtime.sendMessage(response);
```

## Dependencies

| Package                     | Purpose                   |
| --------------------------- | ------------------------- |
| `@huggingface/transformers` | Embedding model inference |
| `sql.js`                    | SQLite WASM               |
| `voy-search`                | Vector similarity search  |
| `pdfjs-dist`                | PDF text extraction       |
| `vite-plugin-static-copy`   | Copy WASM files to build  |

## Configuration

Vite config for WASM support:

```typescript
export default defineConfig({
  plugins: [
    // ...
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/sql.js/dist/sql-wasm.wasm",
          dest: "wasm",
        },
      ],
    }),
  ],
  optimizeDeps: {
    exclude: ["sql.js", "@huggingface/transformers", "voy-search"],
  },
  assetsInclude: ["**/*.wasm"],
});
```

## Edge Cases

- **First-time init:** Model download (~23MB) on first use
- **Storage quota:** Falls back to in-memory if IndexedDB quota exceeded
- **Offscreen closed:** Re-created on next operation, state restored from IndexedDB
- **Concurrent access:** Operations serialized via message queue

## Key Files

| File                              | Purpose                        |
| --------------------------------- | ------------------------------ |
| `src/offscreen/memory/main.ts`    | Main memory logic, SQLite, Voy |
| `src/offscreen/memory/worker.ts`  | Embedding web worker           |
| `src/offscreen/memory/utils.ts`   | RRF algorithm                  |
| `src/background/memory/bridge.ts` | Bridge to background           |
| `src/background/tools/index.ts`   | Tool definitions               |

## Testing

**tests/memory/rrf.test.ts** - RRF algorithm
**tests/memory/fts5.test.ts** - SQLite FTS5

## See Also

- [Agent Loop](./agent-loop.md) - Uses memory tools
- [Content Script](./content-script.md) - Can trigger PDF extraction
