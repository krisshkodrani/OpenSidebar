# Phase 4 — Memory System (Second Brain)

> **Goal:** Give the agent long-term memory and the ability to index/search content. This involves a Vector Database (using `transformers.js` for embeddings) and a structured store (IndexedDB/SQLite via WASM).

---

## 1. Architecture

The Memory System runs in an **Offscreen Document** because:
1.  **DOM Access**: `transformers.js` (ONNX Runtime Web) needs web APIs not fully available in Service Workers.
2.  **Performance**: Embedding generation is heavy; we don't want to block the background script.

### Core Modules

1.  **Memory Worker (`src/offscreen/memory/worker.ts`)**:
    -   Handles messages from Background (`MEMORY_WORKER`).
    -   Loads the Embedding Model (`Xenova/all-MiniLM-L6-v2`).
    -   Manages the storage layer.

2.  **Storage Layer (`src/offscreen/memory/storage.ts`)**:
    -   Wrapper around `IndexedDB` (for this MVP, simpler than SQLite WASM and sufficient for <10k items).
    -   Stores `MemoryEntry` objects.
    -   Performs naive cosine similarity search (for MVP) or HNSW if needed. *Decision: Brute-force cosine similarity is consistent and fast enough for <1000 items in JS.*

3.  **Bridge (`src/background/memory/bridge.ts`)**:
    -   Manages the lifecycle of the offscreen document (`chrome.offscreen`).
    -   Proxies requests from Agent Loop to the Offscreen Worker.

---

## 2. Data Flow

1.  **Add Memory**:
    -   Agent calls `memory_add(content, category)`.
    -   Background -> Offscreen.
    -   Offscreen:
        -   Computes Embedding (Float32Array).
        -   Saves `id, content, embedding, metadata` to IndexedDB.
    -   Returns `success`.

2.  **Recall (Search)**:
    -   Agent calls `memory_search(query)`.
    -   Background -> Offscreen.
    -   Offscreen:
        -   Computes Query Embedding.
        -   Scans IndexedDB -> Compute Cosine Similarity.
        -   Sorts & returns top K results.

---

## 3. Implementation Plan

### Step 1: Offscreen Infrastructure
-   Create `src/offscreen/memory/index.html` (if not exists).
-   Create `src/offscreen/memory/main.ts` (entry point).
-   Update `manifest.json` permissions (`offscreen`).

### Step 2: Vector Store Logic
-   Implement `Embedder` using `@xenova/transformers`.
-   Implement `VectorStore` using `idb` (IndexedDB promise wrapper).

### Step 3: Integration
-   Implement `MemoryBridge` in Background.
-   Register `memory_add` and `memory_search` in `ToolRegistry`.

---

## 4. Dependencies
-   `@xenova/transformers`
-   `idb`

## 5. Verification
-   **Unit Tests**: Mock `transformers.js` and test storage logic (using `fake-indexeddb` for Node environment or just browser tests).
-   **Manual**: Use `memory_add` tool in chat and `memory_search` to verify recall.
