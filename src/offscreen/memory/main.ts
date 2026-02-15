import initSqlJs, { Database } from "sql.js";
import { Voy } from "voy-search";
import * as pdfjsLib from "pdfjs-dist";
import { MemoryWorkerMessage } from "../../types";
import { reciprocalRankFusion } from "./utils";
import { logger } from "../../utils";

// --- Configuration ---
const IDB_NAME = "qsidebar-memory";
const IDB_VERSION = 1;

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

// --- Global State ---
let db: Database | null = null;
let voy: Voy | null = null;
let worker: Worker | null = null;
let isReady = false;

// Request/Response mapping for worker
const pendingRequests = new Map<
  string,
  { resolve: (val: any) => void; reject: (err: any) => void }
>();

// --- Initialization ---

async function initialize() {
  try {
    logger.info("memory", "Initializing");

    // 1. Initialize SQLite WASM
    const SQL = await initSqlJs({
      // Path relative to offscreen/memory/index.html (where this script runs)
      // Vite copies wasm to /wasm/sql-wasm.wasm
      locateFile: (file: string) => `/wasm/${file}`,
    });

    // 2. Load DB from IndexedDB or create new
    const savedDb = await loadFromIndexedDB("qsidebar-memory-db");
    if (savedDb) {
      db = new SQL.Database(savedDb);
      logger.info("memory", "Restored SQLite DB");
    } else {
      db = new SQL.Database();
      logger.info("memory", "Created new SQLite DB");
    }

    // 3. Create FTS5 Table
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

    // 4. Initialize Voy (Vector Search)
    voy = new Voy();
    const savedVoy = await loadFromIndexedDB("qsidebar-voy-index");
    if (savedVoy) {
      try {
        // Voy expects string (JSON). IDB checks types.
        // Assuming valid serialized string.
        voy.deserialize(new TextDecoder().decode(savedVoy));
        logger.info("memory", "Restored Voy Index");
      } catch (e) {
        logger.error("memory", "Failed to restore Voy index", { error: e });
        // Continue with empty index
      }
    }

    // 5. Initialize Web Worker for Embeddings
    worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });

    // Wait for worker ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Worker init timeout")),
        20000,
      );

      worker!.onmessage = (e) => {
        const { action, requestId, embedding, error } = e.data;

        if (action === "ready") {
          logger.info("memory", "Embedding Worker Ready");
          clearTimeout(timeout);
          resolve();
        } else if (action === "embed_result") {
          const pending = pendingRequests.get(requestId);
          if (pending) {
            pendingRequests.delete(requestId);
            pending.resolve(embedding);
          }
        } else if (action === "error") {
          if (requestId) {
            const pending = pendingRequests.get(requestId);
            if (pending) {
              pendingRequests.delete(requestId);
              pending.reject(new Error(error));
            }
          } else {
            logger.error("memory", "Worker Error", { error });
            // If during init
            reject(new Error(error));
          }
        }
      };
    });

    isReady = true;
    logger.info("memory", "System fully initialized");
  } catch (error) {
    logger.error("memory", "Initialization failed", { error });
  }
}

// --- Logic ---

async function getEmbedding(text: string): Promise<number[]> {
  if (!worker) throw new Error("Worker not initialized");

  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });
    worker!.postMessage({ action: "embed", text, requestId });
  });
}

async function extractPdfText(url: string, maxPages = 20): Promise<string> {
  const loadingTask = pdfjsLib.getDocument(url);
  const pdf = await loadingTask.promise;
  let fullText = "";
  const pageLimit = Math.min(pdf.numPages, maxPages);

  for (let i = 1; i <= pageLimit; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => item.str).join(" ");
    fullText += `[Page ${i}]\n${pageText}\n\n`;
    if (fullText.length > 60_000) {
      fullText = fullText.slice(0, 60_000) + "\n[...truncated]";
      break;
    }
  }

  return fullText;
}

