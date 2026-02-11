# QSidebar — Technical Master Plan

> **Status:** Draft / Proposed
> **Date:** February 2026
> **Purpose:** To serve as the single source of truth for technical standards, feature roadmap, and development constraints.

---

## 1. Coding Guidelines

### TypeScript & General Principles
*   **Strict Typing:** `noImplicitAny` is enabled. Avoid `any` at all costs; use `unknown` with type guards if necessary.
*   **Functional Style:** Prefer pure functions and immutability. Avoid classes unless necessary (e.g., specific stateful services where closures are messy).
*   **Async/Await:** Use `async/await` over `.then()`. Always handle errors with `try/catch` at the boundary logic.
*   **Comments:** Comment *why*, not *what*. Use JSDoc for all exported functions and types; use inline comments for complex "magic" (like regex or bitwise ops).

### React (Side Panel)
*   **Functional Components:** Use React Functional Components (FC) with Hooks.
*   **State Management:** **Zustand** for global client state (cleaner than Context, no boilerplate). **Immer** is optional (Zustand has strict equality checks, but Immer middleware is fine for complex nested updates).
*   **Effects:** Keep `useEffect` dependencies exhaustive. ISOLATE side effects.
*   **Component Structure:**
    *   `src/components/ui/`: Generic, reusable UI atoms (buttons, inputs) - shadcn/ui style.
    *   `src/components/features/`: Domain-specific components (`ChatWindow`, `WorkspaceSelector`).

### CSS & Styling
*   **Tailwind CSS:** Use utility classes for everything.
*   **No Custom CSS:** Avoid `.css` files unless defining global animations or variables.
*   **Consistency:** Use the `slate` color scale for grays and `indigo` for primaries (as defined in `tailwind.config.js`).

### File Organization
```
src/
├── background/       # Service Worker logic (Agent Loop)
├── content/          # Content Script (DOM interaction)
├── sidepanel/        # React UI
├── offscreen/        # Memory/RAG worker
├── lib/              # Shared utilities (pure functions)
├── types/            # Shared TypeScript definitions
└── assets/           # Static assets
```

---

## 2. Planned Features & Roadmap

### Phase 1: Foundation (Core Agent)
- [x] **Manifest V3 Setup:** Service worker, content script injection, permissions.
- [ ] **Bimodal Agent Loop:** Reflex (Cerebras) + Deep Thought (Kimi) integration.
- [ ] **DOM Distillation:** "Visual Tagging" system to convert HTML to LLM-friendly text.
- [ ] **Basic Tools:** `click_element`, `type_text`, `scroll_page`, `read_page`.

### Phase 2: Resilience & Navigation
- [ ] **Navigation Bridge:** State machine to persist agent state across page reloads.
- [ ] **Context Management:** Sliding window context with "Goal Preservation" (pinned user query).
- [ ] **Security:** Tool risk classification system (Low/Medium/High).

### Phase 3: Memory & Workspaces
- [ ] **Workspace Isolation:** Chrome Tab Groups integration.
- [ ] **Local "Second Brain":**
    *   Offscreen document for embeddings (Transformers.js).
    *   Vector Search (Voy).
    *   Keyword Search (SQLite WASM).
    *   PDF Text Extraction (`pdf.js`).

### Phase 4: Polish & Advanced Tools
- [ ] **Vision Support:** `take_screenshot` tool.
- [ ] **Advanced Interaction:** `hover_element`, `find_element` (text search).
- [ ] **Anti-Modal Janitor:** Heuristic to auto-close cookie banners.

---

## 3. Technology Stack & Libraries

### Core & Build
*   **Runtime:** Chrome Extension Manifest V3
*   **Build Tool:** Vite 5 + `@crxjs/vite-plugin` (HMR support)
*   **Language:** TypeScript 5.7+
*   **Package Manager:** **Bun** (for everything: install, test, run, build).

### UI (Side Panel)
*   **Framework:** React 18
*   **Styling:** Tailwind CSS 3.4
*   **Icons:** Lucide React

### AI & Logic
*   **Reflex Engine:** Cerebras Cloud API (`gpt-oss-120b`)
*   **Deep Thought:** OpenRouter API (`kimi-k2.5`)
*   **Embeddings:** `@huggingface/transformers` (running locally in browser)
*   **Vector Search:** `voy-search` (WASM)
*   **Full-Text Search:** `sql.js` (SQLite WASM)
*   **PDF Processing:** `pdfjs-dist`

### Utilities
*   **UUID:** `uuid` (for message/memory IDs)
*   **Streaming:** Native `fetch` + `TextDecoderStream` (no heavy SDKs where possible)

---

## 4. Testing Strategy

### Principles
*   **Unit Tests:** Test pure logic (parsers, state machines, algorithms) in isolation.
*   **No Browser Mocking Hell:** Do not try to simulate the entire Chrome runtime in unit tests. Mock the *boundary* interfaces defined in `src/types`.
*   **Runner:** Use **Bun** built-in test runner for speed.

### Test Coverage Targets
*   `src/background/context.ts` (Sliding Window): 100% coverage
*   `src/background/streaming.ts` (SSE Parser): 100% coverage
*   `src/lib/janitor.ts` (Anti-Modal Heuristics): 90% coverage
*   `src/background/security.ts` (Input Sanitization): 100% coverage

---

## 5. CI/CD Pipeline

We will use **GitHub Actions**.

### Workflow: `ci.yml`
*   **Trigger:** Push to `main`, Pull Requests.
*   **Steps:**
    1.  **Checkout** code.
    2.  **Setup Bun**.
    3.  **Install Dependencies** (`bun install`).
    4.  **Lint:** `bun run lint`.
    5.  **Type Check:** `bun run type-check`.
    6.  **Test:** `bun test`.
    7.  **Build:** `bun run build`.

---

## 6. Documentation Style

*   **RFCs:** Major feature changes require an RFC in `docs/` (like the current `00-09` series).
*   **Code Comments:** JSDoc for interfaces and complex functions.
*   **Markdown:**
    *   Use GitHub Flavored Markdown.
    *   Keep lines under 100 chars where possible (soft wrap).
    *   Use Mermaid diagrams for flowcharts.
*   **Architecture Decision Records (ADRs):** Decisions are logged in `docs/` updates or new RFCs.

---

## 7. Sign-off Checklist

- [ ] Technical Stack approved?
- [ ] Feature Roadmap scope approved?
- [ ] Testing/CI strategy approved?