// --- Persistence ---

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
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
    const req = tx.objectStore("data").get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function persist() {
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

// --- Message Handling ---

chrome.runtime.onMessage.addListener(
  (message: MemoryWorkerMessage, _sender, _sendResponse) => {
    // Only accept messages intended for MEMORY_WORKER
    if (message.type !== "MEMORY_WORKER") return;

    // Async handler wrapper
    (async () => {
      if (!isReady) await initialize();

      const { payload } = message as any;

      let responsePayload: any = {};

      try {
        if (payload.action === "add") {
          const id = crypto.randomUUID();
          const { content, category, sourceUrl } = payload;
          const embedding = await getEmbedding(content);

          // Add to SQLite
          db!.run(
            "INSERT INTO memories (id, content, category, source_url, created_at) VALUES (?, ?, ?, ?, ?)",
            [id, content, category, sourceUrl || "", Date.now()],
          );

          // Add to Voy
          // Voy resource: { id, title: any, url: any, embeddings: number[] }
          const resource = {
            id,
            title: category,
            url: sourceUrl || "",
            embeddings: [embedding], // Fix: Voy expects array of embeddings for the document? Or just embedding?
            // Docs say: embeddings: Number[][] (list of embeddings)
          };
          voy!.add(resource);

          await persist();

          responsePayload = { action: "add", success: true, id };
        } else if (payload.action === "search") {
          const { query, limit } = payload;
          const embedding = await getEmbedding(query);

          // Voy Search
          // voy.search(query: Float32Array, k: number)
          const queryVector = new Float32Array(embedding);
          const voyResultsRaw = voy!.search(queryVector, (limit || 5) * 2);

          // voyResultsRaw.neighbors: Array<{ id: string, title: string, url: string }>
          // Voy 0.6.3 might not return score directly in neighbors?
          // We'll approximate or assume order implies score.
          const voyResults = voyResultsRaw.neighbors.map(
            (n: any, i: number) => ({
              id: n.id,
              score: 0.9 - i * 0.05, // Fallback score
            }),
          );

          // FTS5 Search
          const ftsResults: Array<{ id: string; rank: number }> = [];
          const stmt = db!.prepare(`
                    SELECT id, rank
                    FROM memories
                    WHERE memories MATCH ?
                    ORDER BY rank
                    LIMIT ?
                `);
          try {
            stmt.bind([query, (limit || 5) * 2]);
            while (stmt.step()) {
              const row = stmt.get();
              ftsResults.push({ id: row[0] as string, rank: row[1] as number });
            }
          } catch (e) {
            logger.warn("memory", "FTS search failed", { error: e });
          } finally {
            stmt.free();
          }

          // Hydration helper for RRF
          const fetchEntry = (id: string) => {
            const stmt = db!.prepare(
              "SELECT content, category, source_url, created_at FROM memories WHERE id = ?",
            );
            stmt.bind([id]);
            let entry: any = { id };
            if (stmt.step()) {
              const row = stmt.get();
              entry = {
                id,
                content: row[0] as string,
                category: row[1] as string,
                sourceUrl: row[2] as string,
                createdAt: row[3] as number,
                embedding: new Float32Array(0),
              };
            }
            stmt.free();
            return entry;
          };

          const fused = reciprocalRankFusion(
            voyResults,
            ftsResults,
            limit || 5,
            fetchEntry,
          );
          responsePayload = { action: "search", results: fused };
        } else if (payload.action === "extract_pdf") {
          const { url, maxPages } = payload;
          const text = await extractPdfText(url, maxPages);
          responsePayload = { action: "extract_pdf", text, success: true };
        }
      } catch (error: any) {
        logger.error("memory", "Operation failed", { error });
        responsePayload = { action: payload.action, error: error.message };
      }

      // Reply to background
      chrome.runtime.sendMessage({
        type: "MEMORY_WORKER_RESPONSE",
        requestId: message.requestId,
        source: message.source,
        payload: responsePayload,
      });
    })();

    return true;
  },
);

// Start init immediately
initialize();
